#!/bin/bash
# Seed the HR database with sample data

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DB_DIR="$PROJECT_DIR/db"

CONTAINER_NAME="hr-postgres"
DB_NAME="hr_automation"
DB_USER="hr_admin"

echo "=== Seeding HR Database ==="

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "ERROR: PostgreSQL container is not running. Run setup-db.sh first."
    exit 1
fi

docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" < "$DB_DIR/seed.sql"

echo "Seed data inserted."
echo ""
echo "Verifying:"
docker exec "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT id, job_title, department, status, is_active FROM job_openings;"
