#!/usr/bin/env python3
"""WF4: pass `html_body` through /send-email to the SMTP sidecar — 2026-06-12.

The frontend now sends a styled HTML version of every email alongside the
plain text (multipart/alternative). The plain body remains what is logged in
email_log. Patches BOTH workflow_entity and workflow_history. Restart n8n.
"""
import sqlite3, json, pathlib

DB = pathlib.Path("D:/n8n/.n8n/database.sqlite")
WF_ID = "4"

OLD_TAIL = (
    "return [{ json: { error: false, candidate_id: candidateId, job_opening_id: jobId, "
    "email_type: emailType, recipient_email: recipientEmail, candidate_name: candidateName, "
    "job_title: jobTitle, subject: subject, body: emailBody, log_body: logBody, "
    "attachments: attachments, recording_file: recordingFile } }];"
)
NEW_TAIL = (
    "const htmlBody = typeof body.html_body === 'string' ? body.html_body.slice(0, 300000) : '';\n"
    "return [{ json: { error: false, candidate_id: candidateId, job_opening_id: jobId, "
    "email_type: emailType, recipient_email: recipientEmail, candidate_name: candidateName, "
    "job_title: jobTitle, subject: subject, body: emailBody, log_body: logBody, "
    "attachments: attachments, recording_file: recordingFile, html_body: htmlBody } }];"
)

BRIDGE_BODY = (
    "={{ JSON.stringify({ to: $json.recipient_email, subject: $json.subject, body: $json.body, "
    "attachments: $json.attachments || [], recording_file: $json.recording_file || '', "
    "html_body: $json.html_body || '' }) }}"
)


def patch(nodes):
    for n in nodes:
        if n["name"] == "Send - Validate & Build Email":
            js = n["parameters"]["jsCode"]
            if "html_body: htmlBody" in js:
                continue
            assert OLD_TAIL in js, "validate return shape changed — update patch"
            n["parameters"]["jsCode"] = js.replace(OLD_TAIL, NEW_TAIL)
        elif n["name"] == "Send - Via SMTP Bridge":
            n["parameters"]["jsonBody"] = BRIDGE_BODY
    return nodes


conn = sqlite3.connect(str(DB))
try:
    row = conn.execute("SELECT nodes, activeVersionId FROM workflow_entity WHERE id=?", (WF_ID,)).fetchone()
    nodes, ver = patch(json.loads(row[0])), row[1]
    conn.execute("UPDATE workflow_entity SET nodes=? WHERE id=?", (json.dumps(nodes), WF_ID))
    hist = conn.execute("SELECT nodes FROM workflow_history WHERE versionId=?", (ver,)).fetchone()
    hnodes = patch(json.loads(hist[0]))
    conn.execute("UPDATE workflow_history SET nodes=? WHERE versionId=?", (json.dumps(hnodes), ver))
    conn.commit()
    print(f"patched WF{WF_ID} (entity + history, versionId={ver}) — restart n8n")
finally:
    conn.close()
