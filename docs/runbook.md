# Runbook — Local Setup and Operations

> **Project status:** Proof of concept, pre-finalization. See `report/report.pdf` for the stakeholder progress report.

Step-by-step instructions to bring up, operate, and shut down every service in the HR Automation stack on a Windows workstation.

---

## 1. Prerequisites

Install these once on the host machine:

| Tool | Version | Install from | Why |
|------|---------|--------------|-----|
| **Docker Desktop** | Any modern | <https://www.docker.com/products/docker-desktop/> | Runs PostgreSQL |
| **Node.js** | ≥ 18 | <https://nodejs.org/> | Runs n8n and the static frontend server |
| **Python** | ≥ 3.9 | <https://www.python.org/downloads/> | Runs the SMTP sidecar |
| **Ollama** | Latest | <https://ollama.com/> | Local AI (JD + criteria + scoring) |
| **Git for Windows** | Latest | <https://git-scm.com/download/win> | Git Bash (used by `launch.bat`) |
| **qwen3:4b model** | — | `ollama pull qwen3:4b` | Model used by the pipeline |

Verify each install:
```bash
docker --version
node --version
python --version
ollama --version
```

---

## 2. Project Layout

Everything is under one folder. Default location on this machine:

```
E:/OneDrive - American University of Beirut/Diyar/hr-automation/
  claude.md                    ← project memory, READ FIRST
  README.md
  launch.bat                   ← double-click to start everything
  start.sh                     ← called by launch.bat; also usable standalone
  .env                         ← local secrets (SMTP)        — gitignored
  .env.example                 ← template
  .gitignore
  frontend/
    index.html                 ← legacy SPA (single HTML file)
    server.js                  ← optional Node server (normally unused)
  frontend-react/              ← NEW: React + Vite frontend
    src/
      pages/                   ← Dashboard, JobOpenings, CVEvaluation, Shortlist, Emails
      components/              ← layout, common, modals, forms, tables
      state/                   ← selectedJob, uiState (React Context)
      services/                ← api.js, email.js
      styles/                  ← global.css
      utils/                   ← helpers.js, pdf.js
    .env                       ← VITE_API_URL
    vite.config.js
  workflows/
    phase1-job-opening/        ← now "Phase 2 - Job Openings" internally
    phase2-cv-evaluation/      ← now "Phase 3 - CV Evaluation"
    phase3-shortlist/          ← now "Phase 4 - Shortlist"
    phase4-email/              ← now "Phase 5 - Emails"
    phase5-dashboard/          ← now "Phase 1 - Dashboard"
  db/
    schema.sql
    seed.sql
    migrations/                ← numbered SQL files, run in order
  scripts/
    setup-db.sh                ← creates the Postgres container
    seed-db.sh                 ← loads sample data
    import-workflows.sh        ← bulk imports workflow JSONs
    smtp_server.py             ← SMTP sidecar
    test-phase1.sh             ← smoke test for the Job Openings API
  data/
    samples/                   ← sample JSON request bodies
  docs/                        ← this folder
  report/                      ← LaTeX progress report + compiled PDF for stakeholders
    report.tex
    report.pdf
    images/                    ← screenshots and logo used by the report
  future/                      ← notes / drafts not part of the running system
```

---

## 3. First-Time Setup

Run these once on a fresh machine. Skip to [Daily Startup](#4-daily-startup) afterward.

### 3.1 Create `.env`
```bash
cp .env.example .env
# then edit .env and fill in SMTP_USER / SMTP_PASS
```

### 3.2 Pull the Ollama model
```bash
ollama pull qwen3:4b
```

### 3.3 Create the Postgres container
```bash
bash scripts/setup-db.sh
```

This runs:
```bash
docker run -d --name hr-postgres \
  -e POSTGRES_USER=hr_admin \
  -e POSTGRES_PASSWORD=hr_pass \
  -e POSTGRES_DB=hr_automation \
  -p 5432:5432 \
  postgres:16
```

### 3.4 Load schema + migrations
```bash
# schema
docker exec -i hr-postgres psql -U hr_admin -d hr_automation < db/schema.sql

# migrations in order
for f in db/migrations/*.sql; do
  docker exec -i hr-postgres psql -U hr_admin -d hr_automation < "$f"
done
```

### 3.5 Import n8n workflows
Start n8n first (skip ahead to Daily Startup for the command), then:
```bash
bash scripts/import-workflows.sh
```
Or import each JSON manually in the n8n UI.

### 3.6 Activate workflows in n8n
1. Open <http://localhost:5678>
2. For each workflow, toggle "Active" in the top-right
3. **Known gotcha:** if webhooks return 404 after activation, open the n8n SQLite DB and run:
   ```sql
   UPDATE workflow_entity SET active=1, activeVersionId=versionId WHERE id='N';
   ```
   (one row per workflow id 1..5). Restart n8n after.

### 3.7 Configure n8n PostgreSQL credential
In n8n → Settings → Credentials → Add "Postgres":
- Host: `localhost`
- Port: `5432`
- Database: `hr_automation`
- User: `hr_admin`
- Password: `hr_pass`
- **Name: `HR PostgreSQL`** (workflows reference this exact name)

---

## 4. Daily Startup

**The one-click way** (recommended):

Double-click `launch.bat` in the project root. It calls `start.sh` inside Git Bash, which starts everything in dependency order and opens <http://localhost:3001> (React app) in your browser.

**Manual equivalent** (for debugging):

```bash
cd "E:/OneDrive - American University of Beirut/Diyar/hr-automation"
bash start.sh
```

`start.sh` enforces this startup order (see `start.sh` in the project root for the authoritative version):

1. **Docker Desktop** — launched if not already running (waits up to 2 min). Data root on `E:\Docker`
2. **hr-postgres** — `docker start hr-postgres`
3. **Ollama** — `/e/ollama/program/ollama.exe serve` in background. Models on `E:\ollama`
4. **SMTP sidecar** — `python scripts/smtp_server.py` in background, listens on `127.0.0.1:8901`
5. **n8n** — `npx n8n start` in background, listens on `:5678`. Data in `E:\n8n` (via `N8N_USER_FOLDER`)
6. **Legacy Frontend** — `npx serve -l 3000 -s frontend` in background (fallback)
7. **React Frontend** — `npx vite --port 3001` in background (primary)
8. **Browser** — opens `http://localhost:3001`

> **Note:** The React frontend uses `VITE_API_URL=http://localhost:5678/webhook` from `frontend-react/.env`. All other backend services (n8n, Postgres, Ollama, SMTP sidecar) remain the same.

### Data locations (all on E:\)

| Service | Data path | How |
|---------|-----------|-----|
| Docker | `E:\Docker` | `daemon.json` → `"data-root": "E:\\Docker"` |
| n8n | `E:\n8n` | `N8N_USER_FOLDER=/e/n8n` in `start.sh` |
| Ollama | `E:\ollama` | `OLLAMA_MODELS=/e/ollama` + `OLLAMA_HOME=/e/ollama` in `start.sh` |

---

## 5. Verify Services Are Up

Run each check and confirm a healthy response:

```bash
# Docker daemon
docker info | head -3

# PostgreSQL
docker exec hr-postgres pg_isready -U hr_admin
# expected: "localhost:5432 - accepting connections"

# Ollama
curl -s http://localhost:11434/api/tags | head -c 200
# expected: JSON with "models" array including qwen3:4b

# SMTP sidecar
curl -s http://127.0.0.1:8901/
# expected: {"status":"ok","smtp_configured":true,"smtp_host":"smtp.gmail.com"}

# n8n
curl -s http://localhost:5678/healthz
# expected: {"status":"ok"}

# Legacy Frontend
curl -I -s http://localhost:3000 | head -1
# expected: HTTP/1.1 200 OK

# React Frontend (primary)
curl -I -s http://localhost:3001 | head -1
# expected: HTTP/1.1 200 OK
```

Then visit <http://localhost:3001> (React app) and walk through:
- [ ] Dashboard loads, shows job + candidate counts
- [ ] Phase 2 → Job Openings lists existing jobs
- [ ] Phase 2 → Create Job completes 2-step wizard
- [ ] Phase 3 → CV Evaluation: select a job, stepper reacts to state
- [ ] Phase 4 → Shortlist loads
- [ ] Phase 5 → Emails shows SMTP status banner

---

## 6. Shutdown

`start.sh` does not stop services; they keep running in the background. To fully stop:

```bash
docker stop hr-postgres                # stop DB
pkill -f "npx n8n start"               # stop n8n
pkill -f "smtp_server.py"              # stop sidecar
pkill -f "ollama.exe serve"            # stop Ollama
pkill -f "serve -l 3000"               # stop legacy frontend
pkill -f "vite --port 3001"            # stop React frontend
```

On Windows native, use Task Manager to end `node.exe`, `python.exe`, `ollama.exe`.

---

## 7. Common Operations

### Re-import a single workflow
```bash
cd workflows/phase2-cv-evaluation
npx n8n import:workflow --input=phase2-cv-evaluation.json
# then re-run the activeVersionId UPDATE in sqlite and restart n8n
```

### Reset the database
```bash
docker exec -it hr-postgres psql -U hr_admin -d hr_automation \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
# then re-run schema.sql + migrations (see §3.4)
```

### Tail n8n logs
n8n prints to the terminal it was started from. If launched via `start.sh` it's redirected to `/dev/null`. For verbose logs, run manually:
```bash
npx n8n start
```

### Tail SMTP sidecar logs
Same — stop the background process and run manually:
```bash
python scripts/smtp_server.py
```

---

## 8. API Endpoints Quick Reference

Full mapping in [`n8n.md`](n8n.md). Commonly used:

```bash
# Phase 2 — Job Openings
curl http://localhost:5678/webhook/job-openings
curl -X POST http://localhost:5678/webhook/job-openings -H 'Content-Type: application/json' -d '{...}'

# Phase 3 — CV Evaluation
curl "http://localhost:5678/webhook/candidates?job_id=1"
curl "http://localhost:5678/webhook/evaluations?job_id=1"
curl -X POST http://localhost:5678/webhook/cv-evaluate -H 'Content-Type: application/json' -d '{"job_id":1}'

# Phase 4 — Shortlist
curl "http://localhost:5678/webhook/shortlist?job_id=1"

# Phase 5 — Emails
curl "http://localhost:5678/webhook/email-history?job_id=1"
```

---

## 9. Troubleshooting

See [`troubleshooting.md`](troubleshooting.md) for symptom-by-symptom fixes.

---

## 10. Rebuilding the Progress Report

The stakeholder PDF in `report/report.pdf` is generated from `report/report.tex` using MiKTeX.

```bash
cd report
"C:/Users/Jasse/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdflatex.exe" report.tex
# run again if the TOC, section numbering, or labels changed
"C:/Users/Jasse/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdflatex.exe" report.tex
```

To swap a screenshot, drop a new PNG into `report/images/` with the matching filename (e.g., `dashboard.png`, `results.png`) and recompile. The file list is documented at the top of `report.tex`.
