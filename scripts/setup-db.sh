#!/bin/bash
# Setup PostgreSQL database for HR Automation
# Requires: Docker running, postgres container "hr-postgres"

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DB_DIR="$PROJECT_DIR/db"

# Configuration
CONTAINER_NAME="hr-postgres"
DB_NAME="hr_automation"
DB_USER="hr_admin"
DB_PASSWORD="hr_pass"
DB_PORT="5432"

echo "=== HR Automation Database Setup ==="

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "ERROR: Docker is not running. Please start Docker Desktop."
    exit 1
fi

# Check if container exists
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Container '$CONTAINER_NAME' already exists."
    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo "Starting container..."
        docker start "$CONTAINER_NAME"
    fi
else
    echo "Creating PostgreSQL container..."
    docker run -d \
        --name "$CONTAINER_NAME" \
        -e POSTGRES_USER="$DB_USER" \
        -e POSTGRES_PASSWORD="$DB_PASSWORD" \
        -e POSTGRES_DB="$DB_NAME" \
        -p "$DB_PORT:5432" \
        -v hr_pgdata:/var/lib/postgresql/data \
        postgres:16-alpine
fi

echo "Waiting for PostgreSQL to be ready..."
for i in {1..30}; do
    if docker exec "$CONTAINER_NAME" pg_isready -U "$DB_USER" > /dev/null 2>&1; then
        echo "PostgreSQL is ready!"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "ERROR: PostgreSQL failed to start after 30 seconds"
        exit 1
    fi
    sleep 1
done

# Run schema
echo "Applying schema..."
docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" < "$DB_DIR/schema.sql"

echo ""
echo "=== Database setup complete ==="
echo "Connection: postgresql://$DB_USER:$DB_PASSWORD@localhost:$DB_PORT/$DB_NAME"
echo ""
echo "To seed test data: bash $SCRIPT_DIR/seed-db.sh"
