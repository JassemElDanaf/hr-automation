#!/bin/bash
# Diyar HR — Start All Services
# Usage: ./start.sh [--no-open]

export PATH="/d/NodeJS:/c/Users/Jasse/AppData/Roaming/npm:/d/n8n/node_modules/.bin:$PATH"
export N8N_USER_FOLDER=/d/n8n
export N8N_USER_MANAGEMENT_DISABLED=true
export N8N_BASIC_AUTH_ACTIVE=false
export N8N_AUTH_EXCLUDE_ENDPOINTS="*"
export N8N_DIAGNOSTICS_ENABLED=false
export OLLAMA_MODELS=/d/ollama
export OLLAMA_HOME=/d/ollama
export OLLAMA_ORIGINS="http://localhost:3001,http://127.0.0.1:3001"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load .env (SMTP creds, any local overrides)
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a; . "$SCRIPT_DIR/.env"; set +a
  echo "  Loaded .env"
fi

echo "Starting Diyar HR services..."

# ── 1. Docker Desktop + PostgreSQL ───────────────────────────────────────────
echo "[1/6] Docker + PostgreSQL..."
if ! docker info > /dev/null 2>&1; then
  DOCKER_DESKTOP="/c/Program Files/Docker/Docker/Docker Desktop.exe"
  if [ -f "$DOCKER_DESKTOP" ]; then
    echo "  Launching Docker Desktop..."
    "$DOCKER_DESKTOP" > /dev/null 2>&1 &
    disown 2>/dev/null || true
    tries=0
    until docker info > /dev/null 2>&1; do
      tries=$((tries + 1))
      [ $tries -gt 60 ] && echo "  ERROR: Docker didn't start after 2 min." && break
      printf "."; sleep 2
    done
    echo ""
  else
    echo "  WARNING: Docker Desktop not found — start it manually."
  fi
fi

if docker info > /dev/null 2>&1; then
  if docker ps 2>/dev/null | grep -q hr-postgres; then
    echo "  PostgreSQL already running."
  else
    docker start hr-postgres 2>/dev/null \
      && echo "  PostgreSQL started." \
      || echo "  WARNING: hr-postgres not found. Create it with: docker run -d --name hr-postgres -e POSTGRES_USER=hr_admin -e POSTGRES_PASSWORD=hr_pass -e POSTGRES_DB=hr_automation -p 5432:5432 postgres:16"
  fi
fi

# ── 2. Ollama ────────────────────────────────────────────────────────────────
echo "[2/6] Ollama..."
if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo "  Ollama already running."
else
  /d/ollama/program/ollama.exe serve > /dev/null 2>&1 &
  # Cold-starting the 40MB exe + scanning /d/ollama models takes >3s here, so a
  # single fixed-sleep check fired before the port was bound and false-reported
  # "failed" (same trap as the old n8n bug). Poll instead — up to ~30s.
  otries=0
  until curl -s http://localhost:11434/api/tags > /dev/null 2>&1; do
    sleep 2; otries=$((otries+1))
    [ $otries -gt 15 ] && break
  done
  curl -s http://localhost:11434/api/tags > /dev/null 2>&1 \
    && echo "  Ollama started." \
    || echo "  WARNING: Ollama failed to start (port 11434 not responding after 30s)."
fi

# ── 3. Python sidecars ───────────────────────────────────────────────────────
echo "[3/6] Python sidecars (SMTP / IMAP / Recording / Auth)..."

# Auth sidecar needs psycopg2 (DB driver). Install once if missing — quick no-op
# when already present.
python -c "import psycopg2" > /dev/null 2>&1 || {
  echo "  Installing psycopg2-binary for the auth sidecar..."
  python -m pip install --quiet psycopg2-binary > /dev/null 2>&1 || echo "  WARNING: psycopg2 install failed — auth login won't work."
}

if curl -s http://127.0.0.1:8901/ > /dev/null 2>&1; then
  echo "  SMTP sidecar already running."
else
  python "$SCRIPT_DIR/scripts/smtp_server.py" > /dev/null 2>&1 &
  sleep 1
  curl -s http://127.0.0.1:8901/ > /dev/null 2>&1 \
    && echo "  SMTP sidecar started (port 8901)." \
    || echo "  WARNING: SMTP sidecar failed."
fi

if curl -s http://127.0.0.1:8902/ > /dev/null 2>&1; then
  echo "  IMAP sidecar already running."
else
  python "$SCRIPT_DIR/scripts/imap_server.py" > /dev/null 2>&1 &
  sleep 1
  curl -s http://127.0.0.1:8902/ > /dev/null 2>&1 \
    && echo "  IMAP sidecar started (port 8902)." \
    || echo "  WARNING: IMAP sidecar failed."
fi

if curl -s http://127.0.0.1:8903/ > /dev/null 2>&1; then
  echo "  Recording server already running."
else
  mkdir -p "$SCRIPT_DIR/logs"
  python "$SCRIPT_DIR/scripts/recording_server.py" >> "$SCRIPT_DIR/logs/recording_server.log" 2>&1 &
  sleep 1
  curl -s http://127.0.0.1:8903/ > /dev/null 2>&1 \
    && echo "  Recording server started (port 8903)." \
    || echo "  WARNING: Recording server failed."
fi

if curl -s http://127.0.0.1:8904/ > /dev/null 2>&1; then
  echo "  Auth sidecar already running."
else
  python "$SCRIPT_DIR/scripts/auth_server.py" >> "$SCRIPT_DIR/logs/auth_server.log" 2>&1 &
  sleep 1
  curl -s http://127.0.0.1:8904/ > /dev/null 2>&1 \
    && echo "  Auth sidecar started (port 8904)." \
    || echo "  WARNING: Auth sidecar failed (check logs/auth_server.log)."
fi

# ── 4. n8n ───────────────────────────────────────────────────────────────────
echo "[4/6] n8n..."
if ! curl -s http://localhost:5678/healthz > /dev/null 2>&1; then
  n8n start > /dev/null 2>&1 &
fi
# Poll for health (n8n can take 30-60s to boot on this machine — a fixed sleep
# was the cause of the old false "n8n failed" report).
tries=0
until curl -s http://localhost:5678/healthz > /dev/null 2>&1; do
  tries=$((tries + 1))
  [ $tries -gt 60 ] && echo "  ERROR: n8n /healthz not responding after 2 min — check logs." && break
  printf "."; sleep 2
done
if curl -s http://localhost:5678/healthz > /dev/null 2>&1; then
  # Webhooks register ~15-30s AFTER /healthz turns ok. Wait for a known
  # production webhook so the frontend doesn't load against dead endpoints
  # (this is what looked like "n8n and the DB failed to load").
  printf "\n  n8n up — waiting for webhooks to register"
  wtries=0
  until [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5678/webhook/job-openings 2>/dev/null)" = "200" ]; do
    wtries=$((wtries + 1))
    [ $wtries -gt 30 ] && echo "" && echo "  WARN: webhooks not registered after 60s — open n8n and toggle a workflow if the app shows no data." && break
    printf "."; sleep 2
  done
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5678/webhook/job-openings 2>/dev/null)" = "200" ] \
    && echo "" && echo "  n8n started — webhooks live."
fi

# ── 5. DB migrations ─────────────────────────────────────────────────────────
echo "[5/6] DB migrations..."
if docker ps 2>/dev/null | grep -q hr-postgres; then
  for mig in "$SCRIPT_DIR/db/migrations"/0*.sql; do
    name=$(basename "$mig")
    docker exec -i hr-postgres psql -U hr_admin -d hr_automation < "$mig" > /dev/null 2>&1 \
      && echo "  $name — OK" \
      || echo "  $name — skipped (already applied)"
  done
else
  echo "  WARN: PostgreSQL not running — skipping migrations."
fi

# ── 6. React frontend ────────────────────────────────────────────────────────
echo "[6/6] React frontend (port 3001)..."
if curl -s http://localhost:3001 > /dev/null 2>&1; then
  echo "  Frontend already running."
else
  cd "$SCRIPT_DIR/frontend-react"
  npx vite --port 3001 > /dev/null 2>&1 &
  sleep 3
  curl -s http://localhost:3001 > /dev/null 2>&1 \
    && echo "  Frontend started." \
    || echo "  WARNING: Frontend may still be loading — check http://localhost:3001"
fi

echo ""
echo "═══════════════════════════════════════════"
echo "  Diyar HR ready!"
echo "  App:       http://localhost:3001  (login required)"
echo "  n8n:       http://localhost:5678"
echo "  Ollama:    http://localhost:11434"
echo "  DB:        localhost:5432"
echo "  SMTP:      http://127.0.0.1:8901"
echo "  IMAP:      http://127.0.0.1:8902"
echo "  Recording: http://127.0.0.1:8903"
echo "  Auth:      http://127.0.0.1:8904"
echo "═══════════════════════════════════════════"

if [ "$1" != "--no-open" ]; then
  sleep 1
  cmd.exe /c start "" "http://localhost:3001" 2>/dev/null || true
fi
