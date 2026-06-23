"""
Make CV evaluation (Phase 3, WF id=2) score strictly against the Step-2 criteria
and see (almost) the whole CV:

  1. CV text truncation 3000 -> 9000 chars (the marketing cert / skills etc. were
     past the 3000-char cutoff on long CVs, so the model never saw them).
  2. Criteria/JD truncation 1500 -> 3000 chars.
  3. Adds a CRITICAL SCORING RULES block forcing the model to score ONLY against
     the provided criteria and to drop skills/experience scores when the
     candidate's field doesn't match the role (no more rewarding impressive-but-
     irrelevant CVs).
  4. num_ctx 4096 -> 8192 so the larger prompt fits the context window.

Idempotent. Patches BOTH workflow_entity and workflow_history. Restart n8n after.
"""
import sqlite3, json, pathlib

DB = pathlib.Path("D:/n8n/.n8n/database.sqlite")
WF_ID = "2"
NODE = "Eval - Prepare Prompts"

REPLACEMENTS = [
    ("const cvText = (item.json.cv_text || '').substring(0, 3000);",
     "const cvText = (item.json.cv_text || '').substring(0, 9000);"),
    ("${jobDesc.substring(0, 1500)}${itemsBlock}\\n\\nSCORING WEIGHTS:",
     "${jobDesc.substring(0, 3000)}${itemsBlock}\\n\\nCRITICAL SCORING RULES:\\n- Score the candidate ONLY against the JOB DESCRIPTION / CRITERIA above. Those criteria define what matters for THIS role — do not invent or substitute your own criteria.\\n- Relevance is mandatory: skills or experience that are impressive but NOT relevant to this role's criteria must NOT raise the scores.\\n- If the candidate's field/background does not match what this role requires, skills_score and experience_score MUST be low (typically 0-3), no matter how strong their unrelated background is.\\n- education_score reflects fit with the role's stated educational requirements, not prestige alone.\\n- Reserve high scores (8-10) only for candidates who clearly satisfy the stated criteria.\\n\\nSCORING WEIGHTS:"),
    ("num_predict: 4000, num_ctx: 4096, temperature: 0.2",
     "num_predict: 4000, num_ctx: 8192, temperature: 0.2"),
]


def patch_nodes(nodes):
    changed = False
    for n in nodes:
        if n.get("name") == NODE:
            code = n["parameters"].get("jsCode", "")
            if "CRITICAL SCORING RULES" in code:
                continue  # already patched
            for old, new in REPLACEMENTS:
                if old in code:
                    code = code.replace(old, new)
                else:
                    print("  WARNING: substring not found:", old[:60])
            n["parameters"]["jsCode"] = code
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
    print("Done. Restart n8n, then Re-evaluate candidates for the new scoring.")
finally:
    conn.close()
