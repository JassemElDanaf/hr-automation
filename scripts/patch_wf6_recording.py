#!/usr/bin/env python3
"""Patch workflow 6 nodes for recording/requirements support."""
import sqlite3, json

DB = 'D:/n8n/.n8n/database.sqlite'
WF_ID = 6

db = sqlite3.connect(DB)
row = db.execute('SELECT nodes, activeVersionId FROM workflow_entity WHERE id=?', (WF_ID,)).fetchone()
version_id = row[1]
nodes = json.loads(row[0])

# Map node id -> index
idx = {n['id']: i for i, n in enumerate(nodes)}
print('Found nodes:', list(idx.keys()))

# ── build-intv-eval ──────────────────────────────────────────────────────────
BUILD_JSCODE = (
    "const body = $input.first().json.body || $input.first().json || {};\n"
    "const jobTitle = (body.jobTitle || 'the position').substring(0, 100);\n"
    "const candidateName = (body.candidateName || 'the candidate').substring(0, 100);\n"
    "const duration = parseInt(body.duration) || 0;\n"
    "const minutes = Math.floor(duration/60);\n"
    "const qaPairs = Array.isArray(body.qaPairs) ? body.qaPairs : (Array.isArray(body.transcript) ? body.transcript : []);\n"
    "const customQuestions = Array.isArray(body.customQuestions) ? body.customQuestions : [];\n"
    "const modelAnswerMap = {};\n"
    "customQuestions.forEach((q, i) => { if (q.modelAnswer && q.modelAnswer.trim()) modelAnswerMap[i] = q.modelAnswer.trim(); });\n"
    "const hasRubric = Object.keys(modelAnswerMap).length > 0;\n"
    "const REQ_CATEGORIES = ['salary', 'iqama', 'notice', 'location'];\n"
    "const requirementQs = [];\n"
    "customQuestions.forEach((q, i) => { if (REQ_CATEGORIES.includes((q.category||'').toLowerCase()) && q.modelAnswer && q.modelAnswer.trim()) requirementQs.push({ index: i, category: q.category, question: q.question || q.text || '', requirement: q.modelAnswer.trim() }); });\n"
    "const hasRequirements = requirementQs.length > 0;\n"
    "const qText = qaPairs.map((p, i) => { const ma = modelAnswerMap[i]; const rubricLine = ma ? '\\nExpected answer: ' + ma : ''; return 'Q' + (i+1) + '. ' + (p.question||'') + rubricLine + '\\nCandidate\\'s answer: ' + ((p.answer||'(no answer captured)').substring(0,500)); }).join('\\n\\n');\n"
    "const rubricInstruction = hasRubric ? '\\nFor questions with an \\\"Expected answer\\\", score the candidate primarily based on how well their answer aligns with that rubric.' : '';\n"
    "const requirementsBlock = hasRequirements ? '\\n\\nREQUIREMENTS TO EXTRACT:\\n' + requirementQs.map(r => '- Q' + (r.index+1) + ' [' + r.category + ']: \\\"' + r.question + '\\\" \\u2192 Required: \\\"' + r.requirement + '\\\"').join('\\n') + '\\n\\nFor each requirement above, extract the candidate\\'s stated answer and determine if it meets the requirement (met: true/false).' : '';\n"
    "const requirementsJson = hasRequirements ? ',\\n  \\\"requirements\\\": [{\\\"index\\\": 1, \\\"category\\\": \\\"salary\\\", \\\"question\\\": \\\"...\\\", \\\"requirement\\\": \\\"...\\\", \\\"extracted\\\": \\\"candidate stated value\\\", \\\"met\\\": true, \\\"note\\\": \\\"brief note\\\"}]' : '';\n"
    "const prompt = 'You are an expert HR evaluator assessing a completed AI-conducted job interview.\\n\\nPosition: ' + jobTitle + '\\nCandidate: ' + candidateName + '\\nDuration: ' + minutes + ' minute(s), ' + qaPairs.length + ' questions asked\\n\\nQuestions and Answers:\\n' + (qText||'No Q&A captured.') + rubricInstruction + requirementsBlock + '\\n\\nRate the candidate 1-10 on:\\n- communication: clarity, articulation, listening\\n- technical: knowledge and skills for the role\\n- confidence: delivery and conviction\\n- cultureFit: professional values alignment\\n\\nReturn ONLY valid JSON (no extra text):\\n{\\n  \\\"communication\\\": 7,\\n  \\\"technical\\\": 7,\\n  \\\"confidence\\\": 6,\\n  \\\"cultureFit\\\": 7,\\n  \\\"overall\\\": 7,\\n  \\\"summary\\\": \\\"2-3 sentence performance summary\\\",\\n  \\\"recommendation\\\": \\\"Hire / Consider / Don\\'t Recommend \\u2014 1-2 sentence justification\\\",' + '\\n  \\\"perQuestion\\\": [{\\\"index\\\": 1, \\\"score\\\": 7, \\\"feedback\\\": \\\"one sentence feedback\\\"}]' + requirementsJson + '\\n}';\n"
    "return [{ json: { requestBody: { model: 'qwen3:4b', prompt, think: false, stream: false, format: 'json', options: { temperature: 0.2, num_predict: 2500 } } } }];"
)
nodes[idx['build-intv-eval']]['parameters']['jsCode'] = BUILD_JSCODE

# ── parse-intv-eval ──────────────────────────────────────────────────────────
PARSE_JSCODE = (
    "const raw = $input.first().json;\n"
    "let text = (raw.response || '').trim();\n"
    "text = text.replace(/<think>[\\s\\S]*?<\\/think>/gi,'').replace(/^```json\\s*/i,'').replace(/```\\s*$/i,'').trim();\n"
    "function ex(t) { try { return JSON.parse(t); } catch {} const s=t.indexOf('{'),e=t.lastIndexOf('}'); if(s<0||e<s) return null; try { return JSON.parse(t.slice(s,e+1)); } catch { return null; } }\n"
    "function c(v) { const n=parseFloat(v); return isNaN(n)?0:Math.min(10,Math.max(0,Math.round(n*10)/10)); }\n"
    "const p = ex(text);\n"
    "return [{ json: { communication: p?c(p.communication):0, technical: p?c(p.technical):0, confidence: p?c(p.confidence):0, cultureFit: p?c(p.cultureFit):0, overall: p?c(p.overall):0, summary: p?.summary||'Evaluation could not be generated.', recommendation: p?.recommendation||'', perQuestion: p?.perQuestion||[], requirements: p?.requirements||[] } }];"
)
nodes[idx['parse-intv-eval']]['parameters']['jsCode'] = PARSE_JSCODE

# ── intTxPrep ────────────────────────────────────────────────────────────────
PREP_JSCODE = (
    "const body = $input.first().json.body;\n"
    "const scores = body.scores || {};\n"
    "const evalId = parseInt(body.evaluationId) || 0;\n"
    "return [{\n"
    "  json: {\n"
    "    jobId: parseInt(body.jobId) || 0,\n"
    "    candidateId: parseInt(body.candidateId) || 0,\n"
    "    evaluationId: evalId > 0 ? evalId : null,\n"
    "    candidateName: (body.candidateName || '').replace(/'/g, \"''\"),\n"
    "    durationSeconds: parseInt(body.durationSeconds) || 0,\n"
    "    transcript: JSON.stringify(body.transcript || []).replace(/'/g, \"''\"),\n"
    "    qaPairs: JSON.stringify(body.transcript || []).replace(/'/g, \"''\"),\n"
    "    communication: parseFloat(scores.communication) || 0,\n"
    "    technical: parseFloat(scores.technical) || 0,\n"
    "    confidence: parseFloat(scores.confidence) || 0,\n"
    "    cultureFit: parseFloat(scores.cultureFit) || 0,\n"
    "    overall: parseFloat(scores.overall) || 0,\n"
    "    summary: (scores.summary || '').replace(/'/g, \"''\"),\n"
    "    recommendation: (scores.recommendation || '').replace(/'/g, \"''\"),\n"
    "    perQuestion: JSON.stringify(scores.perQuestion || []).replace(/'/g, \"''\"),\n"
    "    recordingPath: (body.recordingPath || '').replace(/'/g, \"''\"),\n"
    "    requirementsMatch: JSON.stringify(scores.requirements || body.requirementsMatch || []).replace(/'/g, \"''\")\n"
    "  }\n"
    "}];"
)
nodes[idx['intTxPrep']]['parameters']['jsCode'] = PREP_JSCODE

# ── intTxSave (Postgres query) ───────────────────────────────────────────────
SAVE_QUERY = (
    "INSERT INTO interview_sessions (\n"
    "  job_opening_id, candidate_id, evaluation_id, candidate_name,\n"
    "  duration_seconds, transcript, qa_pairs,\n"
    "  score_communication, score_technical, score_confidence, score_culture_fit, score_overall,\n"
    "  summary, recommendation, per_question, recording_path, requirements_match\n"
    ") VALUES (\n"
    "  {{ $json.jobId }}, {{ $json.candidateId }},\n"
    "  {{ $json.evaluationId !== null && $json.evaluationId !== undefined ? $json.evaluationId : 'NULL' }},\n"
    "  '{{ $json.candidateName }}',\n"
    "  {{ $json.durationSeconds }}, '{{ $json.transcript }}'::jsonb, '{{ $json.qaPairs }}'::jsonb,\n"
    "  {{ $json.communication }}, {{ $json.technical }}, {{ $json.confidence }}, {{ $json.cultureFit }}, {{ $json.overall }},\n"
    "  '{{ $json.summary }}', '{{ $json.recommendation }}', '{{ $json.perQuestion }}'::jsonb,\n"
    "  '{{ $json.recordingPath }}', '{{ $json.requirementsMatch }}'::jsonb\n"
    ")\n"
    "ON CONFLICT (candidate_id, job_opening_id) DO UPDATE SET\n"
    "  duration_seconds     = EXCLUDED.duration_seconds,\n"
    "  transcript           = EXCLUDED.transcript,\n"
    "  qa_pairs             = EXCLUDED.qa_pairs,\n"
    "  score_communication  = EXCLUDED.score_communication,\n"
    "  score_technical      = EXCLUDED.score_technical,\n"
    "  score_confidence     = EXCLUDED.score_confidence,\n"
    "  score_culture_fit    = EXCLUDED.score_culture_fit,\n"
    "  score_overall        = EXCLUDED.score_overall,\n"
    "  summary              = EXCLUDED.summary,\n"
    "  recommendation       = EXCLUDED.recommendation,\n"
    "  per_question         = EXCLUDED.per_question,\n"
    "  recording_path       = CASE WHEN EXCLUDED.recording_path <> '' THEN EXCLUDED.recording_path ELSE interview_sessions.recording_path END,\n"
    "  requirements_match   = EXCLUDED.requirements_match\n"
    "RETURNING id"
)
nodes[idx['intTxSave']]['parameters']['query'] = SAVE_QUERY

# ── intSessQuery (Postgres query) ────────────────────────────────────────────
SESS_QUERY = (
    "SELECT \n"
    "  s.id,\n"
    "  s.candidate_id AS \"candidateId\",\n"
    "  s.evaluation_id AS \"evaluationId\",\n"
    "  s.job_opening_id AS \"jobOpeningId\",\n"
    "  s.candidate_name AS \"candidateName\",\n"
    "  s.duration_seconds AS \"durationSeconds\",\n"
    "  s.score_communication AS \"scoreComm\",\n"
    "  s.score_technical AS \"scoreTech\",\n"
    "  s.score_confidence AS \"scoreConf\",\n"
    "  s.score_culture_fit AS \"scoreCulture\",\n"
    "  s.score_overall AS \"scoreOverall\",\n"
    "  s.summary,\n"
    "  s.recommendation,\n"
    "  s.per_question AS \"perQuestion\",\n"
    "  s.qa_pairs AS \"qaPairs\",\n"
    "  s.recording_path AS \"recordingPath\",\n"
    "  s.requirements_match AS \"requirementsMatch\",\n"
    "  s.created_at AS \"completedAt\",\n"
    "  c.email AS \"candidateEmail\"\n"
    "FROM interview_sessions s\n"
    "JOIN candidates c ON c.id = s.candidate_id\n"
    "WHERE s.job_opening_id = {{ $json.jobId }}::integer\n"
    "ORDER BY s.created_at DESC"
)
nodes[idx['intSessQuery']]['parameters']['query'] = SESS_QUERY

nodes_json = json.dumps(nodes)

# Write both rows atomically
db.execute('UPDATE workflow_entity SET nodes=? WHERE id=?', (nodes_json, WF_ID))
db.execute('UPDATE workflow_history SET nodes=? WHERE versionId=?', (nodes_json, version_id))
db.commit()
db.close()

print(f'SUCCESS — versionId={version_id}')
print('Patched: build-intv-eval, parse-intv-eval, intTxPrep, intTxSave, intSessQuery')
