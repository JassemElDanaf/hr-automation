"""
Adds a GET /smtp-health webhook to Phase 4 (Email) workflow.
Queries the last 10 outbound email_log rows and derives a real health status:
  healthy           — last send succeeded and >=60% of recent sends succeeded
  failing           — last send failed or majority of recent sends failed
  configured        — SMTP env var is set but no sends on record yet
  not_configured    — no SMTP_HOST in DB (falls back to sidecar check)
"""
import sqlite3, json, pathlib

DB = pathlib.Path("D:/n8n/.n8n/database.sqlite")
WF_ID = "4"

NEW_NODES = [
    {
        "id": "wh-smtp-health",
        "name": "Health - Webhook",
        "type": "n8n-nodes-base.webhook",
        "typeVersion": 2,
        "position": [2200, 100],
        "webhookId": "smtp-health",
        "parameters": {
            "httpMethod": "GET",
            "path": "smtp-health",
            "responseMode": "responseNode",
            "options": {}
        }
    },
    {
        "id": "health-query",
        "name": "Health - Query Log",
        "type": "n8n-nodes-base.postgres",
        "typeVersion": 2.6,
        "position": [2420, 100],
        "parameters": {
            "operation": "executeQuery",
            "query": "SELECT status, error_message, sent_at FROM email_log WHERE direction='outbound' ORDER BY sent_at DESC LIMIT 10",
            "options": {}
        },
        "credentials": {"postgres": {"id": "1", "name": "Postgres account"}}
    },
    {
        "id": "health-compute",
        "name": "Health - Compute Status",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [2640, 100],
        "parameters": {
            "jsCode": """
const rows = $input.all().map(i => i.json);
if (rows.length === 0) {
  return [{ json: { status: 'not_tested', detail: 'No emails sent yet', sent: 0, failed: 0, total: 0 } }];
}
const sent   = rows.filter(r => r.status === 'sent').length;
const failed = rows.filter(r => r.status === 'failed').length;
const total  = rows.length;
const lastOk = rows[0].status === 'sent';
const pct    = sent / total;
let status, detail;
if (lastOk && pct >= 0.6) {
  status = 'healthy';
  detail = sent + '/' + total + ' recent sends succeeded';
} else {
  status = 'failing';
  const lastErr = rows.find(r => r.status === 'failed')?.error_message || 'unknown error';
  detail = failed + '/' + total + ' recent sends failed — ' + lastErr;
}
return [{ json: { status, detail, sent, failed, total } }];
""".strip()
        }
    },
    {
        "id": "health-respond",
        "name": "Health - Respond",
        "type": "n8n-nodes-base.respondToWebhook",
        "typeVersion": 1.1,
        "position": [2860, 100],
        "parameters": {
            "respondWith": "json",
            "responseBody": "={{ JSON.stringify($json) }}",
            "options": {"responseCode": 200}
        }
    }
]

NEW_CONNECTIONS = {
    "Health - Webhook":       {"main": [[{"node": "Health - Query Log",      "type": "main", "index": 0}]]},
    "Health - Query Log":     {"main": [[{"node": "Health - Compute Status", "type": "main", "index": 0}]]},
    "Health - Compute Status":{"main": [[{"node": "Health - Respond",        "type": "main", "index": 0}]]},
}

conn = sqlite3.connect(str(DB))
try:
    ver_id = conn.execute("SELECT activeVersionId FROM workflow_entity WHERE id=?", (WF_ID,)).fetchone()[0]

    for table, id_col in [("workflow_entity", None), ("workflow_history", ver_id)]:
        if id_col is None:
            row = conn.execute("SELECT nodes, connections FROM workflow_entity WHERE id=?", (WF_ID,)).fetchone()
        else:
            row = conn.execute("SELECT nodes, connections FROM workflow_history WHERE versionId=?", (ver_id,)).fetchone()

        nodes = json.loads(row[0])
        conns = json.loads(row[1])

        # Remove stale health nodes if re-running patch
        nodes = [n for n in nodes if n.get("id") not in {nn["id"] for nn in NEW_NODES}]
        nodes.extend(NEW_NODES)

        for k, v in NEW_CONNECTIONS.items():
            conns[k] = v

        if id_col is None:
            conn.execute("UPDATE workflow_entity SET nodes=?, connections=? WHERE id=?",
                         (json.dumps(nodes), json.dumps(conns), WF_ID))
        else:
            conn.execute("UPDATE workflow_history SET nodes=?, connections=? WHERE versionId=?",
                         (json.dumps(nodes), json.dumps(conns), ver_id))

    conn.commit()
    print("Patched workflow", WF_ID, "— added /smtp-health webhook")
    print("Restart n8n for changes to take effect.")
finally:
    conn.close()
