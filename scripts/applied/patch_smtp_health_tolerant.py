"""
SMTP "down" false alarm fix (WF id=4, Phase 4 Email):

  1. Health - Compute Status: a single most-recent transient failure (e.g. a
     one-off 25s timeout) no longer flips the badge to "failing" when the
     majority of recent sends succeeded. Now "failing" only when success rate
     < 60% OR the two most recent sends both failed (a real, ongoing problem).
  2. Send HTTP node timeout 25000 -> 60000 ms (Gmail's TLS handshake can be slow;
     the send often actually delivered but n8n timed out waiting and logged it
     as failed).

Idempotent. Patches BOTH workflow_entity and workflow_history. Restart n8n after.
"""
import sqlite3, json, pathlib

DB = pathlib.Path("D:/n8n/.n8n/database.sqlite")
WF_ID = "4"

CODE_OLD = "const lastOk = rows[0].status === 'sent';\nconst pct    = sent / total;\nlet status, detail;\nif (lastOk && pct >= 0.6) {"
CODE_NEW = "const pct    = sent / total;\nconst lastTwoFailed = total >= 2 && rows[0].status !== 'sent' && rows[1].status !== 'sent';\nlet status, detail;\nif (pct >= 0.6 && !lastTwoFailed) {"


def patch_nodes(nodes):
    changed = False
    for n in nodes:
        p = n.get("parameters", {})
        # 1. health compute code
        code = p.get("jsCode")
        if isinstance(code, str) and CODE_OLD in code:
            p["jsCode"] = code.replace(CODE_OLD, CODE_NEW)
            changed = True
        # 2. send timeout
        opts = p.get("options")
        if isinstance(opts, dict) and opts.get("timeout") == 25000:
            opts["timeout"] = 60000
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
        print("workflow_entity already up to date")

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
