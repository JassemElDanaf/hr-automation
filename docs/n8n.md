# n8n — Setup, Workflows, and Operations

n8n is the project's API gateway and business-logic engine. All browser requests land on n8n webhooks.

---

## How n8n Runs Here

- Installed locally in `D:\n8n\node_modules`
- Invoked directly via Node: `/d/NodeJS/node.exe /d/n8n/node_modules/.bin/n8n start`
- Listens on port **5678** (UI + webhook API)
- Data directory: `D:\n8n\.n8n\` — contains `database.sqlite` with workflow definitions, credentials, and executions. Set via `N8N_USER_FOLDER=/d/n8n` in `start.sh`
- `start.sh` exports `N8N_USER_MANAGEMENT_DISABLED=true` and `N8N_DIAGNOSTICS_ENABLED=false` to skip the login screen

**All runtime data lives on D:\. Never read from or write to E:\ — that path is stale and unused.**

---

## Starting / Stopping

### Start

Run from `D:\n8n` with the env vars set (as `start.sh` does):

```bash
export N8N_USER_FOLDER=/d/n8n
export N8N_USER_MANAGEMENT_DISABLED=true
export N8N_DIAGNOSTICS_ENABLED=false
/d/NodeJS/node.exe /d/n8n/node_modules/.bin/n8n start
```

Verify n8n is up:
```bash
curl -s http://localhost:5678/healthz
# expected: {"status":"ok"}
```

### Stop

On Windows, kill the Node process:
```
taskkill /f /im node.exe
```
Or use Task Manager to end the `node.exe` process. Note: this also terminates any other Node processes running at the time.

---

## Access the UI

Open <http://localhost:5678> in your browser. With user management disabled, no login is required.

If a login prompt appears, the `N8N_USER_MANAGEMENT_DISABLED` env var was not set at startup. Kill all `node.exe` processes and rerun `start.sh`.

---

## Workflow / Phase Mapping

Folder names on disk reflect build order; the **workflow name inside n8n** uses the user-flow phase numbering.

| n8n ID | Internal Name | Folder on disk | User-flow Phase |
|--------|--------------|----------------|-----------------|
| 1 | Phase 2 - Job Openings | `workflows/phase1-job-opening/` | 2 |
| 2 | Phase 3 - CV Evaluation | `workflows/phase2-cv-evaluation/` | 3 |
| 3 | Phase 3 - Shortlist | `workflows/phase3-shortlist/` | 4 |
| 4 | Phase 4 - Email Notifications | `workflows/phase4-email/` | 5 |
| 5 | Phase 5 - Dashboard | `workflows/phase5-dashboard/` | 1 |
| 6 | Phase 6 - Live Interview | `workflows/phase6-live-interview/` | 6 |

All six workflows are active in the live database at `D:\n8n\.n8n\database.sqlite`.

---

## Webhook Endpoints

All paths are prefixed with `http://localhost:5678/webhook`.

### Phase 1 — Dashboard (workflow ID 5)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/dashboard-candidates?job_id=all\|N` | Candidate counts across jobs, or for one job |
| GET | `/dashboard-shortlist` | Shortlist status rollup |

### Phase 2 — Job Openings (workflow ID 1)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/job-openings` | List all job openings |
| POST | `/job-openings` | Create a new job opening |
| GET | `/job-opening?id=N` | Get one job (includes full `job_description`) |
| POST | `/job-opening-toggle` | Toggle `is_active`; also sets `status` to `open`/`closed` |
| POST | `/job-opening-update` | Edit fields on an existing job |

`POST /job-openings` body: `job_title`, `department`, `employment_type`, `seniority_level`, `location_type`, `description_source`, `job_description`, `reporting_to` (optional)

`POST /job-opening-toggle` body: `{id}`

`POST /job-opening-update` body: `{id, job_title?, department?, employment_type?, seniority_level?, location_type?, reporting_to?, job_description?}` — only include fields to change.

### Phase 3 — CV Evaluation (workflow ID 2)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/cv-submit` | Add a candidate + CV |
| POST | `/cv-evaluate` | Run Ollama scoring on all unevaluated candidates for a job |
| GET | `/candidates?job_id=N` | List candidates for a job |
| GET | `/evaluations?job_id=N` | List evaluation rows for a job |
| GET | `/criteria-sets?job_id=N` | List saved criteria sets |
| POST | `/criteria-sets` | Save a named criteria set |
| POST | `/generate-criteria` | Ollama generates criteria from a job description |
| GET | `/cv-file?candidate_id=N` | Returns `{cv_file_name, cv_file_data (base64), cv_file_mime}` |
| POST | `/generate-interview-questions` | Ollama generates interview questions for a candidate |
| POST | `/remove-from-shortlist` | Remove a candidate from the shortlist |

`POST /cv-submit` body: `{job_opening_id, candidate_name, email?, cv_text, cv_file_name?, cv_file_data?, cv_file_mime?}`

`POST /cv-evaluate` body: `{job_opening_id}`

`POST /generate-interview-questions` body: `{candidate_id, job_id, num_questions, include_hr, include_technical, include_salary, extra_context?}`

`POST /remove-from-shortlist` body: `{id}` or `{candidate_id, job_opening_id}`

### Phase 4 — Shortlist (workflow ID 3)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/shortlist?job_id=N` | List shortlist rows for a job |
| POST | `/add-to-shortlist` | Add a candidate to the shortlist |
| POST | `/update-shortlist-status` | Change shortlist status |
| POST | `/remove-from-shortlist` | Remove a candidate from the shortlist |

`POST /add-to-shortlist` body: `{candidate_id, job_opening_id}`

`POST /update-shortlist-status` body: `{id, status}` — status must be one of: `shortlisted` / `interviewed` / `hired` / `rejected`

### Phase 5 — Emails (workflow ID 4)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/send-email` | Send an email via the SMTP sidecar and log the attempt |
| GET | `/email-history?job_id=N` | List email log rows for a job |
| POST | `/inbound-email` | Called by the IMAP sidecar with an inbound reply payload |

`POST /send-email` body:
```jsonc
{
  "candidate_id": 42,
  "job_opening_id": 7,
  "email_type": "rejection",       // rejection | interview_invite | offer | custom | recommendation
  "recipient_email": "jane@acme.com",
  "candidate_name": "Jane Doe",
  "job_title": "Senior Engineer",
  "custom_subject": "Application Update - Senior Engineer",
  "custom_body": "Dear Jane,\n\nThank you for..."
}
```

The Validate node seeds a default subject/body from `email_type` and then always applies `custom_subject`/`custom_body` on top. The frontend sends them on every call. If you add a new email type, update the `validTypes` list in the workflow's "Send - Validate & Build Email" node.

### Phase 6 — Live Interview (workflow ID 6)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/interview/jobs` | List active jobs for the dropdown |
| GET | `/interview/question-bank` | List all question bank entries |
| POST | `/interview/question-bank` | Add a question |
| PUT | `/interview/question-bank?id=N` | Edit a question |
| DELETE | `/interview/question-bank?id=N` | Delete a question |
| POST | `/interview/next-question` | AI generates the next question during a live session |
| GET | `/interview/start` | Candidate interview session init (public, no auth) |

`POST /interview/question-bank` body: `{question, category, jobType, modelAnswer}`

`PUT /interview/question-bank?id=N` body: `{question, category, jobType, modelAnswer}`

---

## Credentials

### PostgreSQL

All workflows reference a credential named exactly **`HR PostgreSQL`**. Configure once in n8n → Settings → Credentials:

| Field | Value |
|-------|-------|
| Host | `localhost` |
| Port | `5432` |
| Database | `hr_automation` |
| User | `hr_admin` |
| Password | `hr_pass` |
| SSL | disable |

Credentials live in `D:\n8n\.n8n\database.sqlite` (encrypted). They are not exported with workflow JSON.

### SMTP

This project does not use n8n's built-in SMTP credential. Emails go through the Python sidecar on port 8901, which reads SMTP env vars from `.env`.

---

## How the Frontend Talks to n8n

Frontend constant (from `VITE_API_URL` in `.env`):
```js
const API = 'http://localhost:5678/webhook';
```

Every `fetch` call concatenates a path to this. CORS is permissive in dev n8n, so browser-to-webhook calls work without extra config.

---

## CRITICAL: Patching Workflows in the Live DB

n8n executes from `workflow_history.nodes` indexed by `workflow_entity.activeVersionId`. Any SQLite patch **must** update both tables:

```python
# Always patch both:
db.execute("UPDATE workflow_entity SET nodes=? WHERE id=?", (new_nodes, wf_id))
ver = db.execute("SELECT activeVersionId FROM workflow_entity WHERE id=?", (wf_id,)).fetchone()[0]
db.execute("UPDATE workflow_history SET nodes=? WHERE versionId=?", (new_nodes, ver))
db.commit()
# Then restart n8n (taskkill /f /im node.exe, then start again)
```

Updating only `workflow_entity.nodes` leaves the runtime unchanged — n8n keeps executing the old snapshot from `workflow_history`. See `scripts/applied/patch_ollama_thinking.py` for the canonical example.

The live DB path is always: `D:\n8n\.n8n\database.sqlite`

Never derive the DB path from `USERPROFILE` or `HOME` — those resolve to C drive regardless of where n8n actually runs.

---

## If Webhooks Return 404

The workflow is active in the DB but its webhooks are not registered in memory. Fix options:

**Option A — UI toggle (simplest):**
Open <http://localhost:5678>, find the workflow, toggle it OFF, then back ON.

**Option B — REST API:**
```bash
# Get session cookie — credentials come from .env (gitignored):
# N8N_REST_USER / N8N_REST_PASSWORD. Do not hardcode them here.
# With N8N_USER_MANAGEMENT_DISABLED=true this endpoint may 404; webhooks
# self-register ~15-30s after /healthz is ok, so usually just wait instead.
curl -c /tmp/n8n.txt http://localhost:5678/rest/login -X POST \
  -H "Content-Type: application/json" \
  -d "{\"emailOrLdapLoginId\":\"$N8N_REST_USER\",\"password\":\"$N8N_REST_PASSWORD\"}"

# Activate (replace WF_ID and VERSION_ID)
curl -b /tmp/n8n.txt http://localhost:5678/rest/workflows/WF_ID/activate \
  -X POST -H "Content-Type: application/json" \
  -d '{"versionId":"VERSION_ID"}'
```

`VERSION_ID` comes from the latest row in `workflow_history` for that workflow.

**CRITICAL after any deactivate/activate cycle via REST:** calling `/deactivate` clears `activeVersionId` in `workflow_entity`. Always re-patch the DB before calling `/activate`:

```sql
UPDATE workflow_entity SET active=1, activeVersionId='<ver>' WHERE id='<wf_id>';
```

Then call the `/activate` endpoint with that same `versionId`.

---

## Import / Export

### Import a workflow
```bash
/d/NodeJS/node.exe /d/n8n/node_modules/.bin/n8n import:workflow \
  --input=workflows/phase2-cv-evaluation/phase2-cv-evaluation.json
```
Or via UI: Menu → Import from File.

### Export a workflow (to update the JSON in the repo)
```bash
/d/NodeJS/node.exe /d/n8n/node_modules/.bin/n8n export:workflow \
  --id=<workflow_id> --output=workflows/phase-foo/phase-foo.json --pretty
```

---

## Debugging Failed Executions

### Open the execution log
1. n8n UI → Executions tab
2. Filter by workflow name
3. Click a red (failed) execution to see which node failed and what payload

### Re-run with modified data
From the execution detail page, click "Retry" or edit the input and run.

### Add logging inside a Code node
```js
console.log('DEBUG:', JSON.stringify($input.all(), null, 2));
return $input.all();
```
Logs appear in the terminal running n8n (not the UI).

### Test a webhook manually
```bash
curl -v -X POST http://localhost:5678/webhook/cv-evaluate \
  -H 'Content-Type: application/json' \
  -d '{"job_opening_id": 1}'
```

---

## Editing Workflows

Prefer editing in the n8n UI (visual canvas), then export via the CLI and commit the updated JSON. When hand-editing JSON:

- Update the `connections` object
- Ensure every target node name exists in the `nodes` array
- After editing, patch both `workflow_entity` and `workflow_history` in the live SQLite (see CRITICAL section above)
- Restart n8n after any SQLite patch
