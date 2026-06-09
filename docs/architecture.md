# Architecture

Full system design. For the quick tour, read `CLAUDE.md` first.

---

## System Diagram

```
Browser (http://localhost:3001)
    |
    +-- fetch() -------> n8n webhooks (http://localhost:5678/webhook/...)
                              |
                              +-- Postgres queries ---> hr-postgres container (:5432)
                              +-- HTTP POST ----------> Ollama (:11434)  [qwen3:4b]
                              +-- HTTP POST ----------> SMTP sidecar (:8901) --> SMTP provider

IMAP sidecar (:8902, polling Gmail) --> n8n /inbound-email webhook
                                              |
                                              +--> match In-Reply-To -> message_id
                                              +--> INSERT email_log direction='inbound'
```

Every browser request lands on n8n. n8n orchestrates:
- DB reads/writes via the Postgres node
- AI calls via HTTP Request → `http://localhost:11434/api/generate`
- Email sends via HTTP Request → `http://127.0.0.1:8901/`

n8n is both the API gateway and the business-logic engine. There is no separate backend service.

---

## Components

### Frontend — `frontend-react/`

React + Vite single-page app. **This is the only frontend.** The legacy `frontend/index.html` SPA was deleted.

**Pages (one per tab in the nav):**

| Route | Component | Phase |
|-------|-----------|-------|
| `/` | Dashboard.jsx | 1 |
| `/jobs` | JobOpenings.jsx | 2 |
| `/cv-eval` | CVEvaluation.jsx | 3 |
| `/shortlist` | Shortlist.jsx | 4 |
| `/emails` | Emails.jsx | 5 |
| `/live-interview` | LiveInterview.jsx | 6 |
| `/ai-interviews` | AIInterviews.jsx | — |
| `/interview/:token` | CandidateInterview.jsx | public |

**State:**
- React Context API (`selectedJob`, `uiState`) for cross-component state
- `localStorage` for: selected job (`hr_selected_job`), interview notes (`hr_interview_notes`), live interview questions (`hr_live_qs_{candidateId}`), archived candidates, shortlist archived state, hiring manager email cache

**API access:**
- `src/services/api.js` — `apiGet(path)` returns parsed body directly; `apiPost(path, body)` returns `{status, data}`. These shapes differ — do not confuse them.
- `VITE_API_URL=http://localhost:5678/webhook` from `frontend-react/.env`

**Key components:**
- `src/components/layout/NavTabs.jsx` — tab navigation + service status pills (n8n, Ollama, SMTP, DB) with 30s auto-recheck
- `src/components/modals/EmailComposerModal.jsx` — shared email composer used by every email flow
- `src/components/modals/InterviewQuestionsModal.jsx` — AI question generation + meeting metadata + pack send to HM
- `src/utils/pdf.js` — PDF text extraction via pdfjs-dist (client-side)
- `src/services/email.js` — all email template functions
- `src/utils/helpers.js` — `emailTypeLabel()` and shared utilities

**Charts:** `chart.js` + `react-chartjs-2` (Dashboard doughnut/bar charts).

---

### n8n workflows — `workflows/`

Six workflows. Folder names reflect build order; internal workflow names reflect user-flow phase.

| n8n ID | Internal Name | Folder | Phase |
|--------|--------------|--------|-------|
| 1 | Phase 2 - Job Openings | `phase1-job-opening/` | 2 |
| 2 | Phase 3 - CV Evaluation | `phase2-cv-evaluation/` | 3 |
| 3 | Phase 3 - Shortlist | `phase3-shortlist/` | 4 |
| 4 | Phase 4 - Email Notifications | `phase4-email/` | 5 |
| 5 | Phase 5 - Dashboard | `phase5-dashboard/` | 1 |
| 6 | Phase 6 - Live Interview | `phase6-live-interview/` | 6 |

Node pattern inside each workflow:
```
[Webhook node] → [Code / Validate] → [Postgres node] → [Code / Shape response] → [RespondToWebhook]
```

**CRITICAL — how n8n executes workflows:** n8n runs from `workflow_history.nodes` indexed by `workflow_entity.activeVersionId`, NOT from `workflow_entity.nodes`. Any direct sqlite patch must update **both** tables, or the change is silently ignored at runtime. See `docs/runbook.md` §Patching protocol.

**Data location:** `D:\n8n\.n8n\database.sqlite`

---

### PostgreSQL — `hr-postgres` container

Docker container (`postgres:16`). Single database `hr_automation`. Schema grows additively — migrations are in `db/migrations/` numbered 001–013.

**Tables:** `job_openings`, `candidates`, `evaluations`, `criteria_sets`, `shortlist`, `email_log`, `interview_questions`, `interview_sessions`, `question_bank`

Full schema in `docs/database.md`.

---

### Ollama — `D:\ollama\`

Program: `D:\ollama\program\ollama.exe`. Models: `D:\ollama\` (via `OLLAMA_MODELS` + `OLLAMA_HOME` env vars). Model in use: `qwen3:4b` (~2.5 GB, runs on CPU).

All calls use `think: false` + `format: 'json'` (where JSON output is needed) to suppress the model's reasoning preamble. Temperature 0.2–0.3, `num_predict` 4000. A `stripLLMPreamble()` helper in relevant n8n Code nodes removes any residual `<think>` tags or "Okay, let me..." openers before the output is used.

Used for:
- JD generation (Phase 2 — `/job-openings` POST with `description_source: 'ai_generate'`)
- Criteria generation (Phase 3 — `/generate-criteria`)
- CV scoring (Phase 3 — `/cv-evaluate`)
- Interview question generation (Phase 3 — `/generate-interview-questions`)
- Live next-question generation (Phase 6 — `/interview/next-question`)

---

### SMTP sidecar — `scripts/smtp_server.py`

Python `http.server.BaseHTTPRequestHandler` on `127.0.0.1:8901`.

Endpoints:
- `GET /` — health check + SMTP config state (`smtp_configured` boolean)
- `POST /` with `{to, subject, body, from?}` — sends via `smtplib`, returns `{status, error?}`
- `OPTIONS /` — CORS preflight

Returns `{status: 'sent'}`, `{status: 'logged'}` (SMTP not configured), or `{status: 'failed', error: ...}`.

Also generates a per-send `Message-ID` via `email.utils.make_msgid()` and returns it in the response. n8n persists this on the outbound `email_log` row so the IMAP sidecar can thread inbound replies.

Reads: `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` from env.

---

### IMAP sidecar — `scripts/imap_server.py`

Python daemon on `127.0.0.1:8902`. Polls the configured Gmail mailbox (IMAP4_SSL) every `IMAP_POLL_SEC` seconds (default 60) for UNSEEN messages.

For each message:
1. Parses headers: `From`, `Subject`, `In-Reply-To`, `References`
2. Extracts plain text body (HTML fallback with tag stripping, reply-quote tail stripped)
3. POSTs to n8n `/inbound-email` webhook
4. Marks `\Seen` only after successful forward (failures stay UNSEEN for retry)

Without `IMAP_HOST` set, the daemon stays running but skips polling (symmetric with SMTP "logged only" mode).

n8n's `/inbound-email` handler:
- Drops cold inbounds (no `In-Reply-To` / `References` — nothing to attach to)
- Looks up parent outbound row via `email_log.message_id = $in_reply_to`
- Inserts `email_log` row with `direction='inbound'`, inheriting parent's `candidate_id` / `job_opening_id`
- Orphans (no matching parent) get `{orphan: true}` — marked Seen, not retried

---

### Recording server — `scripts/recording_server.py`

Python server on `127.0.0.1:8903`. Handles interview audio/video recording uploads from the candidate interview page.

---

## Port Map

| Port | Service | Notes |
|------|---------|-------|
| 3001 | React Frontend | `npx vite --port 3001` |
| 5432 | PostgreSQL | `hr-postgres` Docker container |
| 5678 | n8n | UI + `/webhook/*` API. Data: `D:\n8n\.n8n\` |
| 8901 | SMTP sidecar | loopback only (`127.0.0.1`) |
| 8902 | IMAP sidecar | loopback only (`127.0.0.1`) |
| 8903 | Recording server | loopback only (`127.0.0.1`) |
| 11434 | Ollama | Program + models at `D:\ollama\` |

---

## Drive Layout

All runtime data lives on **D:\\**. Nothing on E:\\.

| What | Path |
|------|------|
| Project source | `D:\OneDrive\Desktop\Diyar\hr-automation\` |
| n8n install | `D:\n8n\` |
| n8n data / sqlite DB | `D:\n8n\.n8n\database.sqlite` |
| NodeJS runtime | `D:\NodeJS\` |
| Ollama program | `D:\ollama\program\ollama.exe` |
| Ollama models | `D:\ollama\` |
| Docker | WSL2 managed by Docker Desktop |

---

## Data Flow Walkthroughs

### Create Job Opening (Phase 2)
1. Browser `POST /webhook/job-openings` with `{job_title, department, ..., description_source, job_description?}`
2. Validate required fields + enum values
3. Branch on `description_source`:
   - `ai_generate` — call Ollama; strip preamble; return generated JD
   - `manual` — use provided `job_description` text
   - `file_upload` — use text extracted client-side via pdf.js
4. `INSERT INTO job_openings ... RETURNING *` (status defaults to `'open'`)
5. Return created row

### Toggle Job Active/Inactive
1. Browser `POST /webhook/job-opening-toggle` with `{id}`
2. `UPDATE job_openings SET is_active = NOT is_active, status = CASE WHEN NOT is_active THEN 'open' ELSE 'closed' END WHERE id = $1 RETURNING *`
3. Return updated row (status reflects new activation state)

### Evaluate CVs (Phase 3)
1. Browser `POST /webhook/cv-evaluate` with `{job_opening_id}`
2. Fetch all unevaluated candidates + criteria for the job
3. For each candidate (sequential — Ollama is CPU-bound):
   - Build scoring prompt from criteria + criteria_items (required/optional flags) + CV text
   - `POST http://localhost:11434/api/generate` with `think: false, format: 'json'`
   - Strip `<think>` tags + markdown fences from response
   - Parse scores (skills/experience/education) + reasoning/strengths/weaknesses/required_missing
   - `INSERT INTO evaluations ... ON CONFLICT DO UPDATE`
4. Return list of scored evaluations

### Reject Candidate Flow
1. Browser calls `POST /add-to-shortlist` (if not shortlisted yet) then `POST /update-shortlist-status` with `{status: 'rejected'}`
2. Opens `EmailComposerModal` (pre-filled rejection template, user edits subject + body)
3. Browser `POST /webhook/send-email` with `{custom_subject, custom_body, ...}`
4. n8n POSTs to SMTP sidecar; sidecar sends via smtplib; n8n INSERTs to `email_log` with result + `message_id`
5. Frontend patches local `emailMap` with `direction: 'outbound'` entry — no page reload

### Inbound Reply Threading
1. IMAP sidecar polls Gmail → finds UNSEEN reply to a sent email
2. POSTs to n8n `/inbound-email` with `{from, subject, body, in_reply_to, references}`
3. n8n looks up `email_log.message_id = $in_reply_to`
4. INSERTs `email_log` row with `direction='inbound'`, parent's `candidate_id` + `job_opening_id`
5. Frontend renders inbound rows with purple styling + "📥 Reply from {sender}" banner

### Generate Interview Link (Phase 6)
1. HR selects job + candidate, picks question mode (AI generate / custom / from bank)
2. Frontend calls `POST /generate-interview-questions` if AI mode
3. HR clicks "Generate Link" — payload encoded as `btoa(unescape(encodeURIComponent(JSON.stringify(payload))))` (Unicode-safe)
4. Candidate opens `/interview/{token}` — `CandidateInterview.jsx` decodes token with `decodeURIComponent(escape(atob(token)))`
5. Interview proceeds: speech recognition captures answers, Ollama generates follow-up questions, transcript saved to `interview_sessions`

---

## Design Decisions

- **n8n over custom backend** — zero-code webhook + orchestration. HR can inspect individual executions visually in the n8n UI.
- **Local Ollama over OpenAI** — privacy + cost. `qwen3:4b` runs on consumer CPUs at ~100s/CV; acceptable at demo scale.
- **Python SMTP sidecar over n8n's email node** — n8n's built-in email node silently routed credential errors to the success branch. A 100-line Python server with an explicit `{status: 'sent'|'logged'|'failed'}` contract is easier to reason about and debug.
- **Python IMAP sidecar** — n8n has no native IMAP polling node. Keeping it as a sidecar means the polling interval, retry logic, and orphan handling are explicit and testable.
- **Additive migrations** — every migration uses `IF NOT EXISTS` / `IF EXISTS` guards; safe to re-run; preserves data; matches how the schema grew during development.
- **btoa Unicode safety** — `btoa()` only handles Latin-1. Interview payloads may contain em dashes and other Unicode from AI-generated questions, so encoding uses `btoa(unescape(encodeURIComponent(...)))` and decoding uses the inverse.
