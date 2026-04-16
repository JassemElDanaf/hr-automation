# Diyar HR Automation

Local-first HR automation built with **n8n**, **PostgreSQL**, and **Ollama**. Every component runs on the HR user's laptop — no cloud services, no external dependencies beyond SMTP for outbound email.

One-line pitch: an HR user lands on a dashboard, creates a job opening, evaluates submitted CVs against AI-generated criteria, shortlists the best candidates, and sends rejection / interview emails — all from a single browser tab.

---

## Phases

| # | Name | What it does |
|---|------|--------------|
| 1 | Dashboard | Landing page — KPIs across all jobs (counts, shortlist rollup) |
| 2 | Job Openings | Create, list, and toggle job postings. JD from AI / manual / file upload |
| 3 | CV Evaluation | 4-step wizard: select job → set criteria → upload CVs → score + view results |
| 4 | Shortlist | Track candidate status: shortlisted → interviewed → hired, or rejected |
| 5 | Emails | Send rejection / interview / offer / custom emails. Full history + SMTP health |

Full product + UX rules are in [`claude.md`](claude.md). Detailed operational docs live in [`docs/`](docs/).

---

## Stack

| Component | Role | Port |
|-----------|------|------|
| Frontend (`frontend/index.html`) | Single-file SPA (HTML + CSS + JS) | 3000 |
| n8n | Workflow engine + webhook API | 5678 |
| PostgreSQL (Docker) | Persistent storage | 5432 |
| Ollama | Local AI (`qwen3:4b`) for JD, criteria, CV scoring | 11434 |
| SMTP sidecar (`scripts/smtp_server.py`) | Python relay for outbound email | 8901 |

Nothing runs in the cloud. Nothing phones home.

---

## Quick Start

**One-time setup** (Windows):

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/), [Git for Windows](https://git-scm.com/download/win), [Node.js 18+](https://nodejs.org/), [Python 3.10+](https://www.python.org/downloads/), [Ollama](https://ollama.com/download).
2. `ollama pull qwen3:4b`
3. `cp .env.example .env` — then edit `.env` to add your Gmail app password (optional; without it, emails are logged but not sent).

**Every day**:

```bash
# from project root
./launch.bat        # Windows one-click
# or
bash start.sh       # Mac / Linux / Git Bash
```

`start.sh` brings up Postgres, Ollama, n8n, the SMTP sidecar, and the frontend server, then opens the browser at <http://localhost:3000>.

Full runbook: [`docs/runbook.md`](docs/runbook.md).

---

## Project Structure

```
hr-automation/
  claude.md                      Persistent project memory (READ FIRST)
  README.md                      This file
  .env.example                   Copy to .env, fill in SMTP
  launch.bat / start.sh          Startup scripts
  frontend/
    index.html                   Entire SPA
    server.js                    Optional Node server
  workflows/
    phase1-job-opening/          Phase 2 JSON (folder name kept for import scripts)
    phase2-cv-evaluation/        Phase 3 JSON
    phase3-shortlist/            Phase 4 JSON
    phase4-email/                Phase 5 JSON
    phase5-dashboard/            Phase 1 JSON
  db/
    schema.sql                   job_openings
    migrations/                  001 → 005 (candidates, criteria, shortlist, email_log)
    seed.sql                     Sample data
  scripts/
    setup-db.sh                  Creates hr-postgres container + applies schema
    seed-db.sh                   Inserts sample data
    smtp_server.py               Python SMTP sidecar
    import-workflows.sh          Bulk import n8n JSON
    test-phase1.sh               Quick sanity checks
  docs/
    architecture.md              System diagram + component breakdown
    runbook.md                   Day-to-day ops
    docker.md                    Container lifecycle
    n8n.md                       Workflow map + webhook reference
    database.md                  Schema + inspection queries
    troubleshooting.md           Symptom → fix index
  data/
    samples/ uploads/            Example CVs + file staging
```

> Workflow folder names reflect **build order**; the workflow name/tags **inside** each JSON reflect the current **user-flow order**. See [`docs/n8n.md`](docs/n8n.md) for the mapping.

---

## API — Webhooks

All paths are prefixed with `http://localhost:5678/webhook`.

### Dashboard (Phase 1)
| Method | Path |
|--------|------|
| GET | `/dashboard-candidates` |
| GET | `/dashboard-shortlist` |

### Job Openings (Phase 2)
| Method | Path |
|--------|------|
| GET | `/job-openings` |
| POST | `/job-openings` |
| GET | `/job-opening?id=N` |
| POST | `/job-opening-toggle?id=N` |

### CV Evaluation (Phase 3)
| Method | Path |
|--------|------|
| POST | `/cv-submit` |
| POST | `/cv-evaluate` |
| GET | `/candidates?job_id=N` |
| GET | `/evaluations?job_id=N` |
| GET | `/criteria-sets?job_id=N` |
| POST | `/criteria-sets` |
| POST | `/generate-criteria` |

### Shortlist (Phase 4)
| Method | Path |
|--------|------|
| GET | `/shortlist?job_id=N` |
| POST | `/shortlist` |
| POST | `/shortlist-update` |

### Emails (Phase 5)
| Method | Path |
|--------|------|
| POST | `/send-email` |
| GET | `/email-history?job_id=N` |

Full request/response shapes in [`docs/n8n.md`](docs/n8n.md).

---

## Database

PostgreSQL 16 in Docker. Credentials (local dev only):

```
host=localhost port=5432 db=hr_automation user=hr_admin password=hr_pass
```

Tables: `job_openings`, `candidates`, `evaluations`, `criteria_sets`, `shortlist`, `email_log`. See [`docs/database.md`](docs/database.md).

---

## Troubleshooting

If something breaks, go straight to [`docs/troubleshooting.md`](docs/troubleshooting.md). It's organized by **symptom → cause → fix**.

Common issues:
- n8n webhooks return 404 after import → run the sqlite `activeVersionId` fix
- Docker port 5432 conflict → change host port, update `.env`
- Emails log as `failed` with auth error → regenerate Gmail app password
- CV evaluation "takes forever" → `qwen3:4b` on CPU is slow (~100s/CV), not a bug

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

---

## License

Private project for demo / educational use.
