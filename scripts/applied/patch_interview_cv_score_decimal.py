"""
Fix the Interview "Select Candidate" CV score showing a rounded whole number
(e.g. 8.0) while Shortlist/Decision show the real overall_score (7.6).

The /interview/candidates query rounded overall_score to 0 decimals
(ROUND(7.6) = 8). Change it to ROUND(..., 1) so it keeps one decimal and
matches everywhere.

Idempotent. Patches BOTH workflow_entity and workflow_history. Restart n8n after.
"""
import sqlite3, json, pathlib

DB = pathlib.Path("D:/n8n/.n8n/database.sqlite")
WF_ID = "6"

OLD = 'ROUND(COALESCE(e.overall_score, 0)) AS "OverallScore"'
NEW = 'ROUND(COALESCE(e.overall_score, 0)::numeric, 1) AS "OverallScore"'


def patch_nodes(nodes):
    changed = False
    for n in nodes:
        q = n.get("parameters", {}).get("query")
        if isinstance(q, str) and OLD in q:
            n["parameters"]["query"] = q.replace(OLD, NEW)
            changed = True
    return changed


conn = sqlite3.connect(str(DB))
try:
    ver_id = conn.execute("SELECT activeVersionId FROM workflow_entity WHERE id=?", (WF_ID,)).fetchone()[0]

    row = conn.execute("SELECT nodes FROM workflow_entity WHERE id=?", (WF_ID,)).fetchone()
    nodes = json.loads(row[0])
    if patch_nodes(nodes):
        conn.execute("UPDATE workflow_entity SET nodes=? WHERE id=?", (json.dumps(nodes), WF_ID))
        print("Patched workflow_entity")
    else:
        print("workflow_entity already up to date (or query not found)")

    row = conn.execute("SELECT nodes FROM workflow_history WHERE versionId=?", (ver_id,)).fetchone()
    nodes = json.loads(row[0])
    if patch_nodes(nodes):
        conn.execute("UPDATE workflow_history SET nodes=? WHERE versionId=?", (json.dumps(nodes), ver_id))
        print("Patched workflow_history")
    else:
        print("workflow_history already up to date (or query not found)")

    conn.commit()
    print("Done. Restart n8n for changes to take effect.")
finally:
    conn.close()
