#!/usr/bin/env python3
"""
Auth sidecar — application login + RBAC for the Diyar HR app.

Port 8904 (Vite proxies /auth -> here). Passwords are hashed by Postgres itself
via pgcrypto bcrypt (crypt() / gen_salt('bf', 12)) — never stored or compared in
plain text. Sessions are opaque random UUID tokens stored in auth_sessions and
validated on every /auth/me, so there is no client-side JWT to forge.

Roles: admin | recruiter | viewer.

Endpoints (JSON):
  GET  /                       health
  POST /auth/login   {email,password}            -> {token, user}
  GET  /auth/me      (Bearer token)              -> {user}
  POST /auth/logout  (Bearer token)              -> {ok}
  GET  /auth/users   (admin)                     -> {users:[...]}
  POST /auth/users   (admin) {email,password,full_name,role}
  PATCH/auth/users   (admin) {id, role?, is_active?, password?}

On first run (empty users table) it seeds an admin and prints the credentials to
stderr — change the password after first login.
"""
import json
import os
import sys
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

import psycopg2
from psycopg2.extras import RealDictCursor

LISTEN_HOST = '127.0.0.1'
LISTEN_PORT = 8904
SESSION_HOURS = 12

DB = dict(
    host=os.environ.get('PG_HOST', '127.0.0.1'),
    port=int(os.environ.get('PG_PORT', '5432')),
    user=os.environ.get('PG_USER', 'hr_admin'),
    password=os.environ.get('PG_PASSWORD', 'hr_pass'),
    dbname=os.environ.get('PG_DB', 'hr_automation'),
)
SEED_ADMIN_EMAIL = os.environ.get('SEED_ADMIN_EMAIL', 'admin@diyarme.com')
SEED_ADMIN_PASSWORD = os.environ.get('SEED_ADMIN_PASSWORD', 'ChangeMe123!')
VALID_ROLES = ('admin', 'recruiter', 'viewer')


def db():
    return psycopg2.connect(**DB)


def seed_admin():
    try:
        with db() as c, c.cursor() as cur:
            cur.execute("SELECT count(*) FROM users")
            if cur.fetchone()[0] == 0:
                cur.execute(
                    "INSERT INTO users (email, password_hash, full_name, role) "
                    "VALUES (%s, crypt(%s, gen_salt('bf', 12)), %s, 'admin')",
                    (SEED_ADMIN_EMAIL.lower(), SEED_ADMIN_PASSWORD, 'Administrator'),
                )
                c.commit()
                print(f"[auth] Seeded initial admin: {SEED_ADMIN_EMAIL} / {SEED_ADMIN_PASSWORD} "
                      f"-- CHANGE THIS PASSWORD after first login.", file=sys.stderr)
    except Exception as e:
        print(f"[auth] seed_admin failed: {e}", file=sys.stderr)


def is_uuid(token):
    try:
        uuid.UUID(str(token))
        return True
    except (ValueError, TypeError, AttributeError):
        return False


def user_by_token(cur, token):
    # token is a UUID column — a malformed value would raise a SQL error, so
    # reject anything that isn't a UUID up front (→ treated as unauthorized).
    if not token or not is_uuid(token):
        return None
    cur.execute(
        "SELECT u.id, u.email, u.full_name, u.role, u.is_active "
        "FROM auth_sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token = %s AND s.expires_at > now() AND u.is_active",
        (token,),
    )
    return cur.fetchone()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass  # quiet

    # ---- helpers ----
    def _send(self, code, payload):
        b = json.dumps(payload, default=str).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self._cors()
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def _token(self):
        auth = self.headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            return auth[7:].strip()
        q = parse_qs(urlparse(self.path).query)
        return (q.get('token') or [None])[0]

    def _body(self):
        n = int(self.headers.get('Content-Length', 0) or 0)
        return json.loads(self.rfile.read(n) or b'{}') if n else {}

    def _require_admin(self, cur):
        me = user_by_token(cur, self._token())
        if not me:
            self._send(401, {'error': 'unauthorized'})
            return None
        if me['role'] != 'admin':
            self._send(403, {'error': 'admin only'})
            return None
        return me

    # ---- routes ----
    def do_GET(self):
        path = urlparse(self.path).path
        if path in ('/', '/auth/health'):
            return self._send(200, {'status': 'ok'})
        try:
            with db() as c, c.cursor(cursor_factory=RealDictCursor) as cur:
                if path == '/auth/me':
                    me = user_by_token(cur, self._token())
                    return self._send(200 if me else 401,
                                      {'user': me} if me else {'error': 'unauthorized'})
                if path == '/auth/users':
                    if not self._require_admin(cur):
                        return
                    cur.execute("SELECT id, email, full_name, role, is_active, created_at, "
                                "last_login_at FROM users ORDER BY id")
                    return self._send(200, {'users': cur.fetchall()})
            return self._send(404, {'error': 'not found'})
        except Exception as e:
            return self._send(500, {'error': str(e)})

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self._body()
        except Exception as e:
            return self._send(400, {'error': f'bad json: {e}'})
        try:
            with db() as c, c.cursor(cursor_factory=RealDictCursor) as cur:
                if path == '/auth/login':
                    email = (body.get('email') or '').strip().lower()
                    pw = body.get('password') or ''
                    if not email or not pw:
                        return self._send(400, {'error': 'email and password required'})
                    cur.execute(
                        "SELECT id, email, full_name, role FROM users "
                        "WHERE lower(email) = %s AND is_active "
                        "AND password_hash = crypt(%s, password_hash)",
                        (email, pw),
                    )
                    row = cur.fetchone()
                    if not row:
                        return self._send(401, {'error': 'Invalid email or password'})
                    cur.execute(
                        "INSERT INTO auth_sessions (user_id, expires_at) "
                        "VALUES (%s, now() + make_interval(hours => %s)) RETURNING token",
                        (row['id'], SESSION_HOURS),
                    )
                    token = cur.fetchone()['token']
                    cur.execute("UPDATE users SET last_login_at = now() WHERE id = %s", (row['id'],))
                    c.commit()
                    return self._send(200, {'token': str(token), 'user': row})

                if path == '/auth/logout':
                    tok = self._token() or body.get('token')
                    if tok and is_uuid(tok):
                        cur.execute("DELETE FROM auth_sessions WHERE token = %s", (tok,))
                        c.commit()
                    return self._send(200, {'ok': True})

                if path == '/auth/users':  # admin: create user
                    if not self._require_admin(cur):
                        return
                    email = (body.get('email') or '').strip().lower()
                    pw = body.get('password') or ''
                    role = body.get('role') or 'recruiter'
                    full_name = body.get('full_name') or ''
                    if not email or not pw:
                        return self._send(400, {'error': 'email and password required'})
                    if role not in VALID_ROLES:
                        return self._send(400, {'error': 'invalid role'})
                    try:
                        cur.execute(
                            "INSERT INTO users (email, password_hash, full_name, role) "
                            "VALUES (%s, crypt(%s, gen_salt('bf', 12)), %s, %s) "
                            "RETURNING id, email, full_name, role, is_active, created_at",
                            (email, pw, full_name, role),
                        )
                        c.commit()
                        return self._send(200, {'user': cur.fetchone()})
                    except psycopg2.errors.UniqueViolation:
                        return self._send(409, {'error': 'a user with that email already exists'})
            return self._send(404, {'error': 'not found'})
        except Exception as e:
            return self._send(500, {'error': str(e)})

    def do_PATCH(self):
        path = urlparse(self.path).path
        try:
            body = self._body()
        except Exception as e:
            return self._send(400, {'error': f'bad json: {e}'})
        if path != '/auth/users':
            return self._send(404, {'error': 'not found'})
        try:
            with db() as c, c.cursor(cursor_factory=RealDictCursor) as cur:
                me = self._require_admin(cur)
                if not me:
                    return
                uid = body.get('id')
                if not uid:
                    return self._send(400, {'error': 'id required'})
                sets, vals = [], []
                if 'role' in body:
                    if body['role'] not in VALID_ROLES:
                        return self._send(400, {'error': 'invalid role'})
                    sets.append('role = %s')
                    vals.append(body['role'])
                if 'is_active' in body:
                    sets.append('is_active = %s')
                    vals.append(bool(body['is_active']))
                if 'full_name' in body:
                    sets.append('full_name = %s')
                    vals.append(body['full_name'])
                if body.get('password'):
                    sets.append("password_hash = crypt(%s, gen_salt('bf', 12))")
                    vals.append(body['password'])
                if not sets:
                    return self._send(400, {'error': 'nothing to update'})
                vals.append(uid)
                cur.execute(f"UPDATE users SET {', '.join(sets)} WHERE id = %s "
                            "RETURNING id, email, full_name, role, is_active", vals)
                row = cur.fetchone()
                if not row:
                    return self._send(404, {'error': 'user not found'})
                # If the user was deactivated, kill their sessions.
                if 'is_active' in body and not body['is_active']:
                    cur.execute("DELETE FROM auth_sessions WHERE user_id = %s", (uid,))
                c.commit()
                return self._send(200, {'user': row})
        except Exception as e:
            return self._send(500, {'error': str(e)})


def main():
    try:
        seed_admin()
    except Exception as e:
        print(f"[auth] startup seed error: {e}", file=sys.stderr)
    srv = HTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    print(f"Auth sidecar listening on http://{LISTEN_HOST}:{LISTEN_PORT}", file=sys.stderr)
    srv.serve_forever()


if __name__ == '__main__':
    main()
