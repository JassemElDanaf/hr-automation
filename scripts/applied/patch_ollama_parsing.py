"""One-off: patch Ollama parsing in the CV eval + JD gen workflows.

Updates node jsCode / jsonBody in place by matching on node id. Idempotent.
"""
import json, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]

EVAL_PARSER = r"""const items = $input.all();
const promptItems = $('Eval - Prepare Prompts').all();
const results = [];
function extractJson(text) {
  if (!text) return null;
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try { return JSON.parse(text); } catch(_) {}
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch(_) { return null; }
      }
    }
  }
  return null;
}
function clampScore(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isNaN(n) ? null : Math.min(10, Math.max(0, Math.round(n * 10) / 10));
}
function toStr(v) { return Array.isArray(v) ? v.join('; ') : (v || ''); }
for (let i = 0; i < items.length; i++) {
  const raw = items[i].json;
  const meta = promptItems[i]?.json || {};
  const wSkills = meta.wSkills || 0.4;
  const wExp = meta.wExp || 0.35;
  const wEdu = meta.wEdu || 0.25;
  let aiText = (raw.response || '').trim();
  if (!aiText && raw.thinking) aiText = raw.thinking;
  const parsed = extractJson(aiText);
  let skillsScore = parsed ? clampScore(parsed.skills_score) : null;
  let expScore = parsed ? clampScore(parsed.experience_score) : null;
  let eduScore = parsed ? clampScore(parsed.education_score) : null;
  let strengths, weaknesses, reasoning, parseError = false;
  if (skillsScore !== null && expScore !== null && eduScore !== null) {
    strengths = toStr(parsed.strengths);
    weaknesses = toStr(parsed.weaknesses);
    reasoning = parsed.reasoning || 'AI evaluation by Qwen3';
  } else {
    skillsScore = 0; expScore = 0; eduScore = 0;
    strengths = '';
    weaknesses = '';
    reasoning = 'AI evaluation failed to produce structured scores. Please re-run the evaluation.';
    parseError = true;
  }
  const overall = Math.round((skillsScore * wSkills + expScore * wExp + eduScore * wEdu) * 10) / 10;
  results.push({ json: {
    error: false,
    parse_error: parseError,
    candidate_id: meta.candidate_id,
    candidate_name: meta.candidate_name,
    job_opening_id: meta.job_opening_id,
    overall_score: overall,
    skills_score: skillsScore,
    experience_score: expScore,
    education_score: eduScore,
    reasoning: reasoning,
    strengths: strengths,
    weaknesses: weaknesses,
    sql: 'INSERT INTO evaluations (candidate_id, job_opening_id, overall_score, skills_score, experience_score, education_score, reasoning, strengths, weaknesses) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
    params: [meta.candidate_id, meta.job_opening_id, overall, skillsScore, expScore, eduScore, reasoning, strengths, weaknesses]
  }});
}
return results;"""

JD_PARSER = r"""// Extract AI-generated description from Ollama response
const input = $('Create - Route by Source').first().json;
const ollamaResponse = $input.first().json;

let jobDescription = (ollamaResponse.response || ollamaResponse.text || '').trim();
if (!jobDescription && ollamaResponse.thinking) {
  jobDescription = ollamaResponse.thinking.trim();
}
// Strip any thinking tags that slipped through
jobDescription = jobDescription.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

if (!jobDescription || jobDescription.length < 50) {
  // Fallback: generate a template-based description
  const fallbackJD = `## ${input.job_title}\n\n**Department:** ${input.department}\n**Type:** ${input.employment_type}\n**Level:** ${input.seniority_level}\n**Location:** ${input.location_type}\n${input.reporting_to ? '**Reports to:** ' + input.reporting_to : ''}\n\n### About the Role\nWe are looking for a ${input.seniority_level} ${input.job_title} to join our ${input.department} team.\n\n### Key Responsibilities\n- Define and execute responsibilities aligned with the ${input.job_title} role\n- Collaborate with cross-functional teams\n- Drive initiatives within ${input.department}\n- Contribute to team goals and objectives\n- Report on progress and outcomes\n\n### Requirements\n- Relevant experience for a ${input.seniority_level} position\n- Strong communication and collaboration skills\n- Domain expertise in ${input.department}\n\n### Nice to Have\n- Previous experience in a similar role\n- Knowledge of industry best practices\n\n---\n*Note: This description was auto-generated as a template. AI generation was unavailable. Please review and customize.*`;
  return [{ json: { ...input, job_description: fallbackJD, description_source_type: 'ai_generated', ai_fallback: true } }];
}
return [{ json: { ...input, job_description: jobDescription, description_source_type: 'ai_generated', ai_fallback: false } }];"""


def patch_eval():
    p = ROOT / "workflows" / "phase2-cv-evaluation" / "phase2-cv-evaluation.json"
    data = json.loads(p.read_text(encoding="utf-8"))
    changed = 0
    for node in data["nodes"]:
        if node["id"] == "parse-ai-response":
            if node["parameters"].get("jsCode") != EVAL_PARSER:
                node["parameters"]["jsCode"] = EVAL_PARSER
                changed += 1
        elif node["id"] == "gen-crit-build":
            code = node["parameters"].get("jsCode", "")
            if "think: false" not in code:
                code = code.replace(
                    "stream: false, options: { num_predict: 4000",
                    "stream: false, think: false, options: { num_predict: 4000",
                )
                node["parameters"]["jsCode"] = code
                changed += 1
    p.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"phase2-cv-evaluation.json: {changed} node(s) updated")


def patch_jd():
    p = ROOT / "workflows" / "phase1-job-opening" / "phase1-job-opening.json"
    data = json.loads(p.read_text(encoding="utf-8"))
    changed = 0
    for node in data["nodes"]:
        if node["id"] == "ollama-generate":
            body = node["parameters"].get("jsonBody", "")
            if "think: false" not in body:
                body = body.replace(
                    "stream: false, options: { num_predict: 8000",
                    "stream: false, think: false, options: { num_predict: 8000",
                )
                node["parameters"]["jsonBody"] = body
                changed += 1
        elif node["id"] == "process-ai-response":
            if node["parameters"].get("jsCode") != JD_PARSER:
                node["parameters"]["jsCode"] = JD_PARSER
                changed += 1
    p.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"phase1-job-opening.json: {changed} node(s) updated")


if __name__ == "__main__":
    patch_eval()
    patch_jd()
