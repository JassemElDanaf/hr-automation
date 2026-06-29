# Diyar HR

> **Status:** Demo-ready. Complete, fully QA'd HR pipeline. See [`report/report.pdf`](report/report.pdf) for the project report.

Local-first HR automation built with **React**, **n8n**, **PostgreSQL**, and **Gemini AI**. Everything runs in Docker on the HR laptop — one command to start, a Cloudflare tunnel to share with candidates.

---

## What it does

An HR user opens a browser, creates a job opening, lets Gemini write the job description, uploads CVs for AI scoring, shortlists the best candidates, runs AI video interviews, hands off to the hiring manager, and tracks every email — all from one tab.

| Tab | Purpose |
|-----|---------|
| Dashboard | KPIs: candidate counts, shortlist rollup, pipeline funnel, charts |
| Job Openings | Create (AI / manual / upload), edit, toggle active/inactive |
| CV Pool | Search across every CV ever uploaded (Ctrl+F style), inline PDF view |
| CV Evaluation | 4-step wizard: job → criteria → upload CVs → AI scoring + results |
| Shortlist | Pipeline: shortlisted → interviewed → handed off → hired / rejected |
| Interview | Question bank, AI question generation, candidate interview links, AI scoring |
| Decision | Blend CV + interview scores, send evaluation pack to hiring manager |
| Emails | Full history, inbound reply threading, SMTP health |

---

## Stack

| Component | Role | Port |
|-----------|------|------|
| React + Vite (`frontend-react/`) | Single-page app — the only frontend | 3001 |
| nginx | Serves the built app + proxies `/webhook` `/auth` `/recording` `/smtp` | 80 (Docker) |
| n8n | Webhook API + workflow engine | 5678 |
| PostgreSQL 16 | All hiring data | 5432 |
| Gemini 2.5 Flash | Primary AI — JD generation, criteria, CV scoring, interview questions | API |
| Ollama (`qwen3:4b`) | AI fallback — kicks in on Gemini 429 / quota exhausted | 11434 |
| Auth sidecar (`auth_server.py`) | Login + RBAC (admin / recruiter / viewer), bcrypt sessions | 8904 |
| SMTP sidecar (`smtp_server.py`) | Outbound email relay, generates Message-IDs for threading | 8901 |
| IMAP sidecar (`imap_server.py`) | Polls Gmail for inbound replies, threads them by Message-ID | 8902 |
| Recording sidecar (`recording_server.py`) | Stores / serves candidate interview recordings | 8903 |
| Whisper sidecar (`transcribe_server.py`) | Server-side STT fallback for Firefox / non-Chrome browsers | 8905 |
| Cloudflare tunnel (`cloudflared`) | Exposes port 3001 to a public URL so remote candidates can interview | — |

---

## Quick Start (Docker — recommended)

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) with WSL2 backend
- A [Gemini API key](https://aistudio.google.com/app/apikey) (free tier works)
- Optional: Gmail App Password for real email send/receive

**WSL2 memory** — Ollama's `qwen3:4b` needs ~4 GB RAM. Edit `C:\Users\<you>\.wslconfig`:
```ini
[wsl2]
memory=6GB
swap=4GB
```
Then `wsl --shutdown` and reopen Docker Desktop.

### First run

```bash
git clone https://github.com/JassemElDanaf/hr-automation.git
cd hr-automation
cp .env.example .env          # then edit .env — at minimum set GEMINI_API_KEY
docker compose up -d
```

That's it. App is at **http://localhost:3001**.

Default login: **admin@diyarme.com / Admin1234!** (change it after first login via Settings → Change Password).

On first boot Postgres runs all migrations automatically; n8n imports and publishes all 6 workflows.

### Ollama model (first run only)

If the `qwen3:4b` model isn't already in `OLLAMA_DATA_DIR`:
```bash
docker compose exec ollama ollama pull qwen3:4b   # ~2.5 GB download
```

If you already have the model from a host Ollama install, set `OLLAMA_DATA_DIR` in `.env` to point at that directory — no download needed.

### Cloudflare tunnel

The `cloudflared` service starts automatically with `docker compose up -d`. Get the public URL:
```bash
docker logs hr-automation-cloudflared-1 | grep trycloudflare
```

Share that URL with candidates. The URL changes on every restart.

### Daily use

```bash
docker compose start    # resume (data kept)
docker compose stop     # pause (data kept)
```

---

## Docker Hub images

Pre-built images for amd64 (runs on Windows, Linux, Mac with Rosetta):

```
jassemeldanaf/diyar-frontend:latest
jassemeldanaf/diyar-sidecars:latest
```

Use these in production to skip the build step — pull them in the compose file by replacing `build:` blocks with `image:` references.

---

## Configuration (`.env`)

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | **Yes** | From [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `SMTP_HOST/USER/PASS` | No | Gmail + App Password for outbound email |
| `IMAP_HOST/USER/PASS` | No | Same credential — enables inbound reply threading |
| `OLLAMA_DATA_DIR` | No | Path to existing Ollama model directory (avoids re-download) |
| `COMPANY_NAME` | No | Baked into AI-generated content. Default: `Diyar United Company` |

Without `SMTP_*`, emails are logged only (`status='logged'`). Without `GEMINI_API_KEY`, AI features fall back to Ollama.

---

## Lifecycle commands

| Action | Command |
|--------|---------|
| Start everything | `docker compose up -d` |
| Pause (keep data) | `docker compose stop` |
| Resume | `docker compose start` |
| View logs | `docker logs hr-automation-<service>-1` |
| Rebuild after code change | `docker compose up -d --build frontend` (or `sidecars`) |
| Apply `.env` change | `docker compose up -d --force-recreate <service>` |
| **Never** | `docker compose down -v` — `-v` deletes all data volumes |

Data lives in named volumes (`postgres_data`, `n8n_data`, `recordings`) and survives all commands except `down -v`.

---

## Project structure

```
hr-automation/
  README.md                      This file
  CLAUDE.md                      Project memory — read before making changes
  HOW-IT-WORKS.md                Narrative walkthrough of the full stack
  .env.example                   Config template
  docker-compose.yml             Full-stack Docker definition
  Dockerfile.frontend            Multi-stage: node build → nginx serve
  Dockerfile.sidecars            python:3.11-slim + supervisord (5 sidecars)
  nginx.conf                     SPA + proxy routes
  .gitattributes                 Enforces LF line endings on *.sh (prevents CRLF breaking Docker)
  frontend-react/                React + Vite source
  workflows/
    phase1-job-opening/          Workflow 1: Job Openings CRUD
    phase2-cv-evaluation/        Workflow 2: CV Evaluation + AI scoring
    phase3-shortlist/            Workflow 3: Shortlist pipeline
    phase4-email/                Workflow 4: Email + SMTP health
    phase5-dashboard/            Workflow 5: Dashboard KPIs
    phase6-live-interview/       Workflow 6: Interview + Question Bank
  db/
    schema.sql                   Initial schema
    migrations/                  001 → 017 additive migrations
  scripts/
    auth_server.py               Auth + RBAC sidecar (8904)
    smtp_server.py               SMTP relay sidecar (8901)
    imap_server.py               IMAP poller sidecar (8902)
    recording_server.py          Recording server (8903)
    transcribe_server.py         Whisper STT sidecar (8905)
    n8n-entrypoint.sh            Patches + imports workflows on n8n start
    docker-pg-init.sh            Applies schema + migrations on first Postgres start
    ollama-entrypoint.sh         Starts Ollama, pulls model if not cached
    supervisord.conf             Runs all 5 sidecars in one container
    export-live-workflows.py     Dumps live n8n workflows back to repo JSON
  docs/
    architecture.md              Component breakdown + data flow
    n8n.md                       Workflow map + webhook reference
    database.md                  Schema + migrations + queries
    runbook.md                   Ops reference
    troubleshooting.md           Symptom → fix index
  report/
    report.pdf                   Project report
    report.tex                   LaTeX source
```

---

## n8n workflows

| n8n ID | Name | Folder |
|--------|------|--------|
| 1 | Phase 2 - Job Openings | `workflows/phase1-job-opening/` |
| 2 | Phase 3 - CV Evaluation | `workflows/phase2-cv-evaluation/` |
| 3 | Phase 4 - Shortlist | `workflows/phase3-shortlist/` |
| 4 | Phase 5 - Email Notifications | `workflows/phase4-email/` |
| 5 | Phase 1 - Dashboard | `workflows/phase5-dashboard/` |
| 6 | Phase 6 - Live Interview | `workflows/phase6-live-interview/` |

Folder names reflect build order; the `name` field inside each JSON uses user-flow order.

---

## Roles

| Role | Access |
|------|--------|
| `admin` | Full access + Users management |
| `recruiter` | Full pipeline access |
| `viewer` | Read-only |

The hiring manager is not an app user — they receive emails and respond via email.

---

## Troubleshooting

See [`docs/troubleshooting.md`](docs/troubleshooting.md) for the full symptom → fix index.

Quick fixes:
- **App won't load** — `docker compose ps` to see which container is unhealthy; `docker logs hr-automation-<name>-1` for details
- **Email fails `535 BadCredentials`** — Gmail App Password expired; regenerate at myaccount.google.com/apppasswords and `docker compose up -d --force-recreate sidecars`
- **CV evaluation returns 0/0/0** — WSL2 RAM too low; set `memory=6GB` in `.wslconfig`, run `wsl --shutdown`, reopen Docker Desktop
- **Tunnel unreachable** — cloudflared URL changes on every restart; re-run the `docker logs` command above to get the new one

---

## License

Private project — demo / educational use.
