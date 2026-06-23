#!/usr/bin/env python3
"""Recording sidecar — stores and serves candidate interview recordings.
Listens on 127.0.0.1:8903. Accepts raw binary POST uploads and serves files
with HTTP range support so <video> seeking works in the browser.
"""
import http.server, json, os, pathlib, socketserver, mimetypes, sys

RECORDINGS_DIR = pathlib.Path(os.environ.get('RECORDINGS_DIR', str(pathlib.Path(__file__).parent.parent / 'recordings')))
PORT = int(os.environ.get('RECORDING_PORT', '8903'))
HOST = os.environ.get('SIDECAR_HOST', '127.0.0.1')
RECORDINGS_DIR.mkdir(exist_ok=True)


class Handler(http.server.BaseHTTPRequestHandler):

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Filename')

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == '/':
            files = list(RECORDINGS_DIR.glob('*'))
            self._json(200, {'status': 'ok', 'recordings': len(files)})
            return

        if self.path.startswith('/recording/'):
            raw = self.path[len('/recording/'):].split('?')[0]
            filename = pathlib.Path(raw).name  # sanitize
            filepath = RECORDINGS_DIR / filename
            if not filepath.exists():
                self._json(404, {'error': 'not found'})
                return

            size = filepath.stat().st_size
            mime = mimetypes.guess_type(str(filepath))[0] or 'video/webm'
            range_header = self.headers.get('Range', '')

            if range_header and range_header.startswith('bytes='):
                parts = range_header[6:].split('-')
                start = int(parts[0]) if parts[0] else 0
                end   = int(parts[1]) if len(parts) > 1 and parts[1] else size - 1
                end   = min(end, size - 1)
                length = end - start + 1
                self.send_response(206)
                self._cors()
                self.send_header('Content-Type', mime)
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
                self.send_header('Content-Length', str(length))
                self.send_header('Accept-Ranges', 'bytes')
                self.end_headers()
                with open(filepath, 'rb') as f:
                    f.seek(start)
                    remaining = length
                    while remaining:
                        chunk = f.read(min(65536, remaining))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
            else:
                self.send_response(200)
                self._cors()
                self.send_header('Content-Type', mime)
                self.send_header('Content-Length', str(size))
                self.send_header('Accept-Ranges', 'bytes')
                self.end_headers()
                with open(filepath, 'rb') as f:
                    while True:
                        chunk = f.read(65536)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
            return

        self._json(404, {'error': 'not found'})

    def do_POST(self):
        if self.path.startswith('/recording/upload'):
            # Filename comes from X-Filename header or query param
            filename = self.headers.get('X-Filename', '')
            if not filename and '?filename=' in self.path:
                filename = self.path.split('?filename=')[-1].split('&')[0]
            if not filename:
                filename = 'recording.webm'
            filename = pathlib.Path(filename).name  # sanitize

            length = int(self.headers.get('Content-Length', 0))
            out_path = RECORDINGS_DIR / filename
            written = 0
            with open(out_path, 'wb') as f:
                while written < length:
                    chunk = self.rfile.read(min(65536, length - written))
                    if not chunk:
                        break
                    f.write(chunk)
                    written += len(chunk)

            self._json(200, {'success': True, 'filename': filename, 'size': written})
            return

        self._json(404, {'error': 'not found'})

    def log_message(self, fmt, *args):
        print(f'[RecordingServer] {fmt % args}', flush=True)


if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer((HOST, PORT), Handler) as httpd:
        print(f'[RecordingServer] Listening on http://{HOST}:{PORT}', flush=True)
        print(f'[RecordingServer] Storing recordings in {RECORDINGS_DIR}', flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
