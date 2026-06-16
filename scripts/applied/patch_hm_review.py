#!/usr/bin/env python3
"""WF3 (Shortlist): (1) add hm_verdict/hm_notes/hm_reviewed_at to the shortlist
GET SELECT; (2) add POST /shortlist-hm-review to log the hiring manager's
final-interview verdict + notes. Patches entity + history. Restart n8n after.
"""
import sqlite3, json, pathlib

DB = pathlib.Path("D:/n8n/.n8n/database.sqlite")
WF_ID = "3"

# New SELECT (adds hm_* columns) for the ListSL - Build Query code node.
NEW_BUILD_JS = (
    "const query = $input.first().json.query || {};\n"
    "const jobId = parseInt(query.job_id);\n"
    "if (!jobId || isNaN(jobId) || jobId < 1) {\n"
    "  return [{ json: { error: true, message: 'Valid job_id query parameter is required', status: 400 } }];\n"
    "}\n"
    "return [{ json: { error: false, sql: \"SELECT s.id, s.candidate_id, s.job_opening_id, s.status, s.notes, s.shortlisted_at, s.updated_at, s.hm_verdict, s.hm_notes, s.hm_reviewed_at, c.candidate_name, c.email, c.cv_text, c.cv_file_name, c.submitted_at, e.overall_score, e.skills_score, e.experience_score, e.education_score, e.reasoning, e.strengths, e.weaknesses, e.evaluated_at FROM shortlist s INNER JOIN candidates c ON c.id = s.candidate_id LEFT JOIN evaluations e ON e.candidate_id = s.candidate_id AND e.job_opening_id = s.job_opening_id WHERE s.job_opening_id = \" + jobId + \" ORDER BY CASE s.status WHEN 'shortlisted' THEN 1 WHEN 'interviewed' THEN 2 WHEN 'hired' THEN 3 WHEN 'rejected' THEN 4 END, e.overall_score DESC\" } }];"
)

# New endpoint nodes for POST /shortlist-hm-review.
HM_BUILD_JS = (
    "const b = $input.first().json.body || {};\n"
    "const esc = s => String(s == null ? '' : s).replace(/'/g, \"''\");\n"
    "const id = parseInt(b.id);\n"
    "const candId = parseInt(b.candidate_id);\n"
    "const jobId = parseInt(b.job_opening_id);\n"
    "const verdict = ['hire','hold','reject'].includes((b.verdict||'').toLowerCase()) ? b.verdict.toLowerCase() : null;\n"
    "const notes = esc(b.notes || '');\n"
    "let where;\n"
    "if (id && !isNaN(id)) where = 'id = ' + id;\n"
    "else if (candId && jobId) where = 'candidate_id = ' + candId + ' AND job_opening_id = ' + jobId;\n"
    "else return [{ json: { error: true, message: 'id or candidate_id+job_opening_id required' } }];\n"
    "const sql = \"UPDATE shortlist SET hm_verdict = \" + (verdict ? \"'\" + verdict + \"'\" : 'hm_verdict') + \", hm_notes = '\" + notes + \"', hm_reviewed_at = NOW() WHERE \" + where + ' RETURNING id, hm_verdict, hm_notes, hm_reviewed_at';\n"
    "return [{ json: { error: false, sql } }];"
)

NEW_NODES = [
    {"parameters": {"httpMethod": "POST", "path": "shortlist-hm-review", "responseMode": "responseNode", "options": {}},
     "id": "wh-hm-review", "name": "HMReview - Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [250, 1100], "webhookId": "shortlist-hm-review"},
    {"parameters": {"jsCode": HM_BUILD_JS},
     "id": "build-hm-review", "name": "HMReview - Build", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [470, 1100]},
    {"parameters": {"operation": "executeQuery", "query": "={{ $json.sql }}", "options": {}},
     "id": "update-hm-review", "name": "HMReview - Update", "type": "n8n-nodes-base.postgres", "typeVersion": 2.5, "position": [690, 1100], "alwaysOutputData": True,
     "credentials": {"postgres": {"id": "1", "name": "HR PostgreSQL"}}},
    {"parameters": {"respondWith": "json", "responseBody": "={{ JSON.stringify({ success: true, data: $input.first().json }) }}", "options": {"responseCode": 200}},
     "id": "resp-hm-review", "name": "HMReview - Respond", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [910, 1100]},
]
NEW_CONNS = {
    "HMReview - Webhook": {"main": [[{"node": "HMReview - Build", "type": "main", "index": 0}]]},
    "HMReview - Build": {"main": [[{"node": "HMReview - Update", "type": "main", "index": 0}]]},
    "HMReview - Update": {"main": [[{"node": "HMReview - Respond", "type": "main", "index": 0}]]},
}


def patch(nodes, conns):
    for n in nodes:
        if n["name"] == "ListSL - Build Query":
            n["parameters"]["jsCode"] = NEW_BUILD_JS
    if not any(n["id"] == "wh-hm-review" for n in nodes):
        nodes.extend(NEW_NODES)
    for k, v in NEW_CONNS.items():
        conns.setdefault(k, v)
    return nodes, conns


conn = sqlite3.connect(str(DB))
try:
    row = conn.execute("SELECT nodes, connections, activeVersionId FROM workflow_entity WHERE id=?", (WF_ID,)).fetchone()
    nodes, conns = patch(json.loads(row[0]), json.loads(row[1]))
    conn.execute("UPDATE workflow_entity SET nodes=?, connections=? WHERE id=?", (json.dumps(nodes), json.dumps(conns), WF_ID))
    ver = row[2]
    hist = conn.execute("SELECT nodes, connections FROM workflow_history WHERE versionId=?", (ver,)).fetchone()
    hnodes, hconns = patch(json.loads(hist[0]), json.loads(hist[1] or "{}"))
    conn.execute("UPDATE workflow_history SET nodes=?, connections=? WHERE versionId=?", (json.dumps(hnodes), json.dumps(hconns), ver))
    conn.commit()
    print(f"patched WF{WF_ID} (entity+history, versionId={ver}) — restart n8n")
finally:
    conn.close()
