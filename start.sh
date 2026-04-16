#!/bin/bash
# HR Automation - Start All Services
# Run this script to start all required services

export PATH="/c/Users/Jasse/AppData/Roaming/npm:/e/NodeJS:$PATH"
export N8N_USER_MANAGEMENT_DISABLED=true
export OLLAMA_MODELS=/e/ollama

# Load local config (.env) — holds SMTP creds, any local overrides.
# Keeps secrets out of this script and out of git.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  . "$SCRIPT_DIR/.env"
  set +a
  echo "  Loaded config from .env"
fi

echo "Starting HR Automation services..."

# 0. Ensure Docker Desktop is running (launches it if needed, waits up to 2 min for daemon)
echo "[0/5] Checking Docker Desktop..."
if docker info > /dev/null 2>&1; then
  echo "  Docker daemon is ready."
else
  DOCKER_DESKTOP="/c/Program Files/Docker/Docker/Docker Desktop.exe"
  if [ -f "$DOCKER_DESKTOP" ]; then
    echo "  Docker daemon not reachable. Launching Docker Desktop..."
    "$DOCKER_DESKTOP" > /dev/null 2>&1 &
    disown 2>/dev/null || true
    tries=0
    until docker info > /dev/null 2>&1; do
      tries=$((tries + 1))
      if [ $tries -gt 60 ]; then
        echo "  ERROR: Docker daemon didn't come up after 2 minutes."
        break
      fi
      printf "."
      sleep 2
    done
    echo ""
    if docker info > /dev/null 2>&1; then echo "  Docker daemon ready."; fi
  else
    echo "  WARNING: Docker Desktop not found at $DOCKER_DESKTOP — install Docker Desktop or start it manually."
  fi
fi

# 1. PostgreSQL container
echo "[1/5] Checking PostgreSQL..."
if docker ps 2>/dev/null | grep -q hr-postgres; then
  echo "  PostgreSQL is running."
else
  echo "  Starting PostgreSQL..."
  docker start hr-postgres 2>/dev/null || echo "  WARNING: hr-postgres container not found. Run: docker run -d --name hr-postgres -e POSTGRES_USER=hr_admin -e POSTGRES_PASSWORD=hr_pass -e POSTGRES_DB=hr_automation -p 5432:5432 postgres:16"
fi

# 2. Start Ollama
echo "[2/5] Starting Ollama (qwen3:4b)..."
if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo "  Ollama already running."
else
  /e/ollama/program/ollama.exe serve > /dev/null 2>&1 &
  sleep 3
  if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "  Ollama started."
  else
    echo "  WARNING: Ollama failed to start."
  fi
fi

# 3. Start SMTP sidecar
echo "[3/5] Starting SMTP sidecar..."
if curl -s http://127.0.0.1:8901/ > /dev/null 2>&1; then
  echo "  SMTP sidecar already running."
else
  # SMTP_HOST etc. can be set in the environment before running start.sh
  # If unset, sidecar runs in log-only mode
  python "$(dirname "$0")/scripts/smtp_server.py" > /dev/null 2>&1 &
  sleep 1
  if curl -s http://127.0.0.1:8901/ > /dev/null 2>&1; then
    echo "  SMTP sidecar started on port 8901."
  else
    echo "  WARNING: SMTP sidecar failed to start."
  fi
fi

# 4. Start n8n
echo "[4/5] Starting n8n..."
if curl -s http://localhost:5678/healthz > /dev/null 2>&1; then
  echo "  n8n already running."
else
  npx n8n start > /dev/null 2>&1 &
  sleep 6
  if curl -s http://localhost:5678/healthz > /dev/null 2>&1; then
    echo "  n8n started."
  else
    echo "  WARNING: n8n failed to start. Waiting longer..."
    sleep 5
    curl -s http://localhost:5678/healthz > /dev/null 2>&1 && echo "  n8n started." || echo "  ERROR: n8n not responding."
  fi
fi

# 5. Start frontend server
echo "[5/5] Starting frontend server..."
if curl -s http://localhost:3000 > /dev/null 2>&1; then
  echo "  Frontend already running."
else
  cd "$(dirname "$0")/frontend"
  npx serve -l 3000 -s . > /dev/null 2>&1 &
  sleep 2
  echo "  Frontend started."
fi

echo ""
echo "All services started!"
echo "  Frontend:    http://localhost:3000"
echo "  n8n:         http://localhost:5678"
echo "  Ollama:      http://localhost:11434"
echo "  PostgreSQL:  localhost:5432"
echo "  SMTP bridge: http://127.0.0.1:8901"

# Open the frontend in the default browser (first run after a cold boot).
# Pass --no-open to skip, e.g. ./start.sh --no-open
if [ "$1" != "--no-open" ]; then
  sleep 1
  start "" "http://localhost:3000" 2>/dev/null || cmd.exe /c start "" "http://localhost:3000" 2>/dev/null || true
fi
