# Runbook — Local Setup and Operations

Step-by-step instructions to bring up, operate, and shut down every service in the HR Automation stack on a Windows workstation.

---

## 1. Prerequisites

Install these once on the host machine:

| Tool | Version | Install from | Why |
|------|---------|--------------|-----|
| **Docker Desktop** | Any modern | <https://www.docker.com/products/docker-desktop/> | Runs PostgreSQL |
| **Node.js** | >= 18 | Installed at `D:\NodeJS\` | Runs n8n and the React frontend |
| **Python** | >= 3.9 | <https://www.python.org/downloads/> | Runs the SMTP and IMAP sidecars |
| **Ollama** | Latest | Installed at `D:\ollama\` | Local AI (JD generation, criteria, CV scoring) |
| **Git for Windows** | Latest | <https://git-scm.com/download/win> | Git Bash (used by `launch.bat`) |
| **qwen3:4b model** | — | `ollama pull qwen3:4b` | Model used by all AI pipeline steps |

Verify each install:
```bash
docker --version
node --version
python --version
"D:/ollama/program/ollama.exe" --version
```

---

## 2. Machine and Drive Layout

All runtime data lives on D:\. Do not look at E:\ for any of this.

| What | Path |
|------|------|
| Project source code | `D:\OneDrive\Desktop\Diyar\hr-automation\` |
| n8n install + node_modules | `D:\n8n\` |
| n8n runtime data | `D:\n8n\.n8n\` |
| n8n SQLite database | `D:\n8n\.n8n\database.sqlite` |
| Node.js runtime | `D:\NodeJS\` |
| Ollama program | `D:\ollama\program\ollama.exe` |
| Ollama models | `D:\ollama\` |
| Docker | Managed by Docker Desktop (WSL2 default location) |

### Project folder structure

```
D:\OneDrive\Desktop\Diyar\hr-automation\
  launch.bat                   <- double-click to start everything
  start.sh                     <- called by launch.bat; also usable standalone
  .env                         <- local secrets (SMTP, IMAP)       gitignored
  .env.example                 <- template
  frontend-react/              <- React + Vite frontend (the only frontend)
    src/
      pages/                   <- Dashboard, JobOpenings, CVEvaluation, Shortlist, Emails
      components/              <- layout, common, modals, forms, tables
      state/                   <- selectedJob, uiState (React Context)
      services/                <- api.js, email.js
      styles/                  <- global.css
      utils/                   <- helpers.js, pdf.js
    .env                       <- VITE_API_URL
    vite.config.js
  workflows/
    phase5-dashboard/          <- Phase 1 - Dashboard
    phase1-job-opening/        <- Phase 2 - Job Openings
    phase2-cv-evaluation/      <- Phase 3 - CV Evaluation
    phase3-shortlist/          <- Phase 4 - Shortlist
    phase4-email/              <- Phase 5 - Emails
  db/
    schema.sql
    migrations/                <- numbered SQL files, run in order
  scripts/
    smtp_server.py             <- SMTP sidecar (port 8901)
    imap_server.py             <- IMAP polling sidecar (port 8902)
    recording_server.py        <- recording server (port 8903)
    patch_ollama_thinking.py   <- patches n8n workflow nodes in sqlite
  docs/                        <- this folder
  report/
    report.tex
    report.pdf
    images/
```

---

## 3. First-Time Setup

Run these steps once on a fresh machine. Skip to [Daily Startup](#4-daily-startup) afterward.

### 3.1 Create `.env`

```bash
cp .env.example .env
```

Open `.env` and fill in SMTP credentials. The following variables control email sending:

| Variable | Required | Notes |
|----------|----------|-------|
| `SMTP_HOST` | No | Without it, emails are logged but not sent |
| `SMTP_PORT` | No | Defaults to 587 |
| `SMTP_USER` | No | Gmail address |
| `SMTP_PASS` | No | Gmail App Password (not your account password) |
| `SMTP_FROM` | No | Display name + address for outbound mail |

### 3.2 Pull the Ollama model

```bash
"D:/ollama/program/ollama.exe" pull qwen3:4b
```

### 3.3 Create the Postgres container

```bash
docker run -d --name hr-postgres \
  -e POSTGRES_USER=hr_admin \
  -e POSTGRES_PASSWORD=hr_pass \
  -e POSTGRES_DB=hr_automation \
  -p 5432:5432 \
  postgres:16
```

### 3.4 Apply schema and all migrations

```bash
docker exec -i hr-postgres psql -U hr_admin -d hr_automation < db/schema.sql

for f in db/migrations/*.sql; do
  docker exec -i hr-postgres psql -U hr_admin -d hr_automation < "$f"
done
```

### 3.5 Import n8n workflows and activate them

Import each workflow JSON via the n8n UI (Settings > Import Workflow) or use the CLI:

```bash
npx n8n import:workflow --input=workflows/phase1-job-opening/phase1-job-opening.json
# repeat for each workflow
```

Then activate all 6 workflows in the n8n UI (toggle "Active" in the top-right of each workflow editor).

### 3.6 Configure the n8n PostgreSQL credential

In n8n: Settings > Credentials > Add Credential > Postgres

| Field | Value |
|-------|-------|
| Name | `HR PostgreSQL` (must be exact — workflows reference this name) |
| Host | `localhost` |
| Port | `5432` |
| Database | `hr_automation` |
| User | `hr_admin` |
| Password | `hr_pass` |

---

## 4. Daily Startup

**Recommended:** double-click `launch.bat` in the project root.

It invokes `start.sh` inside Git Bash, starts all services in dependency order, and opens <http://localhost:3001> automatically.

**Manual equivalent:**

```bash
bash "D:/OneDrive/Desktop/Diyar/hr-automation/start.sh"
```

### Startup order enforced by `start.sh`

| Step | Service | Detail |
|------|---------|--------|
| 1 | Docker Desktop | Waits up to 2 minutes if not already running |
| 2 | hr-postgres | `docker start hr-postgres` |
| 3 | Ollama | `D:\ollama\program\ollama.exe serve` in background |
| 4 | SMTP sidecar | `python scripts/smtp_server.py`, port 8901 |
| 5 | IMAP sidecar | `python scripts/imap_server.py`, port 8902 |
| 6 | Recording server | `python scripts/recording_server.py`, port 8903 |
| 7 | n8n | port 5678; data in `D:\n8n\` via `N8N_USER_FOLDER=/d/n8n` |
| 8 | DB migrations | Runs all `db/migrations/0*.sql` idempotently |
| 9 | React frontend | `npx vite --port 3001` in background |
| 10 | Browser | Opens <http://localhost:3001> |

### Environment variables set by `start.sh`

```bash
export PATH="/d/NodeJS:/d/n8n/node_modules/.bin:/c/Users/Jasse/AppData/Roaming/npm:$PATH"
export N8N_USER_FOLDER=/d/n8n
export OLLAMA_MODELS=/d/ollama
export OLLAMA_HOME=/d/ollama
```

---

## 5. Verify Services Are Up

Run each check and confirm the expected response:

```bash
# Docker daemon
docker info | head -3

# PostgreSQL
docker exec hr-postgres pg_isready -U hr_admin
# expected: "localhost:5432 - accepting connections"

# Ollama
curl -s http://localhost:11434/api/tags
# expected: JSON with "models" array including qwen3:4b

# SMTP sidecar
curl -s http://127.0.0.1:8901/
# expected: {"status":"ok","smtp_configured":true,...}

# IMAP sidecar
curl -s http://127.0.0.1:8902/

# n8n (use a webhook endpoint — /healthz has no CORS headers and cannot be used from the browser)
curl -s http://localhost:5678/webhook/interview/jobs
# expected: any valid JSON response (not connection refused)

# React frontend
curl -I http://localhost:3001
# expected: HTTP/1.1 200 OK
```

### Post-startup checklist

- [ ] Dashboard loads; shows job and candidate counts and charts
- [ ] Job Openings: create, edit, toggle active/inactive all work
- [ ] CV Evaluation: select job, upload CV, run evaluation (Ollama), view scores
- [ ] Shortlist: candidate cards visible, status transitions work, emails send
- [ ] Emails: history loads, SMTP badge shows configured
- [ ] Live Interview: QBank loads, generate link works

---

## 6. Shutdown

`start.sh` does not stop services; they keep running in the background. To stop everything on Windows:

```bash
taskkill /f /im node.exe      # stops n8n and the React dev server
taskkill /f /im python.exe    # stops all Python sidecars
taskkill /f /im ollama.exe    # stops Ollama
docker stop hr-postgres
```

Alternatively, use Task Manager to end the `node.exe`, `python.exe`, and `ollama.exe` processes.

---

## 7. n8n Workflow Patching Protocol

When you need to fix a node's code directly in sqlite (bypassing the UI), you must patch **both** `workflow_entity` and the matching `workflow_history` row. Patching only `workflow_entity` has no effect at runtime — n8n executes the snapshot stored in `workflow_history` indexed by `activeVersionId`.

```python
import sqlite3, json

DB = 'D:/n8n/.n8n/database.sqlite'
db = sqlite3.connect(DB)

# Read current nodes
wf_id = 'N'   # replace with actual workflow ID (1-6)
ver = db.execute(
    "SELECT activeVersionId FROM workflow_entity WHERE id=?", (wf_id,)
).fetchone()[0]

nodes = json.loads(
    db.execute("SELECT nodes FROM workflow_entity WHERE id=?", (wf_id,)).fetchone()[0]
)

# --- make changes to nodes here ---

db.execute(
    "UPDATE workflow_entity SET nodes=? WHERE id=?",
    (json.dumps(nodes), wf_id)
)
db.execute(
    "UPDATE workflow_history SET nodes=? WHERE versionId=?",
    (json.dumps(nodes), ver)
)
db.commit()
db.close()

# Then restart n8n:
# taskkill /f /im node.exe
# (then run start.sh or start n8n manually)
```

After any REST API deactivate/activate cycle, `activeVersionId` is cleared by n8n. Re-patch the DB with `active=1, activeVersionId=<ver>` before calling activate again.

### n8n workflow IDs

| ID | Workflow name |
|----|---------------|
| 1 | Phase 2 - Job Openings |
| 2 | Phase 3 - CV Evaluation |
| 3 | Phase 4 - Shortlist |
| 4 | Phase 5 - Emails |
| 5 | Phase 1 - Dashboard |
| 6 | Phase 6 - Live Interview |

### n8n REST API authentication

```bash
# Login — saves session cookie to /tmp/n8n.txt. Credentials come from .env
# (gitignored): N8N_REST_USER / N8N_REST_PASSWORD. Do not hardcode them here.
# With N8N_USER_MANAGEMENT_DISABLED=true this endpoint may 404; webhooks
# self-register ~15-30s after /healthz is ok, so usually just wait instead.
curl -c /tmp/n8n.txt http://localhost:5678/rest/login -X POST \
  -H "Content-Type: application/json" \
  -d "{\"emailOrLdapLoginId\":\"$N8N_REST_USER\",\"password\":\"$N8N_REST_PASSWORD\"}"

# Activate a workflow
curl -b /tmp/n8n.txt http://localhost:5678/rest/workflows/WF_ID/activate \
  -X POST -H "Content-Type: application/json" \
  -d '{"versionId":"VERSION_ID"}'
```

`VERSION_ID` comes from `workflow_history` (the latest row for the workflow).

---

## 8. Common Operations

### Remote candidate interviews (sending an interview link)

Interview links only work for a remote candidate if they can reach the app.
Everything the candidate page needs (API + recording upload) is served
same-origin through the vite dev server's proxy, so **one tunnel to port 3001
covers the whole flow**:

```bash
cloudflared tunnel --url http://localhost:3001
```

1. Start the tunnel and copy the `https://<random>.trycloudflare.com` URL.
2. Open the app **through that URL** (not localhost) — the generated link
   inherits whatever origin you're on (`VITE_PUBLIC_URL` in
   `frontend-react/.env` overrides it if you have a stable address).
3. Generate the link in Live Interview → Setup and send it.
4. Kill the tunnel when done — while it runs, the URL is publicly reachable.

The HTTPS tunnel is also what lets the candidate's browser grant mic/camera
access (`getUserMedia` requires a secure context). A plain `http://<LAN-IP>`
link will load but the mic will be blocked.

**Never tunnel port 5678 directly** — n8n runs with auth disabled, so that
exposes the full n8n editor (and every workflow) to anyone with the URL. The
3001 tunnel only exposes the app plus the proxied `/webhook` + `/recording`
endpoints.

### Reset the database

```bash
docker exec -it hr-postgres psql -U hr_admin -d hr_automation \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

docker exec -i hr-postgres psql -U hr_admin -d hr_automation < db/schema.sql

for f in db/migrations/*.sql; do
  docker exec -i hr-postgres psql -U hr_admin -d hr_automation < "$f"
done
```

### Restart only the SMTP sidecar

```bash
taskkill /f /im python.exe
python scripts/smtp_server.py
```

### Tail n8n logs

n8n output is redirected to `/dev/null` when launched via `start.sh`. For verbose logs, stop n8n and run it manually:

```bash
taskkill /f /im node.exe
npx n8n start
```

### Rebuild the progress report

The stakeholder PDF in `report/report.pdf` is compiled from `report/report.tex` using MiKTeX. Run `pdflatex` twice so the TOC and section numbering resolve correctly:

```bash
cd "D:/OneDrive/Desktop/Diyar/hr-automation/report"
"C:/Users/Jasse/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdflatex.exe" report.tex
"C:/Users/Jasse/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdflatex.exe" report.tex
```

To swap a screenshot, drop a new PNG into `report/images/` with the matching filename (lowercase, hyphen-separated, e.g. `dashboard.png`) and recompile.

---

## 9. API Endpoints Quick Reference

Full mapping in [`n8n.md`](n8n.md). Commonly used:

```bash
# Phase 2 - Job Openings
curl http://localhost:5678/webhook/job-openings
curl -X POST http://localhost:5678/webhook/job-openings \
  -H 'Content-Type: application/json' -d '{...}'

# Phase 3 - CV Evaluation
curl "http://localhost:5678/webhook/candidates?job_id=1"
curl "http://localhost:5678/webhook/evaluations?job_id=1"
curl -X POST http://localhost:5678/webhook/cv-evaluate \
  -H 'Content-Type: application/json' -d '{"job_id":1}'

# Phase 4 - Shortlist
curl "http://localhost:5678/webhook/shortlist?job_id=1"

# Phase 5 - Emails
curl "http://localhost:5678/webhook/email-history?job_id=1"
```

---

## 10. Troubleshooting

See [`troubleshooting.md`](troubleshooting.md) for symptom-by-symptom fixes.
