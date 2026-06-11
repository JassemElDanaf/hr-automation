"""Strip Ollama reasoning preamble from free-text generation outputs.

Targets:
  - phase1 JD generation: stronger prompt + sanitizer that strips </think> tails,
    preamble lines like "Okay, the user wants...", and leading non-JD chatter.
  - phase2 criteria generation: same sanitizer reused.

Updates BOTH the canonical workflow JSON files AND the live n8n sqlite DB so
the change takes effect without re-importing. Idempotent.

Run:
  python scripts/patch_ollama_thinking.py
  # then bounce n8n (taskkill the process, restart) for it to reload nodes
"""
import json, os, pathlib, sqlite3, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
N8N_DB = pathlib.Path("D:/n8n/.n8n/database.sqlite")

# ---------------------------------------------------------------------------
# Shared JS sanitizer — embedded into each parser node.
# Strips <think> blocks (matched + unmatched), takes content AFTER the last
# </think> if present, finds the first acceptable JD/criteria heading, and as a
# last resort drops leading "Okay, …" / "Let me …" / "The user wants …" lines.
# ---------------------------------------------------------------------------
SANITIZER_JS = r"""
function stripLLMPreamble(text) {
  if (!text) return '';
  // 1. If the model emitted a closing </think>, take everything after the LAST one.
  const closeIdx = text.lastIndexOf('</think>');
  if (closeIdx >= 0) text = text.slice(closeIdx + '</think>'.length);
  // 2. Drop any unclosed <think>...EOF tail.
  text = text.replace(/<think>[\s\S]*$/i, '');
  // 3. Drop any remaining stray </think> or <think> tokens.
  text = text.replace(/<\/?think>/gi, '');
  // 4. Strip wrapping markdown code fences.
  text = text.replace(/^```(?:markdown|md|text)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  text = text.trim();
  // 5. Look for the first acceptable starting line (markdown heading, About the Role, Job Title:, **bold field).
  const startMatch = text.match(/(^|\n)(#{1,6}\s+\S|About the Role\b|Job Title\s*:|Department\s*:|SKILLS\s*:|\*\*[A-Z])/);
  if (startMatch) {
    const idx = startMatch.index + (startMatch[1] ? startMatch[1].length : 0);
    return text.slice(idx).trim();
  }
  // 6. Fallback: strip leading reasoning preamble lines. Stops at first non-preamble line.
  const preambleRe = /^(okay\b|alright\b|sure[,!]?\s|so[,]?\s|let'?s\b|let me\b|first[,]?\s|to start\b|i\b(?:'m|m| am| need| will| think| should| have|'ll)|i'?ll\b|the user\b|here'?s\b|here is\b|thinking[:\s]|reasoning[:\s]|analysis[:\s]|plan[:\s]|step \d|<\/?think>|the assistant\b|as an? (?:ai|hr))/i;
  const lines = text.split('\n');
  let start = 0;
  while (start < lines.length) {
    const ln = lines[start].trim();
    if (ln && !preambleRe.test(ln)) break;
    start++;
  }
  return lines.slice(start).join('\n').trim();
}
""".strip()


# ---------------------------------------------------------------------------
# phase1 JD prompt — explicitly forbids reasoning, planning, <think> tags.
# Inlined into the Ollama HTTP node's jsonBody.
# ---------------------------------------------------------------------------
JD_PROMPT_TEMPLATE = (
    "Generate a professional, detailed job description for the following position. "
    "Include sections: About the Role, Key Responsibilities (5-7 bullet points), Requirements (5-7 bullet points), "
    "Nice to Have (3-4 bullet points), and What We Offer (3-4 bullet points).\\n\\n"
    "Job Title: ${$json.job_title}\\nDepartment: ${$json.department}\\n"
    "Employment Type: ${$json.employment_type}\\nSeniority Level: ${$json.seniority_level}\\n"
    "Location: ${$json.location_type}${$json.reporting_to ? '\\nReporting To: ' + $json.reporting_to : ''}\\n\\n"
    "STRICT OUTPUT RULES:\\n"
    "- Return ONLY the final job description.\\n"
    "- Do NOT include reasoning, analysis, planning, or commentary about the task.\\n"
    "- Do NOT include <think> tags or any meta text.\\n"
    "- Do NOT start with phrases like \"Okay\", \"Sure\", \"Let me\", \"I need to\", \"The user wants\".\\n"
    "- The first line of your response MUST be the heading \"## About the Role\".\\n\\n"
    "Write the job description now (start with \"## About the Role\"):"
)

JD_JSON_BODY = (
    "={{ JSON.stringify({ model: 'qwen3:4b', prompt: `"
    + JD_PROMPT_TEMPLATE
    + "`, stream: false, think: false, options: { num_predict: 8000, num_ctx: 4096, temperature: 0.3 } }) }}"
)

JD_PARSER = (
    SANITIZER_JS
    + r"""
const input = $('Create - Route by Source').first().json;
const ollamaResponse = $input.first().json;
let jobDescription = (ollamaResponse.response || ollamaResponse.text || '').trim();
if (!jobDescription && ollamaResponse.thinking) jobDescription = ollamaResponse.thinking.trim();
jobDescription = stripLLMPreamble(jobDescription);
if (!jobDescription || jobDescription.length < 50) {
  const fallbackJD = `## ${input.job_title}\n\n**Department:** ${input.department}\n**Type:** ${input.employment_type}\n**Level:** ${input.seniority_level}\n**Location:** ${input.location_type}\n${input.reporting_to ? '**Reports to:** ' + input.reporting_to : ''}\n\n### About the Role\nWe are looking for a ${input.seniority_level} ${input.job_title} to join our ${input.department} team.\n\n### Key Responsibilities\n- Define and execute responsibilities aligned with the ${input.job_title} role\n- Collaborate with cross-functional teams\n- Drive initiatives within ${input.department}\n- Contribute to team goals and objectives\n- Report on progress and outcomes\n\n### Requirements\n- Relevant experience for a ${input.seniority_level} position\n- Strong communication and collaboration skills\n- Domain expertise in ${input.department}\n\n### Nice to Have\n- Previous experience in a similar role\n- Knowledge of industry best practices\n\n---\n*Note: This description was auto-generated as a template. AI generation was unavailable. Please review and customize.*`;
  return [{ json: { ...input, job_description: fallbackJD, description_source_type: 'ai_generated', ai_fallback: true } }];
}
return [{ json: { ...input, job_description: jobDescription, description_source_type: 'ai_generated', ai_fallback: false } }];
"""
)


# ---------------------------------------------------------------------------
# phase2 criteria parser — same sanitizer, same idea.
# ---------------------------------------------------------------------------
CRITERIA_PARSER = (
    SANITIZER_JS
    + r"""
const raw = $input.first().json;
let text = (raw.response || raw.text || '').trim();
if (!text && raw.thinking) text = raw.thinking.trim();
text = stripLLMPreamble(text);
if (!text) return [{ json: { success: false, error: 'Ollama returned an empty response' } }];
return [{ json: { success: true, criteria_text: text } }];
"""
)


# ---------------------------------------------------------------------------
# JSON file patchers
# ---------------------------------------------------------------------------
def patch_phase1_file() -> bool:
    p = ROOT / "workflows" / "phase1-job-opening" / "phase1-job-opening.json"
    data = json.loads(p.read_text(encoding="utf-8"))
    changed = False
    for node in data["nodes"]:
        if node["id"] == "ollama-generate":
            if node["parameters"].get("jsonBody") != JD_JSON_BODY:
                node["parameters"]["jsonBody"] = JD_JSON_BODY
                changed = True
        elif node["id"] == "process-ai-response":
            if node["parameters"].get("jsCode") != JD_PARSER:
                node["parameters"]["jsCode"] = JD_PARSER
                changed = True
    if changed:
        p.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"phase1-job-opening.json: {'updated' if changed else 'no change'}")
    return changed


def patch_phase2_file() -> bool:
    p = ROOT / "workflows" / "phase2-cv-evaluation" / "phase2-cv-evaluation.json"
    data = json.loads(p.read_text(encoding="utf-8"))
    changed = False
    for node in data["nodes"]:
        # criteria parser node — find by name since the id pattern differs
        if node.get("name") == "GenCrit - Parse Response":
            if node["parameters"].get("jsCode") != CRITERIA_PARSER:
                node["parameters"]["jsCode"] = CRITERIA_PARSER
                changed = True
    if changed:
        p.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"phase2-cv-evaluation.json: {'updated' if changed else 'no change'}")
    return changed


# ---------------------------------------------------------------------------
# Live sqlite patcher — mirror the JSON-file changes into the running DB.
#
# CRITICAL: n8n executes the snapshot in `workflow_history` indexed by
# `workflow_entity.activeVersionId`, NOT the draft in `workflow_entity.nodes`.
# So we must update BOTH tables or runtime will keep using the old code.
# ---------------------------------------------------------------------------
def patch_sqlite() -> int:
    if not N8N_DB.exists():
        print(f"WARN: {N8N_DB} not found — sqlite patch skipped")
        return 0
    con = sqlite3.connect(str(N8N_DB))
    cur = con.cursor()
    total_entity = 0
    total_history = 0
    for wf_id, json_path in [
        (1, ROOT / "workflows" / "phase1-job-opening" / "phase1-job-opening.json"),
        (2, ROOT / "workflows" / "phase2-cv-evaluation" / "phase2-cv-evaluation.json"),
    ]:
        wf = json.loads(json_path.read_text(encoding="utf-8"))
        nodes_json = json.dumps(wf["nodes"])
        cur.execute(
            "UPDATE workflow_entity SET nodes = ?, updatedAt = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ?",
            (nodes_json, str(wf_id)),
        )
        total_entity += cur.rowcount
        # Also overwrite the history snapshot pointed to by activeVersionId — that's
        # the version n8n actually executes at runtime.
        cur.execute("SELECT activeVersionId FROM workflow_entity WHERE id = ?", (str(wf_id),))
        active_ver = (cur.fetchone() or [None])[0]
        if active_ver:
            cur.execute(
                "UPDATE workflow_history SET nodes = ?, updatedAt = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE versionId = ?",
                (nodes_json, active_ver),
            )
            total_history += cur.rowcount
    con.commit()
    con.close()
    print(f"sqlite: {total_entity} entity row(s), {total_history} history row(s) updated")
    return total_entity + total_history


if __name__ == "__main__":
    p1 = patch_phase1_file()
    p2 = patch_phase2_file()
    n = patch_sqlite()
    if p1 or p2 or n:
        print("Done. Restart n8n for changes to take effect.")
    else:
        print("No changes needed.")
