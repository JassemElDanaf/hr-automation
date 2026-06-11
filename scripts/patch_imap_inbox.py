"""One-shot patch: push the updated Phase 5 workflow into the live n8n sqlite.

Phase 5 (id='4') gained:
  - direction='outbound' + message_id columns on the two outbound INSERTs
  - new /inbound-email webhook chain (validate → drop check → find parent →
    resolve → orphan check → insert inbound row → respond)
  - triggerCount bumped 2 → 3

Per the documented n8n patching protocol (CLAUDE.md Fix Log, 2026-04 entry),
runtime executes the snapshot stored in `workflow_history.nodes` indexed by
`workflow_entity.activeVersionId` — NOT the editor draft in workflow_entity.
So we must update BOTH rows. Idempotent (overwrites with current JSON).

After running: kill all `node` processes whose command line contains `n8n`
(includes the `@n8n/task-runner` worker) and restart via start.sh.
"""
import json, os, pathlib, sqlite3, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
N8N_DB = pathlib.Path("D:/n8n/.n8n/database.sqlite")
WORKFLOW_JSON = ROOT / "workflows" / "phase4-email" / "phase4-email.json"
WORKFLOW_ID = "4"  # Phase 5 - Emails


def main():
    if not N8N_DB.exists():
        print(f"FATAL: n8n DB not found at {N8N_DB}", file=sys.stderr)
        sys.exit(1)
    if not WORKFLOW_JSON.exists():
        print(f"FATAL: workflow JSON not found at {WORKFLOW_JSON}", file=sys.stderr)
        sys.exit(1)

    wf = json.loads(WORKFLOW_JSON.read_text(encoding="utf-8"))
    nodes_json = json.dumps(wf["nodes"])
    conns_json = json.dumps(wf["connections"])
    trigger_count = wf.get("triggerCount", 0)

    conn = sqlite3.connect(N8N_DB)
    try:
        cur = conn.cursor()
        cur.execute("SELECT activeVersionId FROM workflow_entity WHERE id = ?", (WORKFLOW_ID,))
        row = cur.fetchone()
        if not row:
            print(f"FATAL: workflow id={WORKFLOW_ID} not found in workflow_entity", file=sys.stderr)
            sys.exit(2)
        active_version_id = row[0]
        print(f"workflow_entity row found, activeVersionId={active_version_id}")

        cur.execute(
            "UPDATE workflow_entity SET nodes = ?, connections = ?, triggerCount = ? WHERE id = ?",
            (nodes_json, conns_json, trigger_count, WORKFLOW_ID),
        )
        print(f"  workflow_entity updated ({cur.rowcount} row)")

        if active_version_id:
            cur.execute(
                "UPDATE workflow_history SET nodes = ?, connections = ? WHERE versionId = ?",
                (nodes_json, conns_json, active_version_id),
            )
            print(f"  workflow_history updated ({cur.rowcount} row)")
        else:
            print("  WARN: activeVersionId is NULL — runtime will fall back to entity row, but you should re-import to fix")

        conn.commit()
        print("\nDone. Restart n8n: kill all node processes with 'n8n' in the command line, then run start.sh.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
