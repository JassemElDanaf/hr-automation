#!/bin/bash
# Import n8n workflows from JSON files
# Requires: n8n running

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WORKFLOW_DIR="$PROJECT_DIR/workflows/phase1-job-opening"
N8N_URL="http://localhost:5678"

echo "=== Importing n8n Workflows ==="
echo ""

for file in "$WORKFLOW_DIR"/*.json; do
    name=$(basename "$file" .json)
    echo -n "Importing: $name... "

    response=$(curl -s -w "\n%{http_code}" -X POST "$N8N_URL/api/v1/workflows" \
        -H "Content-Type: application/json" \
        -d @"$file" 2>/dev/null)

    code=$(echo "$response" | tail -1)

    if [ "$code" = "200" ] || [ "$code" = "201" ]; then
        echo "OK"
    else
        echo "WARN (HTTP $code) — you may need to import manually via n8n UI"
    fi
done

echo ""
echo "=== Import complete ==="
echo "Open n8n at $N8N_URL to verify and activate workflows."
echo ""
echo "IMPORTANT: After import, you must:"
echo "  1. Configure the PostgreSQL credential in n8n (Settings > Credentials)"
echo "  2. Activate each workflow"
