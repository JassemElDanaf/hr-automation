#!/bin/sh
# n8n startup entrypoint — patch + import workflows, then start n8n.
# Runs inside the n8nio/n8n container.
set -e

OLLAMA_HOST="${OLLAMA_DOCKER_HOST:-ollama}"
SIDECAR="${SIDECAR_DOCKER_HOST:-sidecars}"

# ── Build N8N_CREDENTIALS_OVERWRITE_DATA from individual env vars ─────────────
# This injects the Postgres connection into all postgres-type credentials so
# workflows connect to the Docker postgres service without manual UI setup.
export N8N_CREDENTIALS_OVERWRITE_DATA="{\"postgres\":{\"host\":\"${DB_HOST:-postgres}\",\"port\":${DB_PORT:-5432},\"database\":\"${DB_NAME:-hr_automation}\",\"user\":\"${DB_USER:-hr_admin}\",\"password\":\"${DB_PASS:-hr_pass}\",\"ssl\":\"disable\"}}"

# ── Patch workflow JSONs for Docker networking ────────────────────────────────
# n8n runs inside Docker — localhost:11434 (Ollama) and 127.0.0.1:8901 (SMTP
# sidecar) resolve to the n8n container itself, not the correct services.
# sed-replace these with the Docker service hostnames before importing.
PATCH_DIR="/tmp/workflows-patched"
mkdir -p "$PATCH_DIR"

find /workflows -name '*.json' -type f | while IFS= read -r f; do
  # Flatten to a single filename: phase1-job-opening.json etc.
  dir_name=$(basename "$(dirname "$f")")
  base_name=$(basename "$f")
  out="$PATCH_DIR/${dir_name}__${base_name}"
  sed \
    -e "s|http://localhost:11434|http://${OLLAMA_HOST}:11434|g" \
    -e "s|http://127.0.0.1:11434|http://${OLLAMA_HOST}:11434|g" \
    -e "s|http://127.0.0.1:8901|http://${SIDECAR}:8901|g" \
    -e "s|http://127.0.0.1:8902|http://${SIDECAR}:8902|g" \
    -e "s|http://127.0.0.1:8903|http://${SIDECAR}:8903|g" \
    -e "s|http://127.0.0.1:8904|http://${SIDECAR}:8904|g" \
    "$f" > "$out"
done

# ── Import workflows (idempotent — upserts by workflow name) ──────────────────
echo "[n8n-setup] Importing workflows from /workflows..."
for f in "$PATCH_DIR"/*.json; do
  [ -f "$f" ] || continue
  echo "  $(basename "$f")"
  n8n import:workflow --input="$f" 2>&1 || echo "  WARN: import returned non-zero for $f"
done
echo "[n8n-setup] Workflow import done."

# ── Start n8n ─────────────────────────────────────────────────────────────────
echo "[n8n-setup] Starting n8n..."
exec n8n start
