#!/usr/bin/env python3
"""QA fixes for workflow 6 (Live Interview) — 2026-06-11.

1. IntEval - Build Prompt: merge the strict-scoring/penalty rules
   (patch_interview_eval_prompt.py) with the requirements-extraction block
   (patch_wf6_recording.py) that the former accidentally dropped, and read
   body.durationSeconds (the field the frontend actually sends).
2. IntTx - Save: stop clobbering requirements_match with [] on re-evaluate /
   manual save — preserve the stored value unless a non-empty one arrives.
3. CQ List - Validate: include general_notes + meeting so the Candidate Prep
   tab can render them.

Patches BOTH workflow_entity and workflow_history (dual-table protocol).
Restart n8n afterwards.
"""
import sqlite3, json, pathlib

DB = pathlib.Path("D:/n8n/.n8n/database.sqlite")
WF_ID = "6"

BUILD_EVAL_JS = r"""
const body = $input.first().json.body || $input.first().json || {};
const jobTitle = (body.jobTitle || 'the position').substring(0, 100);
const candidateName = (body.candidateName || 'the candidate').substring(0, 100);
const duration = parseInt(body.durationSeconds || body.duration) || 0;
const minutes = Math.floor(duration/60);
const qaPairs = Array.isArray(body.qaPairs) ? body.qaPairs : (Array.isArray(body.transcript) ? body.transcript : []);
const customQuestions = Array.isArray(body.customQuestions) ? body.customQuestions : [];
const modelAnswerMap = {};
customQuestions.forEach((q, i) => { if (q.modelAnswer && q.modelAnswer.trim()) modelAnswerMap[i] = q.modelAnswer.trim(); });
const hasRubric = Object.keys(modelAnswerMap).length > 0;

const REQ_CATEGORIES = ['salary', 'iqama', 'notice', 'location'];
const requirementQs = [];
customQuestions.forEach((q, i) => { if (REQ_CATEGORIES.includes((q.category||'').toLowerCase()) && q.modelAnswer && q.modelAnswer.trim()) requirementQs.push({ index: i, category: (q.category||'').toLowerCase(), question: q.question || q.text || '', requirement: q.modelAnswer.trim() }); });
const hasRequirements = requirementQs.length > 0;

const noResponseCount = qaPairs.filter(p => {
  const a = (p.answer || '').trim().toLowerCase();
  return a === '(no response)' || a === '(no answer captured)' || a === '';
}).length;
const totalQ = qaPairs.length;

const qText = qaPairs.map((p, i) => {
  const ma = modelAnswerMap[i];
  const rubricLine = ma ? '\nExpected answer: ' + ma : '';
  return 'Q' + (i+1) + '. ' + (p.question||'') + rubricLine + '\nCandidate\'s answer: ' + ((p.answer||'(no answer captured)').substring(0,500));
}).join('\n\n');

const rubricInstruction = hasRubric ? '\nFor questions with an "Expected answer", score primarily on alignment with that rubric.' : '';

const requirementsBlock = hasRequirements ? '\n\nREQUIREMENTS TO EXTRACT:\n' + requirementQs.map(r => '- Q' + (r.index+1) + ' [' + r.category + ']: "' + r.question + '" -> Required: "' + r.requirement + '"').join('\n') + '\n\nFor each requirement above, extract the candidate\'s stated answer and determine if it meets the requirement (met: true/false).' : '';
const requirementsJson = hasRequirements ? ',\n  "requirements": [{"index": 1, "category": "salary", "question": "...", "requirement": "...", "extracted": "candidate stated value", "met": true, "note": "brief note"}]' : '';

const penaltyInstruction = noResponseCount === 0 ? '' :
  '\n\nPENALTY RULES (non-negotiable):\n' +
  '- Every "(no response)" or "(no answer captured)" answer scores 1-2 for that question — the candidate said nothing.\n' +
  (noResponseCount >= Math.ceil(totalQ / 2)
    ? '- The candidate failed to answer ' + noResponseCount + ' out of ' + totalQ + ' questions. Overall MUST be ≤ 3.\n'
    : '- The candidate failed to answer ' + noResponseCount + ' out of ' + totalQ + ' questions. Overall MUST be ≤ 5.\n') +
  '- Do NOT inflate scores based on one good answer. Score reflects the full interview, not cherry-picked moments.\n' +
  '- overall must equal the rounded average of communication + technical + confidence + cultureFit — do not independently estimate it.';

const prompt = 'You are a strict HR evaluator for a competitive role. Score honestly — unanswered questions are a serious red flag.\n\nPosition: ' + jobTitle + '\nCandidate: ' + candidateName + '\nDuration: ' + minutes + ' minute(s), ' + totalQ + ' questions asked\n\nQuestions and Answers:\n' + (qText||'No Q&A captured.') + rubricInstruction + requirementsBlock + penaltyInstruction + '\n\nRate 1-10 on each dimension. Return ONLY valid JSON:\n{\n  "communication": <score>,\n  "technical": <score>,\n  "confidence": <score>,\n  "cultureFit": <score>,\n  "overall": <average of above 4>,\n  "summary": "2-3 sentence honest performance summary",\n  "recommendation": "Hire / Consider / Don\'t Recommend — 1-2 sentence justification",\n  "perQuestion": [{"index": 1, "score": <score>, "feedback": "one sentence"}]' + requirementsJson + '\n}';

return [{ json: { requestBody: { model: 'qwen3:4b', prompt, think: false, stream: false, format: 'json', options: { temperature: 0.2, num_predict: 2500 } } } }];
""".strip()

SAVE_QUERY = """INSERT INTO interview_sessions (
  job_opening_id, candidate_id, evaluation_id, candidate_name,
  duration_seconds, transcript, qa_pairs,
  score_communication, score_technical, score_confidence, score_culture_fit, score_overall,
  summary, recommendation, per_question, recording_path, requirements_match
) VALUES (
  {{ $json.jobId }}, {{ $json.candidateId }},
  {{ $json.evaluationId !== null && $json.evaluationId !== undefined ? $json.evaluationId : 'NULL' }},
  '{{ $json.candidateName }}',
  {{ $json.durationSeconds }}, '{{ $json.transcript }}'::jsonb, '{{ $json.qaPairs }}'::jsonb,
  {{ $json.communication }}, {{ $json.technical }}, {{ $json.confidence }}, {{ $json.cultureFit }}, {{ $json.overall }},
  '{{ $json.summary }}', '{{ $json.recommendation }}', '{{ $json.perQuestion }}'::jsonb,
  '{{ $json.recordingPath }}', '{{ $json.requirementsMatch }}'::jsonb
)
ON CONFLICT (candidate_id, job_opening_id) DO UPDATE SET
  duration_seconds     = EXCLUDED.duration_seconds,
  transcript           = EXCLUDED.transcript,
  qa_pairs             = EXCLUDED.qa_pairs,
  score_communication  = EXCLUDED.score_communication,
  score_technical      = EXCLUDED.score_technical,
  score_confidence     = EXCLUDED.score_confidence,
  score_culture_fit    = EXCLUDED.score_culture_fit,
  score_overall        = EXCLUDED.score_overall,
  summary              = EXCLUDED.summary,
  recommendation       = EXCLUDED.recommendation,
  per_question         = EXCLUDED.per_question,
  recording_path       = CASE WHEN EXCLUDED.recording_path <> '' THEN EXCLUDED.recording_path ELSE interview_sessions.recording_path END,
  requirements_match   = CASE WHEN EXCLUDED.requirements_match::text <> '[]' THEN EXCLUDED.requirements_match ELSE interview_sessions.requirements_match END
RETURNING id"""

CQ_LIST_JS = r"""
const q = $input.first().json.query || {};
const jobId = parseInt(q.job_id);
if (!jobId) return [{ json: { error: true, message: 'job_id required' } }];
return [{ json: {
  sql: `SELECT cpq.id, cpq.candidate_id, cpq.job_opening_id, cpq.questions, cpq.general_notes, cpq.meeting, cpq.updated_at, c.candidate_name, c.email, jo.job_title, jo.department FROM candidate_prepared_questions cpq JOIN candidates c ON c.id = cpq.candidate_id JOIN job_openings jo ON jo.id = cpq.job_opening_id WHERE cpq.job_opening_id = ${jobId} ORDER BY cpq.updated_at DESC`
} }];
""".strip()

PATCHES = {
    "IntEval - Build Prompt": ("jsCode", BUILD_EVAL_JS),
    "IntTx - Save":           ("query",  SAVE_QUERY),
    "CQ List - Validate":     ("jsCode", CQ_LIST_JS),
}


def apply(nodes):
    seen = set()
    for n in nodes:
        if n.get("name") in PATCHES:
            key, val = PATCHES[n["name"]]
            n["parameters"][key] = val
            seen.add(n["name"])
    missing = set(PATCHES) - seen
    assert not missing, f"Nodes not found: {missing}"
    return nodes


conn = sqlite3.connect(str(DB))
try:
    row = conn.execute("SELECT nodes, activeVersionId FROM workflow_entity WHERE id=?", (WF_ID,)).fetchone()
    nodes = apply(json.loads(row[0]))
    conn.execute("UPDATE workflow_entity SET nodes=? WHERE id=?", (json.dumps(nodes), WF_ID))

    ver_id = row[1]
    hist = conn.execute("SELECT nodes FROM workflow_history WHERE versionId=?", (ver_id,)).fetchone()
    hnodes = apply(json.loads(hist[0]))
    conn.execute("UPDATE workflow_history SET nodes=? WHERE versionId=?", (json.dumps(hnodes), ver_id))

    conn.commit()
    print(f"Patched workflow {WF_ID} (entity + history, versionId={ver_id}):")
    for name in PATCHES:
        print(f"  - {name}")
    print("Restart n8n for changes to take effect.")
finally:
    conn.close()
