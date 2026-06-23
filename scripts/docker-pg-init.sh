#!/bin/bash
# Runs inside the postgres:16 container on first init (empty data volume).
# Applies schema.sql then all numbered migrations in order.
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

echo "[pg-init] Database ready."
