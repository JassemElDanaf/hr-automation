"""
Adds three candidate-questions endpoints to Phase 6 (Live Interview) workflow:
  POST /candidate-questions       — upsert questions for (candidate_id, job_opening_id)
  GET  /candidate-questions       — fetch questions for a candidate+job pair
  GET  /candidate-questions-list  — list all candidates with prep questions for a job
"""
import sqlite3, json, pathlib

DB     = pathlib.Path("D:/n8n/.n8n/database.sqlite")
WF_ID  = "6"

PG_CRED = {"postgres": {"id": "1", "name": "HR PostgreSQL"}}

NEW_NODES = [
    # ── POST /candidate-questions (save/upsert) ────────────────────────────────
    {
        "id": "wh-cq-save", "name": "CQ Save - Webhook",
        "type": "n8n-nodes-base.webhook", "typeVersion": 2,
        "position": [250, 700],
        "webhookId": "candidate-questions-save",
        "parameters": {
            "httpMethod": "POST", "path": "candidate-questions",
            "responseMode": "responseNode", "options": {}
        }
    },
    {
        "id": "cq-save-code", "name": "CQ Save - Build Query",
        "type": "n8n-nodes-base.code", "typeVersion": 2,
        "position": [480, 700],
        "parameters": {
            "jsCode": r"""
const body = $input.first().json.body || $input.first().json || {};
const candidateId   = parseInt(body.candidate_id);
const jobOpeningId  = parseInt(body.job_opening_id);
const questions     = Array.isArray(body.questions)   ? body.questions   : [];
const notes         = Array.isArray(body.notes)       ? body.notes       : [];
const generalNotes  = String(body.general_notes || '').substring(0, 20000);
const meeting       = body.meeting || {};

if (!candidateId  || isNaN(candidateId))  return [{ json: { error: true, message: 'candidate_id required' } }];
if (!jobOpeningId || isNaN(jobOpeningId)) return [{ json: { error: true, message: 'job_opening_id required' } }];

function pgEsc(s) { return s.replace(/'/g, "''"); }

const qJson  = pgEsc(JSON.stringify(questions));
const nJson  = pgEsc(JSON.stringify(notes));
const gNotes = pgEsc(generalNotes);
const mJson  = pgEsc(JSON.stringify(meeting));

const sql = `INSERT INTO candidate_prepared_questions (candidate_id, job_opening_id, questions, notes, general_notes, meeting, updated_at) VALUES (${candidateId}, ${jobOpeningId}, '${qJson}'::jsonb, '${nJson}'::jsonb, '${gNotes}', '${mJson}'::jsonb, NOW()) ON CONFLICT (candidate_id, job_opening_id) DO UPDATE SET questions = EXCLUDED.questions, notes = EXCLUDED.notes, general_notes = EXCLUDED.general_notes, meeting = EXCLUDED.meeting, updated_at = NOW() RETURNING id, candidate_id, job_opening_id, updated_at`;

return [{ json: { sql, ok: true } }];
""".strip()
        }
    },
    {
        "id": "cq-save-pg", "name": "CQ Save - Upsert",
        "type": "n8n-nodes-base.postgres", "typeVersion": 2.5,
        "position": [710, 700],
        "parameters": {
            "operation": "executeQuery",
            "query": "={{ $json.sql }}",
            "options": {}
        },
        "credentials": PG_CRED
    },
    {
        "id": "cq-save-resp", "name": "CQ Save - Respond",
        "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1,
        "position": [940, 700],
        "parameters": {
            "respondWith": "json",
            "responseBody": "={{ JSON.stringify({ success: true, id: $input.first().json.id }) }}",
            "options": {"responseCode": 200}
        }
    },

    # ── GET /candidate-questions (fetch one) ───────────────────────────────────
    {
        "id": "wh-cq-get", "name": "CQ Get - Webhook",
        "type": "n8n-nodes-base.webhook", "typeVersion": 2,
        "position": [250, 900],
        "webhookId": "candidate-questions-get",
        "parameters": {
            "httpMethod": "GET", "path": "candidate-questions",
            "responseMode": "responseNode", "options": {}
        }
    },
    {
        "id": "cq-get-code", "name": "CQ Get - Validate",
        "type": "n8n-nodes-base.code", "typeVersion": 2,
        "position": [480, 900],
        "parameters": {
            "jsCode": r"""
const q = $input.first().json.query || {};
const candidateId  = parseInt(q.candidate_id);
const jobId        = parseInt(q.job_id);
if (!candidateId || !jobId) return [{ json: { error: true, message: 'candidate_id and job_id required' } }];
return [{ json: {
  sql: `SELECT id, candidate_id, job_opening_id, questions, notes, general_notes, meeting, updated_at FROM candidate_prepared_questions WHERE candidate_id = ${candidateId} AND job_opening_id = ${jobId} LIMIT 1`
} }];
""".strip()
        }
    },
    {
        "id": "cq-get-pg", "name": "CQ Get - Query",
        "type": "n8n-nodes-base.postgres", "typeVersion": 2.5,
        "position": [710, 900],
        "alwaysOutputData": True,
        "parameters": {
            "operation": "executeQuery",
            "query": "={{ $json.sql }}",
            "options": {}
        },
        "credentials": PG_CRED
    },
    {
        "id": "cq-get-resp", "name": "CQ Get - Respond",
        "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1,
        "position": [940, 900],
        "parameters": {
            "respondWith": "json",
            "responseBody": "={{ JSON.stringify($input.first().json) }}",
            "options": {"responseCode": 200}
        }
    },

    # ── GET /candidate-questions-list (list all for a job) ─────────────────────
    {
        "id": "wh-cq-list", "name": "CQ List - Webhook",
        "type": "n8n-nodes-base.webhook", "typeVersion": 2,
        "position": [250, 1100],
        "webhookId": "candidate-questions-list",
        "parameters": {
            "httpMethod": "GET", "path": "candidate-questions-list",
            "responseMode": "responseNode", "options": {}
        }
    },
    {
        "id": "cq-list-code", "name": "CQ List - Validate",
        "type": "n8n-nodes-base.code", "typeVersion": 2,
        "position": [480, 1100],
        "parameters": {
            "jsCode": r"""
const q = $input.first().json.query || {};
const jobId = parseInt(q.job_id);
if (!jobId) return [{ json: { error: true, message: 'job_id required' } }];
return [{ json: {
  sql: `SELECT cpq.id, cpq.candidate_id, cpq.job_opening_id, cpq.questions, cpq.updated_at, c.candidate_name, c.email, jo.job_title, jo.department FROM candidate_prepared_questions cpq JOIN candidates c ON c.id = cpq.candidate_id JOIN job_openings jo ON jo.id = cpq.job_opening_id WHERE cpq.job_opening_id = ${jobId} ORDER BY cpq.updated_at DESC`
} }];
""".strip()
        }
    },
    {
        "id": "cq-list-pg", "name": "CQ List - Query",
        "type": "n8n-nodes-base.postgres", "typeVersion": 2.5,
        "position": [710, 1100],
        "alwaysOutputData": True,
        "parameters": {
            "operation": "executeQuery",
            "query": "={{ $json.sql }}",
            "options": {}
        },
        "credentials": PG_CRED
    },
    {
        "id": "cq-list-resp", "name": "CQ List - Respond",
        "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1,
        "position": [940, 1100],
        "parameters": {
            "respondWith": "json",
            "responseBody": "={{ JSON.stringify($input.all().map(i => i.json).filter(r => r.candidate_id)) }}",
            "options": {"responseCode": 200}
        }
    },
]

NEW_CONNECTIONS = {
    "CQ Save - Webhook":      {"main": [[{"node": "CQ Save - Build Query", "type": "main", "index": 0}]]},
    "CQ Save - Build Query":  {"main": [[{"node": "CQ Save - Upsert",      "type": "main", "index": 0}]]},
    "CQ Save - Upsert":       {"main": [[{"node": "CQ Save - Respond",     "type": "main", "index": 0}]]},

    "CQ Get - Webhook":       {"main": [[{"node": "CQ Get - Validate",     "type": "main", "index": 0}]]},
    "CQ Get - Validate":      {"main": [[{"node": "CQ Get - Query",        "type": "main", "index": 0}]]},
    "CQ Get - Query":         {"main": [[{"node": "CQ Get - Respond",      "type": "main", "index": 0}]]},

    "CQ List - Webhook":      {"main": [[{"node": "CQ List - Validate",    "type": "main", "index": 0}]]},
    "CQ List - Validate":     {"main": [[{"node": "CQ List - Query",       "type": "main", "index": 0}]]},
    "CQ List - Query":        {"main": [[{"node": "CQ List - Respond",     "type": "main", "index": 0}]]},
}

conn = sqlite3.connect(str(DB))
try:
    ver_id = conn.execute(
        "SELECT activeVersionId FROM workflow_entity WHERE id=?", (WF_ID,)
    ).fetchone()[0]

    for table, key_col, key_val in [
        ("workflow_entity",  None,    None),
        ("workflow_history", "versionId", ver_id),
    ]:
        if key_col is None:
            row = conn.execute(
                "SELECT nodes, connections FROM workflow_entity WHERE id=?", (WF_ID,)
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT nodes, connections FROM workflow_history WHERE versionId=?", (ver_id,)
            ).fetchone()

        nodes = json.loads(row[0])
        conns = json.loads(row[1])

        # Remove stale versions of these nodes if re-running
        stale_ids = {n["id"] for n in NEW_NODES}
        nodes = [n for n in nodes if n.get("id") not in stale_ids]
        nodes.extend(NEW_NODES)

        for k, v in NEW_CONNECTIONS.items():
            conns[k] = v

        if key_col is None:
            conn.execute(
                "UPDATE workflow_entity SET nodes=?, connections=? WHERE id=?",
                (json.dumps(nodes), json.dumps(conns), WF_ID)
            )
        else:
            conn.execute(
                "UPDATE workflow_history SET nodes=?, connections=? WHERE versionId=?",
                (json.dumps(nodes), json.dumps(conns), ver_id)
            )

    conn.commit()
    print(f"Patched workflow {WF_ID} — added /candidate-questions, /candidate-questions (GET), /candidate-questions-list")
    print("Apply the DB migration first: docker exec -i hr-postgres psql -U hr_admin -d hr_automation < db/migrations/014-candidate-prepared-questions.sql")
    print("Restart n8n for changes to take effect.")
finally:
    conn.close()
