#!/bin/bash
# Import Phase 6 - Live Interview workflow into n8n
# Requires: n8n running at http://localhost:5678

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WORKFLOW_FILE="$PROJECT_DIR/workflows/phase6-interview/phase6-interview.json"
N8N_URL="http://localhost:5678"

echo "=== Importing Phase 6 - Live Interview Workflow ==="

if [ ! -f "$WORKFLOW_FILE" ]; then
  echo "ERROR: Workflow file not found at $WORKFLOW_FILE"
  exit 1
fi

response=$(curl -s -w "\n%{http_code}" -X POST "$N8N_URL/api/v1/workflows" \
    -H "Content-Type: application/json" \
    -d @"$WORKFLOW_FILE" 2>/dev/null)

code=$(echo "$response" | tail -1)
body=$(echo "$response" | head -n -1)

if [ "$code" = "200" ] || [ "$code" = "201" ]; then
  echo "Import OK (HTTP $code)"
  # Try to extract and activate the workflow
  wf_id=$(echo "$body" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)
  if [ -n "$wf_id" ]; then
    echo "  Workflow ID: $wf_id — activating..."
    curl -s -X PATCH "$N8N_URL/api/v1/workflows/$wf_id" \
      -H "Content-Type: application/json" \
      -d '{"active": true}' > /dev/null 2>&1 && echo "  Activated." || echo "  Activate manually in n8n UI."
  fi
else
  echo "WARN (HTTP $code) — import may have failed. Try importing manually via n8n UI at $N8N_URL"
  echo "  Body: $(echo "$body" | head -c 200)"
fi

echo ""
echo "=== DB Migrations needed (run once against hr_automation database) ==="
echo "  psql -U hr_admin -d hr_automation -f $PROJECT_DIR/db/migrations/010-interview-questions.sql"
echo "  psql -U hr_admin -d hr_automation -f $PROJECT_DIR/db/migrations/011-interview-sessions.sql"
echo ""
echo "  Or via Docker:"
echo "  docker exec -i hr-postgres psql -U hr_admin -d hr_automation < $PROJECT_DIR/db/migrations/010-interview-questions.sql"
echo "  docker exec -i hr-postgres psql -U hr_admin -d hr_automation < $PROJECT_DIR/db/migrations/011-interview-sessions.sql"
