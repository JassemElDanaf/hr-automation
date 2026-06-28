#!/bin/bash
# Runs inside the postgres:16 container on first init (empty data volume).
# Applies schema.sql then all numbered migrations in order, then loads demo
# data from db/demo-data.sql if present (so every fresh Docker pull starts
# with the same candidates, CVs, jobs, emails, and interview sessions).
# ON_ERROR_STOP=0 lets us re-run idempotently (ALTER TABLE IF NOT EXISTS etc.).
set -e

PSQL="psql -v ON_ERROR_STOP=0 -U $POSTGRES_USER -d $POSTGRES_DB"

echo "[pg-init] Applying schema..."
$PSQL -f /docker-initdb/schema.sql

echo "[pg-init] Applying migrations..."
for f in $(ls /docker-initdb/migrations/*.sql 2>/dev/null | sort); do
  echo "  $(basename "$f")"
  $PSQL -f "$f" || true
done

# Load demo / seed data if the file was committed to the repo.
# The dump is data-only (schema already applied above) and uses COPY with
# session_replication_role=replica so FK ordering doesn't matter.
if [ -f /docker-initdb/demo-data.sql ]; then
  echo "[pg-init] Loading demo data from demo-data.sql..."
  $PSQL -f /docker-initdb/demo-data.sql
  echo "[pg-init] Demo data loaded."
fi

echo "[pg-init] Database ready."
