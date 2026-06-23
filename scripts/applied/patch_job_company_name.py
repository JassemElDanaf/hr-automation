"""
Teaches the Phase 2 (Job Openings, WF id=1) AI JD generator the company name so
it stops emitting "[Your Company Name]" placeholders. Bakes "Diyar United
Company" into the prompt + an explicit no-placeholders instruction.

Idempotent. Patches BOTH workflow_entity and workflow_history (n8n runs the
history snapshot). Restart n8n afterwards.
"""
import sqlite3, json, pathlib

DB = pathlib.Path("D:/n8n/.n8n/database.sqlite")
WF_ID = "1"
NODE = "Create - Ollama - Generate JD"

OLD = "Generate a professional, detailed job description for the following position. Include sections: About the Role, Key Responsibilities (5-7 bullet points), Requirements (5-7 bullet points), Nice to Have (3-4 bullet points), and What We Offer (3-4 bullet points).\\n\\nJob Title: ${$json.job_title}\\nDepartment: ${$json.department}"
NEW = "Generate a professional, detailed job description for the following position at Diyar United Company. Always use the real company name \\\"Diyar United Company\\\" wherever a company name is referenced — never output placeholders such as [Your Company Name], [Company Name], or [Company]. Include sections: About the Role, Key Responsibilities (5-7 bullet points), Requirements (5-7 bullet points), Nice to Have (3-4 bullet points), and What We Offer (3-4 bullet points).\\n\\nCompany: Diyar United Company\\nJob Title: ${$json.job_title}\\nDepartment: ${$json.department}"


def patch_nodes(nodes):
    changed = False
    for n in nodes:
        if n.get("name") == NODE:
            body = n["parameters"].get("jsonBody", "")
            if "Company: Diyar United Company" in body:
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
