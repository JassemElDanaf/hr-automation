#!/usr/bin/env python3
"""Tiny SMTP sidecar for Diyar HR Automation.

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
import json
import os
import smtplib
import sys
from email.mime.text import MIMEText
from http.server import BaseHTTPRequestHandler, HTTPServer

LISTEN_HOST = '127.0.0.1'
LISTEN_PORT = 8901


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

        try:
            msg = MIMEText(text, 'plain', 'utf-8')
            msg['Subject'] = subject
            msg['From'] = from_addr
            msg['To'] = to

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
            return self._respond(200, {'status': 'sent', 'to': to, 'from': from_addr})
        except Exception as e:
            return self._respond(200, {'status': 'failed', 'error': f'{type(e).__name__}: {e}'})

    def _respond(self, code, payload):
        data = json.dumps(payload).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
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
