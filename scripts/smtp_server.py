#!/usr/bin/env python3
"""Tiny SMTP sidecar for Diyar HR.

Reads SMTP config from env vars (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
SMTP_FROM). n8n calls this via HTTP Request node instead of the emailSend
node, because emailSend silently routes credential errors to the success
output in some n8n versions.

Accepts POST / with JSON body: { to, subject, body, from? }
Returns 200 JSON:
  { "status": "sent" }                     - delivered successfully
  { "status": "logged", "reason": "..." }  - SMTP not configured, not attempted
  { "status": "failed", "error": "..." }   - attempted but failed
"""
import base64
import json
import os
import pathlib
import smtplib
import sys
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import make_msgid
from http.server import BaseHTTPRequestHandler, HTTPServer

LISTEN_HOST = '127.0.0.1'
LISTEN_PORT = 8901
RECORDINGS_DIR = pathlib.Path(__file__).parent.parent / 'recordings'
MAX_ATTACH_BYTES = 18 * 1024 * 1024  # stay under Gmail's 25 MB cap incl. b64 overhead


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Health check — also reports whether SMTP is configured
        host = os.environ.get('SMTP_HOST', '').strip()
        configured = bool(host)
        self._respond(200, {
            'status': 'ok',
            'smtp_configured': configured,
            'smtp_host': host if configured else None,
        })

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            raw = self.rfile.read(length) if length else b'{}'
            body = json.loads(raw.decode('utf-8') or '{}')
        except Exception as e:
            return self._respond(400, {'status': 'failed', 'error': f'bad json: {e}'})

        to = (body.get('to') or '').strip()
        subject = body.get('subject') or ''
        text = body.get('body') or ''
        if not to or '@' not in to:
            return self._respond(400, {'status': 'failed', 'error': 'valid "to" required'})

        host = os.environ.get('SMTP_HOST', '').strip()
        port_str = os.environ.get('SMTP_PORT', '587').strip()
        user = os.environ.get('SMTP_USER', '').strip()
        passwd = os.environ.get('SMTP_PASS', '')
        from_addr = (body.get('from') or os.environ.get('SMTP_FROM') or user or 'hr@diyar.local').strip()

        if not host:
            return self._respond(200, {
                'status': 'logged',
                'reason': 'SMTP_HOST not set — email was recorded but not transmitted',
            })

        try:
            port = int(port_str)
        except ValueError:
            return self._respond(200, {'status': 'failed', 'error': f'invalid SMTP_PORT: {port_str}'})

        # Generate our own Message-ID so we can persist it on the outbound row
        # and later match an inbound reply's In-Reply-To header back to it. The
        # domain part defaults to the sender's address domain (Gmail rewrites
        # the localhost domain otherwise — but the unique opaque token survives,
        # which is what In-Reply-To matching cares about).
        msgid_domain = from_addr.split('@')[-1].split('>')[0].strip() if '@' in from_addr else 'diyar.local'
        message_id = make_msgid(domain=msgid_domain)

        # Optional attachments: small files arrive base64 in the request
        # (CV pdf, generated report pdf); the interview recording arrives as a
        # filename only and is read from recordings/ locally, so large videos
        # never travel through n8n's JSON payload limit.
        attachments = body.get('attachments') or []
        recording_file = (body.get('recording_file') or '').strip()
        # Optional styled HTML version — sent as multipart/alternative so
        # clients render the branded card and fall back to the plain text.
        html_body = (body.get('html_body') or '').strip()
        skipped = []

        try:
            parts = []
            total = 0
            for a in attachments[:5]:
                fn = os.path.basename(str(a.get('filename') or 'attachment'))
                try:
                    data = base64.b64decode(a.get('content_b64') or '')
                except Exception:
                    skipped.append(fn + ' (bad base64)')
                    continue
                if not data or total + len(data) > MAX_ATTACH_BYTES:
                    skipped.append(fn + ' (too large)')
                    continue
                total += len(data)
                part = MIMEApplication(data, Name=fn)
                part['Content-Disposition'] = f'attachment; filename="{fn}"'
                parts.append(part)
            if recording_file:
                fn = os.path.basename(recording_file)
                path = RECORDINGS_DIR / fn
                if not path.exists():
                    skipped.append(fn + ' (recording not found)')
                elif total + path.stat().st_size > MAX_ATTACH_BYTES:
                    skipped.append(fn + ' (too large for email)')
                else:
                    data = path.read_bytes()
                    total += len(data)
                    part = MIMEApplication(data, Name=fn)
                    part['Content-Disposition'] = f'attachment; filename="{fn}"'
                    parts.append(part)

            if html_body:
                content = MIMEMultipart('alternative')
                content.attach(MIMEText(text, 'plain', 'utf-8'))
                content.attach(MIMEText(html_body, 'html', 'utf-8'))
            else:
                content = MIMEText(text, 'plain', 'utf-8')

            if parts:
                msg = MIMEMultipart('mixed')
                msg.attach(content)
                for p in parts:
                    msg.attach(p)
            else:
                msg = content
            msg['Subject'] = subject
            msg['From'] = from_addr
            msg['To'] = to
            msg['Message-ID'] = message_id

            if port == 465:
                server = smtplib.SMTP_SSL(host, port, timeout=20)
            else:
                server = smtplib.SMTP(host, port, timeout=20)
                try:
                    server.starttls()
                except smtplib.SMTPException:
                    pass  # server may not support STARTTLS (e.g. Mailpit on 1025)

            if user and passwd:
                server.login(user, passwd)
            server.send_message(msg)
            server.quit()
            resp = {'status': 'sent', 'to': to, 'from': from_addr, 'message_id': message_id}
            if skipped:
                resp['attachments_skipped'] = skipped
            return self._respond(200, resp)
        except Exception as e:
            return self._respond(200, {'status': 'failed', 'error': f'{type(e).__name__}: {e}'})

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _respond(self, code, payload):
        data = json.dumps(payload).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args, **kwargs):
        # Suppress default access logs; errors still print via stderr.
        pass


def main():
    srv = HTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    print(f'SMTP sidecar listening on http://{LISTEN_HOST}:{LISTEN_PORT}', file=sys.stderr)
    print(f'  SMTP_HOST={os.environ.get("SMTP_HOST", "(not set — logging only)")}', file=sys.stderr)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
