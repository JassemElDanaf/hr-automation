"""One-shot patch: push the updated Phase 3 workflow into the live n8n sqlite.

Phase 3 (id='2') Eval - Prepare Prompts now injects TODAY'S DATE: YYYY-MM-DD into
the LLM prompt so qwen3:4b stops mistaking near-future dates (e.g. "graduating
June 2026" when today is 2026-04-27) as far-future.

Per the documented n8n patching protocol (CLAUDE.md Fix Log, 2026-04 entry),
runtime executes the snapshot stored in `workflow_history.nodes` indexed by
`workflow_entity.activeVersionId` — NOT the editor draft in workflow_entity.
So we update BOTH rows. Idempotent (overwrites with current JSON).

After running: kill all `node` processes whose command line contains `n8n` and
restart via start.sh.
"""
import json, os, pathlib, sqlite3, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
N8N_DB = pathlib.Path("D:/n8n/.n8n/database.sqlite")
WORKFLOW_JSON = ROOT / "workflows" / "phase2-cv-evaluation" / "phase2-cv-evaluation.json"
WORKFLOW_ID = "2"  # Phase 3 - CV Evaluation


def main():
    if not N8N_DB.exists():
        print(f"FATAL: n8n DB not found at {N8N_DB}", file=sys.stderr); sys.exit(1)
    if not WORKFLOW_JSON.exists():
        print(f"FATAL: workflow JSON not found at {WORKFLOW_JSON}", file=sys.stderr); sys.exit(1)

    wf = json.loads(WORKFLOW_JSON.read_text(encoding="utf-8"))
    nodes_json = json.dumps(wf["nodes"])
    conns_json = json.dumps(wf["connections"])

    conn = sqlite3.connect(N8N_DB)
    try:
        cur = conn.cursor()
        cur.execute("SELECT activeVersionId FROM workflow_entity WHERE id = ?", (WORKFLOW_ID,))
        row = cur.fetchone()
        if not row:
            print(f"FATAL: workflow id={WORKFLOW_ID} not found", file=sys.stderr); sys.exit(2)
        active_version_id = row[0]
        print(f"workflow_entity row found, activeVersionId={active_version_id}")

        cur.execute("UPDATE workflow_entity SET nodes = ?, connections = ? WHERE id = ?",
                    (nodes_json, conns_json, WORKFLOW_ID))
        print(f"  workflow_entity updated ({cur.rowcount} row)")

        if active_version_id:
            cur.execute("UPDATE workflow_history SET nodes = ?, connections = ? WHERE versionId = ?",
                        (nodes_json, conns_json, active_version_id))
            print(f"  workflow_history updated ({cur.rowcount} row)")

        conn.commit()
        print("\nDone. Restart n8n.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
