#!/usr/bin/env python3
"""Add GET /talent-pool (WF5) and email-attachment passthrough (WF4) — 2026-06-11.

WF5: new webhook chain Talent - Webhook -> Talent - Fetch -> Talent - Response
returning every candidate with cv_text + job + eval + shortlist status, for the
Talent Pool tab's client-side Ctrl+F search.

WF4: /send-email now forwards `attachments` [{filename, content_b64, mime}]
(small files: CV pdf, generated report pdf) and `recording_file` (filename only
— the SMTP sidecar reads the webm from recordings/ itself so big videos never
travel through n8n's payload limit) to the sidecar, and logs attachment names
in email_log.body.

Patches BOTH workflow_entity and workflow_history. Restart n8n afterwards.
"""
import sqlite3, json, pathlib

DB = pathlib.Path("D:/n8n/.n8n/database.sqlite")

TALENT_SQL = (
    "SELECT c.id, c.candidate_name, c.email, c.submitted_at, c.cv_text, c.job_opening_id, "
    "j.job_title, j.department, e.overall_score, s.status AS shortlist_status, "
    "(c.cv_file_data IS NOT NULL AND length(c.cv_file_data) > 10) AS cv_file_available "
    "FROM candidates c "
    "JOIN job_openings j ON j.id = c.job_opening_id "
    "LEFT JOIN evaluations e ON e.candidate_id = c.id AND e.job_opening_id = c.job_opening_id "
    "LEFT JOIN shortlist s ON s.candidate_id = c.id AND s.job_opening_id = c.job_opening_id "
    "ORDER BY c.submitted_at DESC"
)

TALENT_NODES = [
    {
        "parameters": {"httpMethod": "GET", "path": "talent-pool", "responseMode": "responseNode", "options": {}},
        "id": "wh-talent-pool", "name": "Talent - Webhook", "type": "n8n-nodes-base.webhook",
        "typeVersion": 2, "position": [250, 700], "webhookId": "talent-pool",
    },
    {
        "parameters": {"operation": "executeQuery", "query": TALENT_SQL, "options": {}},
        "id": "fetch-talent-pool", "name": "Talent - Fetch", "type": "n8n-nodes-base.postgres",
        "typeVersion": 2.5, "position": [480, 700], "alwaysOutputData": True,
        "credentials": {"postgres": {"id": "1", "name": "HR PostgreSQL"}},
    },
    {
        "parameters": {
            "respondWith": "json",
            "responseBody": "={{ JSON.stringify({ success: true, data: $input.all().map(i => i.json).filter(i => i.id), count: $input.all().map(i => i.json).filter(i => i.id).length }) }}",
            "options": {"responseCode": 200},
        },
        "id": "resp-talent-pool", "name": "Talent - Response", "type": "n8n-nodes-base.respondToWebhook",
        "typeVersion": 1.1, "position": [700, 700],
    },
]

OLD_RETURN = (
    "return [{ json: { error: false, candidate_id: candidateId, job_opening_id: jobId, "
    "email_type: emailType, recipient_email: recipientEmail, candidate_name: candidateName, "
    "job_title: jobTitle, subject: subject, body: emailBody } }];"
)
NEW_RETURN = (
    "const attachments = Array.isArray(body.attachments) ? body.attachments.filter(a => a && a.filename && a.content_b64).slice(0, 5) : [];\n"
    "const recordingFile = (body.recording_file || '').trim();\n"
    "const attachNames = attachments.map(a => a.filename).concat(recordingFile ? [recordingFile] : []);\n"
    "const logBody = emailBody + (attachNames.length ? '\\n\\n[Attached: ' + attachNames.join(', ') + ']' : '');\n"
    "return [{ json: { error: false, candidate_id: candidateId, job_opening_id: jobId, "
    "email_type: emailType, recipient_email: recipientEmail, candidate_name: candidateName, "
    "job_title: jobTitle, subject: subject, body: emailBody, log_body: logBody, "
    "attachments: attachments, recording_file: recordingFile } }];"
)

BRIDGE_BODY = (
    "={{ JSON.stringify({ to: $json.recipient_email, subject: $json.subject, body: $json.body, "
    "attachments: $json.attachments || [], recording_file: $json.recording_file || '' }) }}"
)


def patch_wf4(nodes):
    for n in nodes:
        if n["name"] == "Send - Validate & Build Email":
            js = n["parameters"]["jsCode"]
            if NEW_RETURN.splitlines()[0] in js:
                continue  # already patched
            assert OLD_RETURN in js, "WF4 validate return shape changed — update patch"
            n["parameters"]["jsCode"] = js.replace(OLD_RETURN, NEW_RETURN)
        elif n["name"] == "Send - Via SMTP Bridge":
            n["parameters"]["jsonBody"] = BRIDGE_BODY
        elif n["name"] == "Send - Log Result":
            qr = n["parameters"]["options"]["queryReplacement"]
            n["parameters"]["options"]["queryReplacement"] = qr.replace(
                "$('Send - Validate & Build Email').item.json.body,",
                "($('Send - Validate & Build Email').item.json.log_body || $('Send - Validate & Build Email').item.json.body),",
            )
    return nodes


def patch_wf5(nodes, conns):
    if not any(n["id"] == "wh-talent-pool" for n in nodes):
        nodes.extend(TALENT_NODES)
    conns.setdefault("Talent - Webhook", {"main": [[{"node": "Talent - Fetch", "type": "main", "index": 0}]]})
    conns.setdefault("Talent - Fetch", {"main": [[{"node": "Talent - Response", "type": "main", "index": 0}]]})
    return nodes, conns


conn = sqlite3.connect(str(DB))
try:
    for wf_id, fn in (("4", "wf4"), ("5", "wf5")):
        row = conn.execute(
            "SELECT nodes, connections, activeVersionId FROM workflow_entity WHERE id=?", (wf_id,)
        ).fetchone()
        nodes, conns, ver = json.loads(row[0]), json.loads(row[1]), row[2]
        if fn == "wf4":
            nodes = patch_wf4(nodes)
        else:
            nodes, conns = patch_wf5(nodes, conns)
        conn.execute(
            "UPDATE workflow_entity SET nodes=?, connections=? WHERE id=?",
            (json.dumps(nodes), json.dumps(conns), wf_id),
        )
        hist = conn.execute("SELECT nodes, connections FROM workflow_history WHERE versionId=?", (ver,)).fetchone()
        hnodes, hconns = json.loads(hist[0]), json.loads(hist[1] or "{}")
        if fn == "wf4":
            hnodes = patch_wf4(hnodes)
        else:
            hnodes, hconns = patch_wf5(hnodes, hconns)
        conn.execute(
            "UPDATE workflow_history SET nodes=?, connections=? WHERE versionId=?",
            (json.dumps(hnodes), json.dumps(hconns), ver),
        )
        print(f"patched WF{wf_id} (entity + history, versionId={ver})")
    conn.commit()
    print("Done. Restart n8n.")
finally:
    conn.close()
