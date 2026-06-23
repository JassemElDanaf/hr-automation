# What n8n Does in This Project

## The short answer

n8n is the backend. There is no custom API server, no Express, no Django. Every HTTP request the React frontend makes goes to an n8n webhook, which runs a visual pipeline of nodes (validate → query Postgres → call Ollama → respond). n8n is the glue between the browser, the database, and the AI model.

---

## What n8n is

n8n is a self-hosted workflow automation tool. You build pipelines visually on a canvas — each step is a "node" that does one thing (run SQL, make an HTTP call, run JavaScript, etc.). Pipelines are triggered by webhooks, so they behave like HTTP API endpoints.

In this project n8n runs locally on **port 5678**. The React app sends `fetch` calls to `http://localhost:5678/webhook/...` and n8n responds with JSON, exactly like a conventional REST API — except no one wrote any server code.

---

## Why n8n instead of a real backend

- The whole project runs on one laptop with no cloud.
- n8n comes with built-in Postgres query nodes, HTTP request nodes, and a JavaScript sandbox — everything this project needs without writing boilerplate.
- Workflows are visible as diagrams, which makes it easier to demo the "how it works" part to non-technical stakeholders.
- The trade-off: editing logic means editing a workflow canvas (or hand-patching SQLite) rather than editing a `.js` file.

---

## The six workflows and what they do

| Workflow | Folder | What it handles |
|----------|--------|-----------------|
| **Phase 2 — Job Openings** | `workflows/phase1-job-opening/` | Create, list, edit, and toggle jobs. When `description_source` is `ai_generate`, it calls Ollama to write the job description. |
| **Phase 3 — CV Evaluation** | `workflows/phase2-cv-evaluation/` | Accept CV uploads, store candidates in Postgres, call Ollama to score each CV against the job's criteria, save scores. Also handles criteria-set CRUD and interview-question generation. |
| **Phase 4 — Shortlist** | `workflows/phase3-shortlist/` | Move candidates through the pipeline stages (shortlisted → interviewed → hired / rejected). Simple status updates in the `shortlist` table. |
| **Phase 5 — Emails** | `workflows/phase4-email/` | Send candidate emails via the SMTP sidecar, log every attempt to `email_log`, handle inbound replies POSTed by the IMAP sidecar. Computes SMTP health status from recent send outcomes. |
| **Phase 1 — Dashboard** | `workflows/phase5-dashboard/` | Aggregation queries that power the Dashboard KPI cards (candidate counts, shortlist rollups, per-job breakdowns). |
| **Phase 6 — Live Interview** | `workflows/phase6-live-interview/` | Question bank CRUD, candidate interview session management, AI-generated follow-up questions during a live session, candidate-facing session init. |

> The folder numbers on disk reflect build order. The workflow names inside n8n use the user-flow phase numbering (Dashboard is Phase 1 in the UI even though it was built in Phase 5). `docs/n8n.md` has the full endpoint list.

---

## What a request looks like end to end

Taking "score CVs for a job" as the example:

```
1. React app  →  POST /webhook/cv-evaluate  { job_opening_id: 7 }

2. n8n: Validate node
   - checks job_opening_id is present
   - fetches job's criteria_text from Postgres

3. n8n: Postgres node
   - SELECT unevaluated candidates for this job

4. n8n: Loop node (one iteration per candidate)

5. n8n: HTTP Request node
   - POST to Ollama at localhost:11434/api/generate
   - prompt = criteria + CV text
   - response = JSON scores (skills / experience / education / reasoning)

6. n8n: Postgres node
   - INSERT or UPDATE evaluations row with scores

7. n8n: Respond to Webhook node
   - returns { evaluated: N, total: M }

8. React app receives JSON, updates the results table
```

Every workflow follows this same shape: receive → validate → query → (optionally) call Ollama or a sidecar → respond.

---

## What n8n does NOT do

- **Send emails directly.** n8n POSTs to the Python SMTP sidecar on port 8901, which handles the actual SMTP connection. This is because n8n's built-in email node is clunky for multipart messages and attachment handling.
- **Poll the inbox.** The IMAP sidecar (`scripts/imap_server.py`) polls Gmail independently and POSTs inbound replies to n8n's `/inbound-email` webhook — n8n only receives those payloads and logs them.
- **Handle auth.** The auth sidecar (`scripts/auth_server.py`) on port 8904 owns login, sessions, and RBAC. n8n's own login screen is disabled entirely (`N8N_USER_MANAGEMENT_DISABLED=true`).
- **Serve the frontend.** The React app is served by Vite on port 3001. n8n is API-only.

---

## Where n8n data lives

| Thing | Path |
|-------|------|
| Workflow definitions (JSON nodes, connections) | `D:\n8n\.n8n\database.sqlite` → `workflow_entity` + `workflow_history` tables |
| Credentials (Postgres password, etc.) | Same SQLite file, encrypted |
| Execution history | Same SQLite file |
| Exported workflow JSONs (version-controlled) | `workflows/phase*/` in this repo |

**Important:** n8n executes from `workflow_history`, not `workflow_entity`. If you patch the SQLite directly, you must update both tables (see `docs/n8n.md` for the exact query). The repo JSONs in `workflows/` are snapshots — they are exported after changes and committed for version control, but they are not what n8n runs from at runtime.

---

## Credentials n8n needs

One Postgres credential, named exactly **`HR PostgreSQL`**, pointing at:

```
Host: localhost  |  Port: 5432  |  DB: hr_automation  |  User: hr_admin  |  Pass: hr_pass
```

All six workflows share this single credential. It is stored in the SQLite file and never in the repo.

---

## Restarting n8n

After any SQLite patch, or if webhooks start returning 404:

```bash
taskkill /f /im node.exe    # Windows — kills the n8n Node process
# then re-run start.sh (or the launcher)
```

Webhooks re-register automatically ~15–30 seconds after `/healthz` returns `{"status":"ok"}`. There is no manual activation step needed under normal circumstances.
