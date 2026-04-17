# n8n — Setup, Workflows, and Operations

> **Project status:** Proof of concept, pre-finalization. All five workflows are imported, active, and responding to the frontend; further tightening and a few new endpoints are planned before handoff. See `report/report.pdf` for the stakeholder progress report.

n8n is the project's API gateway and business-logic engine. All browser requests land on n8n webhooks.

---

## How n8n Runs Here

- Installed globally via npm (`npm install -g n8n`) or invoked via `npx n8n start`
- Listens on port **5678** (UI + webhook API)
- Data directory: `E:\n8n\` — contains `database.sqlite` with workflow definitions, credentials, executions. Redirected from default `%USERPROFILE%\.n8n\` via `N8N_USER_FOLDER=/e/n8n` in `start.sh`
- `start.sh` exports `N8N_USER_MANAGEMENT_DISABLED=true` and `N8N_AUTH_EXCLUDE_ENDPOINTS=*` to skip the login screen

---

## Starting / Stopping

### Start (backgrounded)
```bash
npx n8n start > /dev/null 2>&1 &
```
This is what `start.sh` does. Verify:
```bash
curl -s http://localhost:5678/healthz
# expected: {"status":"ok"}
```

### Start (foregrounded for logs)
```bash
npx n8n start
```

### Stop
```bash
pkill -f "npx n8n start"
```
Or close the terminal running it.

---

## Access the UI

Open <http://localhost:5678> in your browser. With user management disabled, no login is required.

---

## Workflow ↔ Phase Mapping

The folder names on disk reflect build order. The workflow **name and tags** inside each JSON reflect the user-flow phase numbering.

| Folder on disk | Workflow name (n8n UI) | Phase | What it does |
|----------------|------------------------|-------|--------------|
| `workflows/phase5-dashboard/phase5-dashboard.json` | Phase 1 - Dashboard | **1** | Dashboard aggregates |
| `workflows/phase1-job-opening/phase1-job-opening.json` | Phase 2 - Job Openings | **2** | Job opening CRUD + toggle |
| `workflows/phase2-cv-evaluation/phase2-cv-evaluation.json` | Phase 3 - CV Evaluation | **3** | CV submit, evaluate, criteria, generate-criteria |
| `workflows/phase3-shortlist/phase3-shortlist.json` | Phase 4 - Shortlist | **4** | Shortlist status management |
| `workflows/phase4-email/phase4-email.json` | Phase 5 - Emails | **5** | Email send + history |

---

## Webhook Endpoints

All paths are prefixed with `http://localhost:5678/webhook`.

### Phase 1 — Dashboard
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/dashboard-candidates` | Candidate counts across jobs |
| GET | `/dashboard-shortlist` | Shortlist status rollup |

### Phase 2 — Job Openings
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/job-openings` | List (query: `is_active`, `status`) |
| POST | `/job-openings` | Create |
| GET | `/job-opening?id=N` | Get one |
| POST | `/job-opening-toggle?id=N` | Toggle `is_active` |
| POST | `/job-opening-update` | Update job fields (title, dept, type, etc.) |

### Phase 3 — CV Evaluation
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/cv-submit` | Add candidate + CV text |
| POST | `/cv-evaluate` | Score unscored candidates for a job |
| GET | `/candidates?job_id=N` | List candidates for a job |
| GET | `/evaluations?job_id=N` | List evaluation rows |
| GET | `/criteria-sets?job_id=N` | List saved criteria sets |
| POST | `/criteria-sets` | Save a named criteria set |
| POST | `/generate-criteria` | Ollama generates structured criteria |

### Phase 4 — Shortlist
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/shortlist?job_id=N` | List shortlist rows for a job |
| POST | `/shortlist` | Add candidate to shortlist |
| POST | `/shortlist-update` | Change status (`interviewed`/`hired`/`rejected`) |

### Phase 5 — Emails
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/send-email` | Send via SMTP sidecar + log |
| GET | `/email-history?job_id=N` | List email log rows |

**`POST /send-email` request shape** (used by every candidate email flow):

```jsonc
{
  "candidate_id": 42,
  "job_opening_id": 7,
  "email_type": "rejection",          // or "interview_invite" | "offer" | "custom"
  "recipient_email": "jane@acme.com",
  "candidate_name": "Jane Doe",
  "job_title": "Senior Engineer",
  "custom_subject": "Application Update - Senior Engineer",   // required — user-edited
  "custom_body":    "Dear Jane,\n\nThank you for..."           // required — user-edited
}
```

The Validate node seeds a default subject/body from `email_type` and then **always** applies `custom_subject` / `custom_body` on top if present. The frontend (`openEmailComposer`) sends them on every call, so the backend defaults are only a safety net for malformed client requests. If you add a new email type, update the `validTypes` list and the default-template branch in `workflows/phase4-email/phase4-email.json` (node: "Send - Validate & Build Email").

---

## Import / Export

### Import a workflow
```bash
npx n8n import:workflow --input=workflows/phase2-cv-evaluation/phase2-cv-evaluation.json
```
Or via UI: Menu → Import from File.

### Bulk import
```bash
bash scripts/import-workflows.sh
```
(Note: the script currently only iterates `phase1-job-opening/`. Extend it or run CLI imports for the other phases.)

### Export a workflow (to update the JSON in the repo)
```bash
npx n8n export:workflow --id=<workflow_id> --output=workflows/phase-foo/phase-foo.json --pretty
```

---

## Activating Workflows

After import, each workflow must be activated before its webhooks respond.

### Via UI
1. Open the workflow
2. Toggle "Active" in the top right
3. Test: `curl http://localhost:5678/webhook/<path>`

### If webhooks return 404 after activation
Known n8n bug: the `activeVersionId` column is sometimes not set. Fix via SQLite:

```bash
# stop n8n first
pkill -f "npx n8n start"

# locate the DB
cd /e/n8n

# update
sqlite3 database.sqlite <<'SQL'
UPDATE workflow_entity
   SET active = 1,
       activeVersionId = versionId
 WHERE id IN ('1', '2', '3', '4', '5');
SQL

# restart n8n
npx n8n start
```

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

Credentials live in `E:\n8n\database.sqlite` (encrypted). They are **not** exported with workflow JSON.

### SMTP
This project **does not use n8n's SMTP credential**. Emails go through the Python sidecar on port 8901, which reads SMTP env vars from `.env`.

---

## How the Frontend Talks to n8n

Frontend constant:
```js
const API = 'http://localhost:5678/webhook';
```

Every `fetch` call concatenates a path to this. CORS is permissive in dev n8n, so browser → webhook calls work without extra config.

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
  -d '{"job_id": 1}'
```

---

## Editing Workflows

Prefer editing in the n8n UI (visual canvas), then export via `n8n export:workflow` and commit the updated JSON. Editing the JSON by hand is possible but error-prone because of coordinate/ID bookkeeping.

When you do hand-edit JSON (e.g., adding a connection):
- Update `connections` object
- Ensure target node name exists in `nodes` array
- Increment `triggerCount` only if you added a new trigger node
- Re-import and reactivate (see above)
