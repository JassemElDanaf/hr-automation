#!/usr/bin/env python3
"""
HR Automation Control Server — http://127.0.0.1:8903
Lets the frontend start/stop services via HTTP.
POST /service/<name>/start  or  /service/<name>/stop
"""
import json
import os
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

PORT = 8903
PROJECT_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = Path(__file__).resolve().parent
OLLAMA_EXE = Path("D:/ollama/program/ollama.exe")

# Processes we spawned (so we can kill them cleanly)
_procs: dict[str, subprocess.Popen] = {}


def _run(cmd, timeout=15):
    """Run a blocking command; return (ok, output)."""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode == 0, (r.stdout + r.stderr).strip()
    except Exception as e:
        return False, str(e)


def _spawn(key, cmd, cwd=None, env=None):
    """Spawn a background process, tracking it by key."""
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            cwd=str(cwd or PROJECT_DIR),
            env=env,
        )
        _procs[key] = proc
        return True, f"Started (pid {proc.pid})"
    except Exception as e:
        return False, str(e)


def _kill_key(key):
    """Kill a process we spawned."""
    proc = _procs.pop(key, None)
    if proc:
        try:
            proc.terminate()
            proc.wait(timeout=5)
            return True, "Stopped"
        except Exception as e:
            return False, str(e)
    return False, "Process not tracked — may have been started externally"


def _taskkill(exe_name):
    """Kill all Windows processes matching exe_name."""
    ok, out = _run(["taskkill", "/f", "/im", exe_name])
    return ok, out


# ── Service handlers ──────────────────────────────────────────────────────────

def docker_start():
    ok, out = _run(["docker", "start", "hr-postgres"], timeout=20)
    return ok, out or "hr-postgres started"

def docker_stop():
    ok, out = _run(["docker", "stop", "hr-postgres"], timeout=20)
    return ok, out or "hr-postgres stopped"

def ollama_start():
    if OLLAMA_EXE.exists():
        return _spawn("ollama", [str(OLLAMA_EXE), "serve"])
    # fallback: ollama in PATH
    return _spawn("ollama", ["ollama", "serve"])

def ollama_stop():
    ok, msg = _kill_key("ollama")
    if ok:
        return ok, msg
    # try taskkill if we didn't spawn it
    return _taskkill("ollama.exe")

def smtp_start():
    env = {**os.environ, "PYTHONUNBUFFERED": "1"}
    return _spawn("smtp", [sys.executable, str(SCRIPTS_DIR / "smtp_server.py")], env=env)

def smtp_stop():
    ok, msg = _kill_key("smtp")
    if ok:
        return ok, msg
    # find by port if we didn't spawn it
    ok2, out2 = _run(["netstat", "-ano"], timeout=5)
    if ok2:
        for line in out2.splitlines():
            if ":8901" in line and "LISTENING" in line:
                parts = line.split()
                pid = parts[-1]
                _run(["taskkill", "/f", "/pid", pid])
                return True, f"Killed pid {pid}"
    return False, "SMTP process not found"

def n8n_start():
    n8n_bin = Path("D:/n8n/node_modules/.bin/n8n")
    node_exe = Path("D:/NodeJS/node.exe")
    env = {
        **os.environ,
        "N8N_USER_FOLDER": "D:/n8n",
        "N8N_USER_MANAGEMENT_DISABLED": "true",
        "N8N_DIAGNOSTICS_ENABLED": "false",
        "OLLAMA_MODELS": "D:/ollama",
        "OLLAMA_HOME": "D:/ollama",
    }
    if node_exe.exists() and n8n_bin.exists():
        return _spawn("n8n", [str(node_exe), str(n8n_bin), "start"], cwd=Path("D:/n8n"), env=env)
    # fallback
    return _spawn("n8n", ["npx", "n8n", "start"], cwd=Path("D:/n8n"), env=env)

def n8n_stop():
    ok, msg = _kill_key("n8n")
    if ok:
        return ok, msg
    # kill n8n node processes (careful: kills all node — warn user)
    ok2, out = _run(["taskkill", "/f", "/im", "node.exe"])
    return ok2, out


HANDLERS = {
    "docker": {"start": docker_start, "stop": docker_stop},
    "ollama": {"start": ollama_start, "stop": ollama_stop},
    "smtp":   {"start": smtp_start,   "stop": smtp_stop},
    "n8n":    {"start": n8n_start,    "stop": n8n_stop},
}


# ── HTTP server ───────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def _send(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        self._send(200, {"ok": True, "service": "hr-control", "port": PORT})

    def do_POST(self):
        parts = self.path.strip("/").split("/")
        # expects: /service/<name>/<action>
        if len(parts) == 3 and parts[0] == "service":
            _, name, action = parts
            handlers = HANDLERS.get(name)
            if not handlers:
                return self._send(404, {"ok": False, "error": f"Unknown service: {name}"})
            fn = handlers.get(action)
            if not fn:
                return self._send(400, {"ok": False, "error": f"Unknown action: {action}"})
            ok, msg = fn()
            self._send(200 if ok else 500, {"ok": ok, "message": msg})
        else:
            self._send(404, {"ok": False, "error": "Not found"})


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[control] HR Control server on http://127.0.0.1:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        for p in _procs.values():
            p.terminate()
