# Diyar HR

> **Status:** Demo-ready. Complete, fully QA'd HR automation system. See [`report/report.pdf`](report/report.pdf) for the project report.

Local-first HR automation built with **n8n**, **PostgreSQL**, and **Ollama**. Every component runs on the HR user's laptop — no cloud services, no external dependencies beyond SMTP/IMAP for email.

One-line pitch: an HR user lands on a dashboard, creates a job opening, evaluates submitted CVs against AI-generated criteria, shortlists the best candidates, manages the pipeline through to hire, and tracks every email — all from a single browser tab.

---

## Phases

| # | Name | What it does |
|---|------|--------------|
| 1 | Dashboard | KPIs across all jobs: candidate counts, shortlist rollup, pipeline stats, charts |
| 2 | Job Openings | Create (AI / manual / file upload), edit, toggle active/inactive, view details |
| 3 | CV Evaluation | 4-step wizard: select job → set criteria (required/optional flags) → upload CVs → Ollama scoring + results table + detail modal |
| 4 | Shortlist | Pipeline: shortlisted → interviewed → handed off to HM → hired/rejected. Email flows for all transitions. Inbound reply threading via IMAP |
| 5 | Emails | Full history, expandable rows, inbound/outbound, SMTP health badge |
| 6 | Live Interview | Question bank CRUD, AI question generation, generate candidate interview link |

Full product and UX rules are in [`claude.md`](claude.md). Detailed operational docs live in [`docs/`](docs/).

---

## Stack

| Component | Role | Port | Data location |
|-----------|------|------|---------------|
| React Frontend (`frontend-react/`) | React + Vite app — the only frontend | 3001 | — |
| n8n | Workflow engine + webhook API | 5678 | `D:\n8n\.n8n\database.sqlite` |
| PostgreSQL 16 (Docker, `hr-postgres`) | Persistent storage | 5432 | Docker-managed |
| Ollama (`qwen3:4b`) | Local AI for JD generation, criteria, CV scoring, interview questions | 11434 | `D:\ollama` |
| SMTP sidecar (`scripts/smtp_server.py`) | Python relay for outbound email | 8901 | — |
| IMAP sidecar (`scripts/imap_server.py`) | Polls Gmail for inbound replies; threads them to outbound rows | 8902 | — |
| NodeJS | n8n runtime | — | `D:\NodeJS` |

Nothing runs in the cloud. All data lives on D:\.

---

## Quick Start

**One-time setup** (Windows):

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/), [Git for Windows](https://git-scm.com/download/win), [Node.js 18+](https://nodejs.org/), [Python 3.10+](https://www.python.org/downloads/), [Ollama](https://ollama.com/download).
2. `ollama pull qwen3:4b`
3. `cp .env.example .env` — then edit `.env` to add your Gmail app password (used for both SMTP outbound and IMAP inbound polling).

**Every day**:

```bash
# from project root — Windows one-click:
launch.bat

# or from Git Bash:
bash start.sh
```

`start.sh` brings up Docker + Postgres, Ollama, the SMTP sidecar, the IMAP sidecar, the recording server, n8n, and the React frontend, then opens the browser at <http://localhost:3001>.

Full runbook: [`docs/runbook.md`](docs/runbook.md).

---

## Docker Deployment (full stack in containers)

This runs the **entire** app — Postgres, n8n, the four Python sidecars, the React
frontend, and (optionally) Ollama — as Docker containers. Use this for a clean
machine or a server. `start.sh` above is only for native Windows dev.

### Prerequisites

1. **Docker Desktop** (WSL2 backend on Windows).
2. **WSL2 memory ≥ 6 GB.** Ollama's `qwen3:4b` needs ~4 GB to run; the default
   WSL2 cap will OOM-kill it (`llama-server … signal: killed`, evaluations come
   back 0/0/0). Create/edit `C:\Users\<you>\.wslconfig`:
   ```ini
   [wsl2]
   memory=6GB
   swap=4GB
   ```
   then `wsl --shutdown` and reopen Docker Desktop. (Skip this if you use **host**
   Ollama instead of the Docker one — see Ollama options below.)
3. **`cp .env.example .env`** and edit it (see below).

### Configure `.env`

- **Postgres** — defaults work as-is for local use.
- **Gmail (SMTP + IMAP)** — required for real email send/receive. **There is no way
  around providing a credential**: Gmail mandates either an *App Password* (what we
  use) or full OAuth2. App Passwords are free but you must generate one yourself —
  enable 2-Step Verification, then create one at
  <https://myaccount.google.com/apppasswords>, and put the 16-char value in
  `SMTP_PASS` + `IMAP_PASS`. Without it the app still runs, but emails are
  **logged only** (rows land in `email_log` with `status='logged'`, nothing is sent).
  App Passwords can be revoked/expire — if sends start failing with `535
  BadCredentials`, generate a new one and recreate the sidecars.
- **Ollama** — runs **in Docker by default** (`OLLAMA_DOCKER_HOST=ollama`), fully
  self-contained. Model files are stored on the drive you set in `OLLAMA_DATA_DIR`
  (keep it off the system drive, e.g. `D:/DiyarDocker/ollama`). If you'd rather use
  an Ollama already installed on the **host**, set `OLLAMA_DOCKER_HOST=host.docker.internal`
  and stop the Docker one (it would otherwise conflict on port 11434).

### Start

```bash
docker compose up -d                                # brings up everything, incl. Ollama
docker compose exec ollama ollama pull qwen3:4b     # one-time: ~2.5 GB → OLLAMA_DATA_DIR
```

> If the model pull stalls on `registry.ollama.ai` and you already have qwen3:4b
> from a host Ollama install, copy `<host-store>/manifests` + the referenced
> `blobs/*` into `OLLAMA_DATA_DIR/models/` and `docker compose restart ollama`.

First boot: Postgres runs `scripts/docker-pg-init.sh` (schema + all migrations);
n8n's entrypoint imports/publishes the 6 workflows and seeds the Postgres
credential. App is at <http://localhost:3001>. Default login (seeded on first run,
printed to `logs/auth_server.log`): **admin@diyarme.com / ChangeMe123!** — change it
after first login.

### Stopping & lifecycle

| Action | Command |
|--------|---------|
| **Shut down (daily)** | `docker compose stop` — resume with `docker compose start` |
| Stop + remove containers (data kept) | `docker compose down` — restart with `docker compose up -d` |
| Free the WSL2 RAM too | quit Docker Desktop from the tray, or `wsl --shutdown` |
| View a service's logs | `docker logs hr-automation-<service>-1` |
| Rebuild after editing frontend/sidecar code | `docker compose up -d --build <service>` |
| Apply a changed `.env` value | `docker compose up -d --force-recreate <service>` |

### n8n editor (optional)

The HR app never needs it, but to view the workflows visually go to
<http://localhost:5678> and log in (n8n 2.x always requires an account — the
"no-login" mode was removed). Owner login: **admin@diyarme.com / ChangeMe123!**.
Editor edits are overwritten on the next restart (workflows re-import from
`workflows/*.json`) — edit the JSON for durable changes.

### Data & volumes (avoid accidental loss)

| Data | Volume | Survives `stop`/`down`/`--build`? |
|------|--------|-----------------------------------|
| Postgres (all hiring data) | `postgres_data` | ✅ |
| n8n workflows/creds | `n8n_data` | ✅ |
| Interview recordings | `recordings` | ✅ |
| Ollama models | bind mount `OLLAMA_DATA_DIR` (your D: path) | ✅ |

⚠️ **`docker compose down -v` deletes the named volumes** — all candidates, PDFs,
and interview sessions gone. Plain `stop`, `down`, `up --build`, and
`--force-recreate` are all safe.

---

## Project Structure

```
hr-automation/
  claude.md                      Project memory (read before making changes)
  README.md                      This file
  .env.example                   Copy to .env, fill in SMTP/IMAP creds + Ollama mode
  docker-compose.yml             Full-stack Docker (postgres, n8n, ollama, sidecars, frontend)
  Dockerfile.frontend            Multi-stage React build → nginx
  Dockerfile.sidecars            python:3.11-slim + supervisord (4 sidecars)
  nginx.conf                     SPA fallback + proxies (/webhook /recording /auth)
  launch.bat                     Windows double-click launcher for LOCAL dev (calls start.sh)
  start.sh                       LOCAL dev startup (native processes + hr-postgres container)
  frontend-react/                React + Vite app (the only frontend)
  workflows/
    phase1-job-opening/          n8n workflow: Phase 2 - Job Openings
    phase2-cv-evaluation/        n8n workflow: Phase 3 - CV Evaluation
    phase3-shortlist/            n8n workflow: Phase 4 - Shortlist
    phase4-email/                n8n workflow: Phase 5 - Email Notifications
    phase5-dashboard/            n8n workflow: Phase 1 - Dashboard
    phase6-live-interview/       n8n workflow: Phase 6 - Live Interview
  db/
    schema.sql                   Initial schema (job_openings)
    migrations/                  001 → 017 (candidates, evaluations, criteria_sets,
                                 shortlist, email_log, smtp, criteria_items, cv file storage,
                                 recommendation email type, email direction/threading,
                                 interview_questions, interview_sessions, interview_recording,
                                 question_bank, candidate_prepared_questions, hm-review,
                                 users-auth, templates-audit)
    seed.sql                     Sample data
  scripts/
    smtp_server.py               SMTP relay sidecar (port 8901)
    imap_server.py               IMAP polling sidecar (port 8902)
    recording_server.py          Interview recording server (port 8903)
    auth_server.py               App login + RBAC sidecar (port 8904)
    docker-pg-init.sh            Docker: applies schema + all migrations on first DB init
    n8n-entrypoint.sh            Docker: patches/imports/publishes workflows, seeds credential
    supervisord.conf             Docker: runs the 4 sidecars in one container
    export-live-workflows.py     Dump live n8n workflows back to repo JSON (after live patches)
    setup-db.sh / seed-db.sh     LOCAL dev: create hr-postgres + seed
    import-workflows.sh          Bulk import n8n JSON
  docs/
    architecture.md              System diagram + component breakdown
    runbook.md                   Day-to-day ops
    docker.md                    Container lifecycle
    n8n.md                       Workflow map + webhook reference
    database.md                  Schema + inspection queries
    troubleshooting.md           Symptom → fix index
  report/
    report.tex                   LaTeX source of the project report
    report.pdf                   Compiled PDF
    images/                      Screenshots + logo used by report.tex
  data/
    samples/ uploads/            Example CVs + file staging
```

> Workflow folder names reflect build order; the workflow `name` field inside each JSON uses the current user-flow order. See [`docs/n8n.md`](docs/n8n.md) for the mapping.

---

## n8n Workflows

| n8n ID | Internal name | Folder |
|--------|---------------|--------|
| 1 | Phase 2 - Job Openings | `workflows/phase1-job-opening/` |
| 2 | Phase 3 - CV Evaluation | `workflows/phase2-cv-evaluation/` |
| 3 | Phase 4 - Shortlist | `workflows/phase3-shortlist/` |
| 4 | Phase 5 - Email Notifications | `workflows/phase4-email/` |
| 5 | Phase 1 - Dashboard | `workflows/phase5-dashboard/` |
| 6 | Phase 6 - Live Interview | `workflows/phase6-live-interview/` |

---

## API — Webhooks

All paths are prefixed with `http://localhost:5678/webhook`.

### Dashboard
| Method | Path |
|--------|------|
| GET | `/dashboard-candidates` |
| GET | `/dashboard-shortlist` |

### Job Openings
| Method | Path |
|--------|------|
| GET | `/job-openings` |
| POST | `/job-openings` |
| GET | `/job-opening?id=N` |
| POST | `/job-opening-toggle` |
| POST | `/job-opening-update` |

### CV Evaluation
| Method | Path |
|--------|------|
| POST | `/cv-submit` |
| POST | `/cv-evaluate` |
| GET | `/candidates?job_id=N` |
| GET | `/evaluations?job_id=N` |
| GET | `/criteria-sets?job_id=N` |
| POST | `/criteria-sets` |
| POST | `/generate-criteria` |
| GET | `/cv-file?candidate_id=N` |
| POST | `/generate-interview-questions` |
| POST | `/remove-from-shortlist` |

### Shortlist
| Method | Path |
|--------|------|
| GET | `/shortlist?job_id=N` |
| POST | `/add-to-shortlist` |
| POST | `/update-shortlist-status` |
| POST | `/remove-from-shortlist` |

### Emails
| Method | Path |
|--------|------|
| POST | `/send-email` |
| GET | `/email-history?job_id=N` |
| POST | `/inbound-email` |

### Live Interview
| Method | Path |
|--------|------|
| GET | `/interview/jobs` |
| GET | `/interview/question-bank` |
| POST | `/interview/question-bank` |
| PUT | `/interview/question-bank` |
| DELETE | `/interview/question-bank` |
| POST | `/interview/next-question` |
| GET | `/interview/start` (public — candidate-facing) |

Full request/response shapes in [`docs/n8n.md`](docs/n8n.md).

---

## Database

PostgreSQL 16 in Docker (`hr-postgres` container). Credentials (local dev only):

```
host=localhost  port=5432  db=hr_automation  user=hr_admin  password=hr_pass
```

Tables: `job_openings`, `candidates`, `evaluations`, `criteria_sets`, `shortlist`, `email_log`, `interview_questions`, `interview_sessions`, `question_bank`.

All migrations applied (schema.sql + 001 through 013). See [`docs/database.md`](docs/database.md).

---

## Troubleshooting

Go straight to [`docs/troubleshooting.md`](docs/troubleshooting.md) — organized by symptom → cause → fix.

Common issues:

- n8n webhooks return 404 after import → run the sqlite `activeVersionId` fix (see `docs/n8n.md`)
- Docker port 5432 conflict → change host port, update `.env`
- Emails log as `failed` with auth error → regenerate Gmail app password
- CV evaluation is slow (~100s/CV on CPU) → expected behavior for `qwen3:4b` on CPU, not a bug
- IMAP sidecar not threading replies → ensure `IMAP_HOST` is set in `.env`; check that the outbound `message_id` was persisted (requires SMTP sidecar to be running at send time)

---

## Docs

| File | Purpose |
|------|---------|
| [`claude.md`](claude.md) | Project memory — read before making changes |
| [`docs/architecture.md`](docs/architecture.md) | System diagram, components, data flow |
| [`docs/runbook.md`](docs/runbook.md) | First-time setup, daily startup, common ops |
| [`docs/docker.md`](docs/docker.md) | Container commands, data persistence |
| [`docs/n8n.md`](docs/n8n.md) | Workflow ↔ phase mapping, webhook reference |
| [`docs/database.md`](docs/database.md) | Schema, migrations, useful queries |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | Symptom-first fix index |
| [`report/report.pdf`](report/report.pdf) | Project report (compiled from `report/report.tex` via MiKTeX) |

---

## License

Private project for demo / educational use.
