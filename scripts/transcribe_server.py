#!/usr/bin/env python3
"""Whisper transcription sidecar — browser speech-to-text fallback.
POST /transcribe  with raw audio body (webm/ogg/mp4/wav) → {"text": "..."}
Uses faster-whisper (tiny model) for low-latency CPU transcription.
Browsers that lack Web Speech API (Firefox, Chrome/Linux) use this endpoint.
"""
import http.server, json, os, socketserver, tempfile, threading

PORT = int(os.environ.get('TRANSCRIBE_PORT', '8905'))
HOST = os.environ.get('SIDECAR_HOST', '127.0.0.1')
MODEL_SIZE = os.environ.get('WHISPER_MODEL', 'tiny')

_model = None
_lock  = threading.Lock()

def get_model():
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                from faster_whisper import WhisperModel
                print(f'[Transcribe] Loading {MODEL_SIZE} model…', flush=True)
                _model = WhisperModel(MODEL_SIZE, device='cpu', compute_type='int8')
                print('[Transcribe] Model ready.', flush=True)
    return _model

class Handler(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        if not length:
            self._json(400, {'error': 'empty'}); return
        audio = self.rfile.read(length)
        ct  = self.headers.get('Content-Type', 'audio/webm').split(';')[0].strip()
        ext = {'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.mp4',
               'audio/mpeg': '.mp3', 'audio/wav': '.wav'}.get(ct, '.webm')
        tmp = None
        try:
            with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
                f.write(audio); tmp = f.name
            segs, _ = get_model().transcribe(tmp, beam_size=1, vad_filter=True, language='en')
            text = ' '.join(s.text.strip() for s in segs).strip()
            self._json(200, {'text': text})
        except Exception as e:
            print(f'[Transcribe] Error: {e}', flush=True)
            self._json(500, {'error': str(e)})
        finally:
            if tmp:
                try: os.unlink(tmp)
                except: pass

    def log_message(self, *_): pass

if __name__ == '__main__':
    print(f'[Transcribe] Starting on http://{HOST}:{PORT}', flush=True)
    threading.Thread(target=get_model, daemon=True).start()  # pre-warm on startup
    with socketserver.ThreadingTCPServer((HOST, PORT), Handler) as s:
        s.serve_forever()
