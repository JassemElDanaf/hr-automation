"""
Patch IntEval - Build Prompt in Phase 6 (Live Interview) workflow.
Fixes two problems:
  1. Example JSON had hardcoded 7s → model anchored to 7 regardless of answers
  2. No penalty rule for "(no response)" answers → model was too lenient
"""
import sqlite3, json, pathlib

DB = pathlib.Path("D:/n8n/.n8n/database.sqlite")
WF_ID = "6"
NODE_ID = "build-intv-eval"

NEW_JS = r"""
const body = $input.first().json.body || $input.first().json || {};
const jobTitle = (body.jobTitle || 'the position').substring(0, 100);
const candidateName = (body.candidateName || 'the candidate').substring(0, 100);
const duration = parseInt(body.duration) || 0;
const minutes = Math.floor(duration/60);
const qaPairs = Array.isArray(body.qaPairs) ? body.qaPairs : (Array.isArray(body.transcript) ? body.transcript : []);
const customQuestions = Array.isArray(body.customQuestions) ? body.customQuestions : [];
const modelAnswerMap = {};
customQuestions.forEach((q, i) => { if (q.modelAnswer && q.modelAnswer.trim()) modelAnswerMap[i] = q.modelAnswer.trim(); });
const hasRubric = Object.keys(modelAnswerMap).length > 0;

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

const penaltyInstruction = noResponseCount === 0 ? '' :
  '\n\nPENALTY RULES (non-negotiable):\n' +
  '- Every "(no response)" or "(no answer captured)" answer scores 1-2 for that question — the candidate said nothing.\n' +
  (noResponseCount >= Math.ceil(totalQ / 2)
    ? '- The candidate failed to answer ' + noResponseCount + ' out of ' + totalQ + ' questions. Overall MUST be ≤ 3.\n'
    : '- The candidate failed to answer ' + noResponseCount + ' out of ' + totalQ + ' questions. Overall MUST be ≤ 5.\n') +
  '- Do NOT inflate scores based on one good answer. Score reflects the full interview, not cherry-picked moments.\n' +
  '- overall must equal the rounded average of communication + technical + confidence + cultureFit — do not independently estimate it.';

const prompt = 'You are a strict HR evaluator for a competitive role. Score honestly — unanswered questions are a serious red flag.\n\nPosition: ' + jobTitle + '\nCandidate: ' + candidateName + '\nDuration: ' + minutes + ' minute(s), ' + totalQ + ' questions asked\n\nQuestions and Answers:\n' + (qText||'No Q&A captured.') + rubricInstruction + penaltyInstruction + '\n\nRate 1-10 on each dimension. Return ONLY valid JSON:\n{\n  "communication": <score>,\n  "technical": <score>,\n  "confidence": <score>,\n  "cultureFit": <score>,\n  "overall": <average of above 4>,\n  "summary": "2-3 sentence honest performance summary",\n  "recommendation": "Hire / Consider / Don\'t Recommend — 1-2 sentence justification",\n  "perQuestion": [{"index": 1, "score": <score>, "feedback": "one sentence"}]\n}';

return [{ json: { requestBody: { model: 'qwen3:4b', prompt, think: false, stream: false, format: 'json', options: { temperature: 0.2, num_predict: 2000 } } } }];
""".strip()

conn = sqlite3.connect(str(DB))
try:
    # Patch workflow_entity
    entity_row = conn.execute("SELECT nodes FROM workflow_entity WHERE id=?", (WF_ID,)).fetchone()
    nodes = json.loads(entity_row[0])
    patched = False
    for n in nodes:
        if n.get("id") == NODE_ID:
            n["parameters"]["jsCode"] = NEW_JS
            patched = True
            break
    assert patched, f"Node {NODE_ID} not found"
    conn.execute("UPDATE workflow_entity SET nodes=? WHERE id=?", (json.dumps(nodes), WF_ID))

    # Patch workflow_history
    ver_row = conn.execute("SELECT activeVersionId FROM workflow_entity WHERE id=?", (WF_ID,)).fetchone()
    ver_id = ver_row[0]
    hist_row = conn.execute("SELECT nodes FROM workflow_history WHERE versionId=?", (ver_id,)).fetchone()
    hnodes = json.loads(hist_row[0])
    patched_h = False
    for n in hnodes:
        if n.get("id") == NODE_ID:
            n["parameters"]["jsCode"] = NEW_JS
            patched_h = True
            break
    assert patched_h, f"Node {NODE_ID} not found in workflow_history"
    conn.execute("UPDATE workflow_history SET nodes=? WHERE versionId=?", (json.dumps(hnodes), ver_id))

    conn.commit()
    print("Patched workflow_entity and workflow_history for workflow", WF_ID)
    print("Restart n8n for changes to take effect.")
finally:
    conn.close()
