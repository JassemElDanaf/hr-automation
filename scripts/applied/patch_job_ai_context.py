"""
Injects optional HR keywords/guidance into the Phase 2 (Job Openings, WF id=1)
AI job-description prompt. The frontend now sends `ai_context` on the create
payload when "Generate with AI" is chosen; the validate node spreads it through,
so it's available as $json.ai_context in the "Create - Ollama - Generate JD"
HTTP node. This adds a clause to the prompt so the JD is tailored to those
requirements (degree, years of experience, skills, tools, languages, certs).

Idempotent — only rewrites the prompt if the ai_context clause isn't present.
Patches BOTH workflow_entity and workflow_history (n8n runs the history snapshot).
Restart n8n afterwards.
"""
import sqlite3, json, pathlib

DB = pathlib.Path("D:/n8n/.n8n/database.sqlite")
WF_ID = "1"
NODE = "Create - Ollama - Generate JD"

OLD = "Location: ${$json.location_type}${$json.reporting_to ? '\\nReporting To: ' + $json.reporting_to : ''}\\n\\nWrite the job description now:"
NEW = "Location: ${$json.location_type}${$json.reporting_to ? '\\nReporting To: ' + $json.reporting_to : ''}${$json.ai_context ? '\\n\\nAdditional guidance from HR — tailor the description to these requirements and keywords (degrees, years of experience, specific skills, tools, languages, certifications): ' + $json.ai_context : ''}\\n\\nWrite the job description now:"


def patch_nodes(nodes):
    changed = False
    for n in nodes:
        if n.get("name") == NODE:
            body = n["parameters"].get("jsonBody", "")
            if "$json.ai_context" in body:
                continue  # already patched
            if OLD in body:
                n["parameters"]["jsonBody"] = body.replace(OLD, NEW)
                changed = True
            else:
                print("  WARNING: expected prompt substring not found in", NODE)
    return changed


conn = sqlite3.connect(str(DB))
try:
    ver_id = conn.execute("SELECT activeVersionId FROM workflow_entity WHERE id=?", (WF_ID,)).fetchone()[0]

    # workflow_entity
    row = conn.execute("SELECT nodes FROM workflow_entity WHERE id=?", (WF_ID,)).fetchone()
    nodes = json.loads(row[0])
    if patch_nodes(nodes):
        conn.execute("UPDATE workflow_entity SET nodes=? WHERE id=?", (json.dumps(nodes), WF_ID))
        print("Patched workflow_entity")
    else:
        print("workflow_entity already up to date")

    # workflow_history (the snapshot n8n actually executes)
    row = conn.execute("SELECT nodes FROM workflow_history WHERE versionId=?", (ver_id,)).fetchone()
    nodes = json.loads(row[0])
    if patch_nodes(nodes):
        conn.execute("UPDATE workflow_history SET nodes=? WHERE versionId=?", (json.dumps(nodes), ver_id))
        print("Patched workflow_history")
    else:
        print("workflow_history already up to date")

    conn.commit()
    print("Done. Restart n8n for changes to take effect.")
finally:
    conn.close()
