#!/usr/bin/env python3
"""Export live n8n workflows (D:/n8n/.n8n/database.sqlite) into the repo JSONs.

The live instance is patched in place by the scripts/patch_*.py family, so the
repo JSONs drift unless re-exported. Run this after every live patch so a
re-import (scripts/import-workflows.sh) reproduces the running system instead
of silently reverting it.

Replaces nodes + connections in each repo file; preserves the file's other
top-level fields (name, settings, tags, ...).
"""
import sqlite3, json, pathlib

DB = pathlib.Path("D:/n8n/.n8n/database.sqlite")
ROOT = pathlib.Path(__file__).parent.parent / "workflows"

# live workflow id -> repo file (folder names are historical; see docs/n8n.md)
MAPPING = {
    "1": ROOT / "phase1-job-opening" / "phase1-job-opening.json",
    "2": ROOT / "phase2-cv-evaluation" / "phase2-cv-evaluation.json",
    "3": ROOT / "phase3-shortlist" / "phase3-shortlist.json",
    "4": ROOT / "phase4-email" / "phase4-email.json",
    "5": ROOT / "phase5-dashboard" / "phase5-dashboard.json",
    "6": ROOT / "phase6-interview" / "phase6-interview.json",
}

conn = sqlite3.connect(str(DB))
try:
    for wf_id, path in MAPPING.items():
        row = conn.execute(
            "SELECT name, nodes, connections FROM workflow_entity WHERE id=?", (wf_id,)
        ).fetchone()
        if not row:
            print(f"  !! workflow {wf_id} not found in live DB — skipped")
            continue
        name, nodes_json, conns_json = row
        doc = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        doc["name"] = name
        doc["nodes"] = json.loads(nodes_json)
        doc["connections"] = json.loads(conns_json)
        path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"  wf {wf_id} ({name}) -> {path.relative_to(ROOT.parent)}  [{len(doc['nodes'])} nodes]")
finally:
    conn.close()
print("Done.")
