# Diyar HR — How It Works (Technical Deep-Dive)

A single document to understand the **whole** project end to end: the stack, how every
piece talks to every other piece, and — in detail — how the local AI (Ollama) actually
runs a CV evaluation. Written to be read top to bottom.

> **One-line summary:** Diyar HR is a **100% local, offline-capable** HR pipeline that
> runs entirely on one laptop. A React web app talks to n8n workflows (the "backend"),
> which persist to a PostgreSQL database and call a local Ollama LLM for all AI work.
> No cloud, no SaaS, no external API keys (except optional SMTP/IMAP for real email).

---

## 1. The stack at a glance

| Layer | Technology | Where it runs | Port |
|-------|-----------|---------------|------|
| **Frontend** | React 19 + Vite (SPA) | `frontend-react/` | **3001** |
| **Backend / API** | n8n (visual workflow engine) | `D:\n8n` | **5678** |
| **Database** | PostgreSQL 16 in Docker | container `hr-postgres` | **5432** |
| **AI / LLM** | Ollama running `qwen3:4b` | `D:\ollama` | **11434** |
| **Auth sidecar** | Python `http.server` + psycopg2 | `scripts/auth_server.py` | **8904** |
| **SMTP sidecar** | Python + `smtplib` | `scripts/smtp_server.py` | **8901** |
| **IMAP sidecar** | Python daemon (polls Gmail) | `scripts/imap_server.py` | **8902** |
| **Recording sidecar** | Python `http.server` | `scripts/recording_server.py` | **8903** |

Everything is started in order by `launch.bat` → `start.sh`:
**Docker → Postgres → Ollama → sidecars (SMTP/IMAP/Recording/Auth) → n8n → React**, then it
opens `http://localhost:3001`. `shutdown.bat` stops all 8 in reverse.

**Why this split?** n8n gives a visual, no-code API + database layer that's fast to change.
Ollama gives private, free, offline AI. PostgreSQL gives a real relational store. The Python
sidecars handle the few things n8n is awkward at (auth, raw SMTP/IMAP, binary file serving).

---

## 2. How a request flows (the big picture)

```
Browser  (http://localhost:3001, React SPA)
   │
   │  fetch('/webhook/…')      ── Vite dev-server proxy ──►  n8n  (http://localhost:5678)
   │  fetch('/auth/…')         ── proxy ──►  Auth sidecar (8904) ──► Postgres
   │  fetch('/recording/…')    ── proxy ──►  Recording sidecar (8903)
   │  fetch('http://localhost:11434/api/generate')  ──────────────►  Ollama  (direct, see §6)
   │
   ▼
 n8n webhook  →  [Code / Postgres / HTTP-Request nodes]  →  respond
                      │              │
                      │              └──►  Ollama (:11434)   — AI scoring / generation
                      ├──►  PostgreSQL (:5432)               — read/write data
                      └──►  SMTP sidecar (:8901)  ──►  mail server  — send email

 IMAP sidecar (:8902, polling Gmail)  ──►  n8n /inbound-email  ──►  Postgres (reply logged)
```

The Vite dev server proxies `/webhook`, `/auth`, and `/recording` so the browser only ever
talks to `localhost:3001` (same-origin) — this is what lets candidate interview pages work
without CORS headaches. `VITE_API_URL` in `.env` points the app at the n8n webhook base.

---

## 3. Frontend (React + Vite) — the only UI

- **Build tool:** Vite (dev server on **3001**, `npm run dev`; production `npm run build`).
- **Routing:** `react-router-dom`. HR tabs: `/` (Dashboard), `/jobs`, `/talent-pool` (CV Pool),
  `/cv-eval`, `/shortlist`, `/live-interview` (Interview), `/decision`, `/emails`. Plus one
  **public** route, `/interview/:token`, the candidate-facing interview page (no HR chrome).
- **State:** React Context providers, not Redux —
  - `AuthProvider` — current user + session token + role (RBAC).
  - `SelectedJobProvider` — the one "current job" shown in the header and mirrored by every
    tab; persisted to `localStorage` so it survives reloads.
  - `UIProvider` — toasts, confirm dialogs, the shared email composer modal.
  - `ThemeProvider` — light/dark mode (CSS-variable palette; `html[data-theme="dark"]`).
  - `EvalStatusProvider` — the global "AI is working" indicator (see §6).
- **Key libraries:** `pdfjs-dist` (parse CV PDFs in-browser, bundled not CDN),
  `chart.js` + `react-chartjs-2` (dashboard charts).
- **API layer:** `services/api.js` exposes `apiGet`/`apiPost`. RBAC is enforced UI-side at this
  chokepoint — a `viewer` role can't POST. Every successful write also fires a fire-and-forget
  **audit-log** entry (`AUDIT_MAP`).
- **Pages** (`src/pages/`): `Dashboard`, `JobOpenings`, `TalentPool` (CV Pool), `CVEvaluation`,
  `Shortlist`, `LiveInterview` (Interview: Setup / Question Bank / Results sub-tabs),
  `AIInterviews` (embedded as Interview→Results), `Decision`, `Emails`, `CandidateInterview`.

---

## 4. Backend (n8n) — workflows are the API

There is **no hand-written backend server**. Each HTTP endpoint is an n8n **webhook node**
followed by a pipeline of **Code** (JavaScript), **Postgres**, and **HTTP-Request** nodes,
ending in a `respondToWebhook` node. Six workflows, one per phase (folder names reflect build
order; the workflow *name* uses user-flow numbering):

| Workflow (folder) | Endpoints it owns |
|-------------------|-------------------|
| `phase5-dashboard/` | `/dashboard-candidates`, `/dashboard-shortlist`, `/talent-pool` |
| `phase1-job-opening/` | `/job-openings` (CRUD), `/job-opening-toggle`, `/job-opening-update` |
| `phase2-cv-evaluation/` | `/cv-submit`, **`/cv-evaluate`**, `/criteria-sets`, `/generate-criteria`, `/candidates`, `/evaluations`, `/cv-file`, `/generate-interview-questions` |
| `phase3-shortlist/` | `/shortlist`, `/add-to-shortlist`, `/update-shortlist-status`, `/remove-from-shortlist` |
| `phase4-email/` | `/send-email`, `/email-history`, `/inbound-email` |
| `phase6-live-interview/` | `/interview/jobs`, `/interview/candidates`, `/interview/question-bank`, `/generate-interview-questions`, `/candidate-questions*` |

**n8n runtime facts**
- Started via Node directly: `node /d/n8n/node_modules/.bin/n8n start`, data in
  `D:\n8n\.n8n\database.sqlite`. Its own editor login is disabled (`N8N_USER_MANAGEMENT_DISABLED=true`)
  — that's separate from the app login.
- All workflows share one Postgres credential named **`HR PostgreSQL`** (host `localhost`,
  db `hr_automation`, user `hr_admin`).
- ⚠️ **Editing a workflow in the live DB is the one fragile operation.** n8n executes from
  `workflow_history.nodes` keyed by `workflow_entity.activeVersionId`, so any SQLite patch must
  update **both** tables and then restart n8n — otherwise it keeps running the old snapshot.
  This is exactly why newer features (auth, email templates, audit log) were built as **Python
  sidecars instead of n8n nodes** — to avoid this dual-table editing risk.

---

## 5. Database (PostgreSQL in Docker)

One container, `hr-postgres` (no `docker-compose.yml` — a single `docker run` in `start.sh`).
Database `hr_automation`. Schema in `db/schema.sql`, evolved by numbered files in `db/migrations/`.

| Table | Purpose |
|-------|---------|
| `job_openings` | Job postings (title, department, JD, `is_active`/status) |
| `candidates` | One row per CV: name, email, `cv_text`, and the original PDF (`cv_file_data` base64) |
| `evaluations` | AI CV scores: overall + skills/experience/education, strengths, weaknesses, reasoning |
| `criteria_sets` | Saved, reusable evaluation criteria (`criteria_items` JSONB: text + required + importance) |
| `shortlist` | Pipeline status per candidate: `shortlisted → interviewed → hired / rejected` |
| `email_log` | Every email attempt (outbound + inbound), `message_id`/`in_reply_to` for threading |
| `question_bank` | Reusable interview questions (category, model answer) |
| `candidate_prepared_questions` | Per-candidate saved interview prep (UNIQUE on candidate+job) |
| `users` | App login: email, bcrypt `password_hash` (via pgcrypto), `role` (admin/recruiter/viewer) |
| `auth_sessions` | Opaque UUID session tokens with `expires_at` |
| `email_templates` | Admin-editable candidate email templates (overrides the code defaults) |
| `audit_log` | Who did what, when (status changes, emails, evaluations, job toggles) |

Apply a migration: `Get-Content db/migrations/0XX.sql -Raw | docker exec -i hr-postgres psql -U hr_admin -d hr_automation`.

---

## 6. Ollama & the AI — where the "intelligence" lives

**Model:** `qwen3:4b`, served by Ollama on `http://localhost:11434`. It is a *reasoning* model,
so its raw output contains `<think>…</think>` blocks — **every caller strips those out** before
using the answer.

**Two ways the app reaches Ollama:**
1. **Via n8n** (most AI work): an HTTP-Request node POSTs to `http://127.0.0.1:11434/api/generate`
   with a 5-minute timeout. Used for CV scoring, JD generation, criteria generation, and the
   live-interview question/answer work.
2. **Directly from the browser** (a few interactive features, e.g. "generate a question from a
   topic"): the React app `fetch`es `http://localhost:11434/api/generate` itself. This works only
   because `start.sh` sets `OLLAMA_ORIGINS` to allow `localhost:3001`. These calls send
   `"think": false` and still defensively strip `<think>` tags.

**The global "AI is working" indicator:** any Ollama-backed action is wrapped by
`evalStatus.runAiTask(label, fn)`, which drives the bottom-right `EvalIndicator` card so the user
always sees when local AI is running (purple = generic task, blue = CV evaluation with live %).

### 6.1 CV Evaluation — step by step (the headline feature)

When HR clicks **Run Evaluation**, the frontend POSTs `/cv-evaluate { job_opening_id }` and the
`phase2-cv-evaluation` workflow runs this exact node chain:

```
Webhook (/cv-evaluate)
  → Validate Input            (Code: read job id + weights + criteria)
  → Fetch Job & Candidates    (Postgres: the job + all UN-evaluated candidates for it)
  → Prepare Prompts           (Code: build ONE prompt per candidate)
  → Call Ollama               (HTTP: POST 127.0.0.1:11434/api/generate, timeout 300s)
  → Score Candidates          (Code: parse the model's JSON, strip <think>)
  → Save Evaluations          (Postgres: insert one evaluations row per candidate)
  → Build Summary  → respond  (counts back to the UI)
```

**What "Prepare Prompts" actually builds.** For each candidate it assembles a prompt from:
- the **criteria text** (or the job description as fallback),
- the **scoring weights** — Skills / Experience / Education (default 40 / 35 / 25 %),
- and, if the criteria set has **itemized criteria**, an `ITEMIZED CRITERIA` block listing each
  item as `[REQUIRED|optional] (importance N/10) <text>`, sorted by importance, with explicit
  instructions to the model:
  - importance **9–10** = critical → failing drops the relevant dimension by 3+ points,
  - **6–8** = high → −1 to −2 points,
  - **3–5** = medium, **1–2** = nice-to-have,
  - a **REQUIRED** item that isn't met means the candidate is fundamentally unfit and the overall
    score must reflect that.
- The model is told to return **strict JSON** (overall + per-dimension scores, strengths,
  weaknesses, reasoning, and — when itemized — `required_missing` / `items_met` arrays referencing
  the exact item text).

**What "Score Candidates" does.** It takes Ollama's raw text, strips `<think>…</think>`, extracts
and `JSON.parse`s the JSON object, clamps/normalises the numbers, and shapes one row per candidate.
**"Save Evaluations"** writes them to the `evaluations` table. The UI, meanwhile, **polls**
`/evaluations?job_id=N` every ~3 s so the progress indicator shows real "X of N scored" and
survives navigating away — the actual scoring keeps running in n8n regardless of the open tab.

### 6.2 The other AI features (same pattern, different prompts)

| Feature | Endpoint / path | What the model does |
|---------|-----------------|---------------------|
| **JD generation** | n8n (job openings) | Write a full job description from a few fields |
| **Criteria generation** | `/generate-criteria` | Turn a JD + weights into editable evaluation criteria |
| **Interview question gen** | `/generate-interview-questions` | Draft N questions for a candidate by type (HR/technical/salary) |
| **Tailored question** | direct browser → Ollama | "Ask about AWS experience" → one polished question |
| **Interview answer scoring** | interview evaluate | Score a finished interview vs each question's model answer → per-dimension scores (communication, technical, confidence, culture), summary, recommendation, requirements-met |

Across all of them the rules are the same: **manual trigger only** (never auto-run on page load),
**input → generate → edit** (AI output always lands in an editable field), and **strip `<think>`**.

---

## 7. The Python sidecars

| Sidecar | Port | What it does |
|---------|------|--------------|
| **Auth** (`auth_server.py`) | 8904 | App login + RBAC. Verifies passwords with Postgres pgcrypto bcrypt (`crypt()`/`gen_salt('bf',12)`), issues opaque UUID session tokens in `auth_sessions`. Also serves admin endpoints for **email templates** and the **audit log** (built here to dodge n8n's fragile workflow edits). |
| **SMTP** (`smtp_server.py`) | 8901 | n8n POSTs here to actually send mail via `smtplib`; returns a `Message-ID` so the outbound row can later be threaded to replies. |
| **IMAP** (`imap_server.py`) | 8902 | Background daemon that polls the Gmail mailbox every `IMAP_POLL_SEC` for unseen mail, parses each reply, and POSTs it to n8n `/inbound-email`, which logs it as `direction='inbound'` threaded by `in_reply_to → message_id`. Skips polling if `IMAP_HOST` isn't set. |
| **Recording** (`recording_server.py`) | 8903 | Stores/serves candidate interview audio/video recordings; Vite proxies `/recording` here. |

---

## 8. Auth & RBAC

- Login screen gates the whole app; the session token is stored client-side and sent on requests.
- Three roles: **admin** (everything, incl. Users / Email-templates / Audit-log),
  **recruiter** (normal HR work), **viewer** (read-only — blocked at the `apiPost` chokepoint).
- Passwords are bcrypt-hashed **inside Postgres** (pgcrypto), never in app code; self-service
  change-password revokes the user's *other* sessions but keeps the current one.
- Default seed login is `admin@diyarme.com` / `ChangeMe123!` — meant to be changed.

---

## 9. The end-to-end HR journey

1. **Job Openings** — create a job (AI-generated, manual, or uploaded JD).
2. **CV Evaluation** — pick the job → set criteria (from JD / write / AI-generate / upload) and
   weights → upload CVs → **Run Evaluation** (the §6.1 pipeline) → review scored results.
3. **CV Pool** — Ctrl-F-style search across *every* uploaded CV, one-click shortlist.
4. **Shortlist** — track `shortlisted → interviewed → hired/rejected`; auto-advances to
   *interviewed* once a candidate has a completed interview session.
5. **Interview** — build a question set (mix Question Bank + AI + your own) → generate a private
   `/interview/:token` link → the candidate answers (AI may follow up live) → results (scores,
   recording with synced question overlay, transcript) land in **Interview → Results**.
6. **Decision** — CV score and interview score side by side, blended into one ranking by an
   adjustable weight slider. The single place HR hands the full pack to the hiring manager
   ("Send to HM"), filters by **Sent to HM**, and makes the final **Hire / Reject** call
   (with one-click **Revert**).
7. **Emails** — every send is logged with live SMTP health; inbound HM replies are pulled in by
   the IMAP sidecar and link straight back to the candidate's Decision row.

---

## 10. Where everything lives (drive layout) & running it

- **App code:** `D:\OneDrive\Desktop\Diyar\hr-automation\` (this repo).
- **n8n + its SQLite DB:** `D:\n8n\` (`.n8n\database.sqlite`). *Never use the stale `E:\` path.*
- **Ollama models + binary:** `D:\ollama\`.
- **Postgres data:** inside the `hr-postgres` Docker volume.

**Start:** run `launch.bat` (wraps `start.sh`). It waits for n8n's webhooks to actually register
(not just `/healthz`) before declaring success, then opens `http://localhost:3001`.
**Stop:** `shutdown.bat` (frees ports 3001 → 5678 → 8901 → 8902 → 8903 → 8904 → Ollama → Postgres).

**Health pills** in the app header show live status of n8n, Ollama (`qwen3:4b`), SMTP, and DB; the
circular `↺` rechecks them all.

---

## 11. Mental model in three sentences

The **React app** is just a face — it never holds business logic; it calls webhooks.
**n8n** is the brain-stem — it validates, talks to **Postgres** for memory, and asks **Ollama**
whenever it needs judgement (scoring a CV, writing criteria, grading an interview).
The **Python sidecars** cover the gritty edges (login, real email in/out, file serving) that are
cleaner outside n8n — and the whole thing runs on one machine with no cloud dependency.
