#!/usr/bin/env python3
"""Tiny IMAP poll sidecar for Diyar HR Automation — twin of smtp_server.py.

Pulls UNSEEN messages from a configured IMAP mailbox every IMAP_POLL_SEC seconds,
parses each, and POSTs to n8n's `/inbound-email` webhook so the row lands in
`email_log` with `direction='inbound'`. n8n then matches by In-Reply-To against
the outbound message_id we persisted on send, so the reply attaches to the same
candidate / job_opening as the original.

Env vars:
  IMAP_HOST           e.g. imap.gmail.com
  IMAP_PORT           default 993 (SSL)
  IMAP_USER           full mailbox address
  IMAP_PASS           Gmail App Password (same one used for SMTP works)
  IMAP_FOLDER         default INBOX
  IMAP_POLL_SEC       default 60
  N8N_INBOUND_URL     default http://127.0.0.1:5678/webhook/inbound-email

Without IMAP_HOST set, the daemon stays running but skips polling — same pattern
as the SMTP sidecar's "logged only" mode, so start.sh can launch it
unconditionally.

Also exposes GET http://127.0.0.1:8902/ for a health/stats check.
"""
import email
import imaplib
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from email.header import decode_header
from http.server import BaseHTTPRequestHandler, HTTPServer

LISTEN_HOST = '127.0.0.1'
LISTEN_PORT = 8902

# Mutated by the poll thread, read by the HTTP handler. Plain dict + GIL is
# enough — fields are atomic assignments, no compound updates.
STATE = {
    'last_poll_at': None,
    'last_poll_status': 'never',
    'last_error': None,
    'inbound_count': 0,
    'forwarded_count': 0,
    'imap_configured': False,
}


def _decode(value):
    """Decode an RFC-2047 header (Subject often comes encoded)."""
    if value is None:
        return ''
    parts = decode_header(value)
    out = []
    for chunk, enc in parts:
        if isinstance(chunk, bytes):
            try:
                out.append(chunk.decode(enc or 'utf-8', errors='replace'))
            except LookupError:
                out.append(chunk.decode('utf-8', errors='replace'))
        else:
            out.append(chunk)
    return ''.join(out).strip()


def _extract_body(msg):
    """Best-effort plain-text body. Walks multipart, prefers text/plain. Falls
    back to text/html with tags stripped if no plain part exists."""
    if msg.is_multipart():
        plain = None
        html = None
        for part in msg.walk():
            ctype = part.get_content_type()
            disp = (part.get('Content-Disposition') or '').lower()
            if 'attachment' in disp:
                continue
            if ctype == 'text/plain' and plain is None:
                plain = part
            elif ctype == 'text/html' and html is None:
                html = part
        target = plain or html
        if target is None:
            return ''
        payload = target.get_payload(decode=True) or b''
        text = payload.decode(target.get_content_charset() or 'utf-8', errors='replace')
        if target is html:
            import re
            text = re.sub(r'<style[\s\S]*?</style>', '', text, flags=re.IGNORECASE)
            text = re.sub(r'<script[\s\S]*?</script>', '', text, flags=re.IGNORECASE)
            text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
            text = re.sub(r'</p>', '\n', text, flags=re.IGNORECASE)
            text = re.sub(r'<[^>]+>', '', text)
        return text.strip()
    payload = msg.get_payload(decode=True) or b''
    return payload.decode(msg.get_content_charset() or 'utf-8', errors='replace').strip()


def _strip_quote(text):
    """Remove obvious reply-quote tails so the stored body is just the new
    content. Best-effort — keeps the raw text intact if no marker is found."""
    if not text:
        return text
    markers = [
        '\n-----Original Message-----',
        '\n________________________________',
        '\nFrom: ',
        '\nOn ',  # "On Mon, Apr 27, 2026 at 9:00 AM Foo wrote:"
    ]
    earliest = len(text)
    for m in markers:
        idx = text.find(m)
        if idx != -1 and idx < earliest:
            earliest = idx
    return text[:earliest].rstrip()


def _post_inbound(payload):
    url = os.environ.get('N8N_INBOUND_URL', 'http://127.0.0.1:5678/webhook/inbound-email')
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read().decode('utf-8', errors='replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', errors='replace') if hasattr(e, 'read') else str(e)
    except Exception as e:
        return None, f'{type(e).__name__}: {e}'


def _poll_once():
    host = os.environ.get('IMAP_HOST', '').strip()
    user = os.environ.get('IMAP_USER', '').strip()
    passwd = os.environ.get('IMAP_PASS', '')
    folder = os.environ.get('IMAP_FOLDER', 'INBOX').strip() or 'INBOX'
    port_str = os.environ.get('IMAP_PORT', '993').strip()

    if not host or not user or not passwd:
        STATE['imap_configured'] = False
        STATE['last_poll_status'] = 'skipped — IMAP env not set'
        return

    STATE['imap_configured'] = True
    try:
        port = int(port_str)
    except ValueError:
        STATE['last_poll_status'] = f'failed — invalid IMAP_PORT: {port_str}'
        return

    try:
        m = imaplib.IMAP4_SSL(host, port, timeout=20)
        m.login(user, passwd)
        m.select(folder)
        typ, data = m.search(None, 'UNSEEN')
        if typ != 'OK':
            STATE['last_poll_status'] = f'failed — search: {typ}'
            try: m.logout()
            except: pass
            return
        ids = data[0].split() if data and data[0] else []
        for raw_id in ids:
            try:
                typ, mdata = m.fetch(raw_id, '(RFC822)')
                if typ != 'OK' or not mdata or not mdata[0]:
                    continue
                raw = mdata[0][1]
                msg = email.message_from_bytes(raw)
                STATE['inbound_count'] += 1

                payload = {
                    'from': _decode(msg.get('From')),
                    'to': _decode(msg.get('To')),
                    'subject': _decode(msg.get('Subject')),
                    'message_id': (msg.get('Message-ID') or '').strip(),
                    'in_reply_to': (msg.get('In-Reply-To') or '').strip(),
                    'references': (msg.get('References') or '').strip(),
                    'body': _strip_quote(_extract_body(msg)),
                    'date': msg.get('Date'),
                }
                status, resp_text = _post_inbound(payload)
                if status and 200 <= status < 300:
                    STATE['forwarded_count'] += 1
                    # Mark as Seen only after successful forward — failures stay
                    # UNSEEN so the next poll retries.
                    m.store(raw_id, '+FLAGS', '\\Seen')
                else:
                    STATE['last_error'] = f'forward failed (HTTP {status}): {resp_text[:200]}'
            except Exception as e:
                STATE['last_error'] = f'parse failed: {type(e).__name__}: {e}'
                continue
        try: m.logout()
        except: pass
        STATE['last_poll_status'] = f'ok — {len(ids)} new'
    except Exception as e:
        STATE['last_poll_status'] = f'failed — {type(e).__name__}: {e}'
        STATE['last_error'] = str(e)


def _poll_loop():
    interval_str = os.environ.get('IMAP_POLL_SEC', '60').strip()
    try:
        interval = max(15, int(interval_str))
    except ValueError:
        interval = 60
    while True:
        _poll_once()
        STATE['last_poll_at'] = time.strftime('%Y-%m-%dT%H:%M:%S')
        time.sleep(interval)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        host = os.environ.get('IMAP_HOST', '').strip()
        self._respond(200, {
            'status': 'ok',
            'imap_configured': bool(host),
            'imap_host': host or None,
            'last_poll_at': STATE['last_poll_at'],
            'last_poll_status': STATE['last_poll_status'],
            'last_error': STATE['last_error'],
            'inbound_count': STATE['inbound_count'],
            'forwarded_count': STATE['forwarded_count'],
        })

    def _respond(self, code, payload):
        data = json.dumps(payload).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args, **kwargs):
        pass


def main():
    t = threading.Thread(target=_poll_loop, daemon=True)
    t.start()
    srv = HTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    print(f'IMAP sidecar listening on http://{LISTEN_HOST}:{LISTEN_PORT}', file=sys.stderr)
    print(f'  IMAP_HOST={os.environ.get("IMAP_HOST", "(not set — polling skipped)")}', file=sys.stderr)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
