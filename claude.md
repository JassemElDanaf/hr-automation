# Diyar HR Automation — Project Memory

Persistent source of truth for the project. Read this before making changes.

---

## 1. Project Overview

**Diyar HR Automation** is a local-first, demo-grade HR pipeline that an HR user drives from a single-page web UI. The backend is a collection of n8n workflows that expose webhooks, persist to PostgreSQL, and call a local Ollama model for AI work. Nothing in this project is a cloud service — everything runs on the HR user's laptop.

**What each module does**

| Module | Job |
|--------|-----|
| Frontend (`frontend/index.html`) | Single HTML+JS file. All pages, wizards, and tables live here. No build step. |
| n8n workflows (`workflows/`) | One JSON per phase. Webhook-based HTTP API. Talks to PostgreSQL + Ollama + SMTP sidecar. |
| PostgreSQL (Docker) | `hr_automation` database. Schema in `db/schema.sql`, migrations in `db/migrations/`. |
| Ollama (local, port 11434) | Runs `qwen3:4b`. Used for JD generation, criteria generation, CV scoring. |
| SMTP sidecar (`scripts/smtp_server.py`) | Tiny Python HTTP server on `127.0.0.1:8901`. n8n POSTs here, it relays via `smtplib`. |
| Launcher (`start.sh` / `launch.bat`) | Brings up everything in the right order and opens the browser. |

**How the pieces fit**

```
Browser (http://localhost:3000)
    |
    +-- fetch ---> n8n webhooks (http://localhost:5678/webhook/...)
                      |
                      +-- Postgres queries ---> hr-postgres container (:5432)
                      +-- HTTP POST ---------> Ollama (:11434)
                      +-- HTTP POST ---------> SMTP sidecar (:8901) ---> SMTP provider
```

---

## 2. Final Phase Order

Phases are numbered by **user flow**, not build order:

1. **Dashboard** — landing page, KPIs across all jobs
2. **Job Openings** — create + manage JDs (AI / manual / upload)
3. **CV Evaluation** — 4-step wizard (select job → criteria → upload CVs → run + view results)
4. **Shortlist** — track status: shortlisted → interviewed → hired, or rejected
5. **Emails** — history of every email attempt with SMTP health

Workflow files on disk still use their original folder names (`phase1-job-opening/`, etc.) because renaming would break import scripts. The **workflow `name` field + tags inside each JSON** use the new numbering. `docs/n8n.md` has the full mapping.

---

## 3. Architecture

### Frontend
- `frontend/index.html` — everything: HTML, CSS, JS, all pages
- `frontend/server.js` — optional Node server (normally served via `npx serve`)
- State lives in module-level JS variables (`evalSelectedJob`, `evalCriteria`, `allJobs`, etc.)
- Talks to n8n via `const API = 'http://localhost:5678/webhook';`
- PDF parsing uses `pdf.js` loaded from CDN

### Backend / API
No custom backend — the "backend" is n8n. Each HTTP endpoint is a webhook node → pipeline of Code / Postgres / HTTP Request nodes → `respondToWebhook` node.

### n8n Workflows (`workflows/`)
| Folder | New Phase | Internal Name | What it does |
|--------|-----------|---------------|--------------|
| `phase5-dashboard/` | **Phase 1** | `Phase 1 - Dashboard` | `/dashboard-candidates`, `/dashboard-shortlist` |
| `phase1-job-opening/` | **Phase 2** | `Phase 2 - Job Openings` | CRUD for `/job-openings`, toggle active, list, get |
| `phase2-cv-evaluation/` | **Phase 3** | `Phase 3 - CV Evaluation` | `/cv-submit`, `/cv-evaluate`, `/criteria-sets`, `/generate-criteria`, `/candidates`, `/evaluations` |
| `phase3-shortlist/` | **Phase 4** | `Phase 4 - Shortlist` | `/shortlist` GET/POST, `/shortlist-update` |
| `phase4-email/` | **Phase 5** | `Phase 5 - Emails` | `/send-email`, `/email-history` |

### Database (`db/`)
- `schema.sql` — initial Phase 2 `job_openings` table
- `migrations/001-phase2-cv-evaluation.sql` — `candidates`, `evaluations`
- `migrations/002-criteria-sets.sql` — `criteria_sets`
- `migrations/003-phase3-shortlist.sql` — `shortlist`
- `migrations/004-phase4-email-log.sql` — `email_log`
- `migrations/005-phase4-smtp.sql` — adds `error_message` column, widens status enum

Full table map is in `docs/database.md`.

### Docker
The only container is PostgreSQL (`hr-postgres`). There is **no `docker-compose.yml`** — the container is created with a single `docker run` command documented in `start.sh` line 54 and in `docs/docker.md`.

### Environment / Config
- `.env` (gitignored) holds SMTP credentials + any overrides. Loaded by `start.sh`.
- `.env.example` is the template — copy to `.env` and fill in real values.
- n8n's own DB (`~/.n8n/database.sqlite`) stores imported workflow state separately.

---

## 4. Core UX / Product Rules

These rules are **load-bearing**. Breaking them has caused real bugs.

### CV Evaluation (Phase 3)
1. **Existing jobs must be non-linear.** If a job already has state, the stepper lets the user jump between Set Criteria / Upload CVs / Results freely. Don't force them back through Step 1.
2. **Set Criteria is always reachable once a job is selected.** It's an editable workspace, not a one-time gate. Entering it with empty criteria is valid.
3. **Results is directly reachable when state allows.** If `has_evaluations`, clicking Step 4 (or the "View Results" shortcut) opens Results immediately and loads the scored table.
4. **Criteria generation is a manual trigger only.** Never auto-generate on page load, job selection, tab switch, or weight change. The user clicks "Generate Criteria" explicitly.
5. **Generation flow is input → generate → edit.** The "Additional Context" textarea collects HR intent, the button runs Ollama with current weights, the output appears in an editable textarea.
6. **Generate Criteria button lives AFTER the scoring weights.** The button reads the current weights to inform the prompt.
7. **Candidate actions are Details / Shortlist / Reject, plus Run Evaluation when unevaluated.** Actions are always rendered in a `<div class="actions-container">` inside a `<td class="actions-cell">` — never `display:flex` directly on a `td`.
8. **Reject is candidate-level, not evaluation-level.** Every candidate row has a Reject button regardless of whether they've been scored.
9. **Results table is summary-only.** Columns are fixed at: **Candidate | Email | Submitted | Overall | Actions**. Per-dimension scores (Skills / Experience / Education), strengths, weaknesses, reasoning, and CV text belong in the **Details modal**, never in the table. This keeps the table narrow enough to fit without horizontal scroll and keeps the Actions column (Details / Shortlist / Reject) fully visible on every row. Default sort is Overall score descending; unevaluated rows fall to the bottom.

### Emails (Phase 5)
9. **SMTP status must be real, not "unknown".** Four states: `not_configured`, `configured_not_tested`, `healthy`, `failing`. The Emails page surfaces the live status with a colored badge.
10. **Every send attempt is logged** — `email_log` row with candidate, job, recipient, subject, timestamp, status, and error message if any.

### Shortlist (Phase 4)
11. **Reconsider / status changes refresh only the affected card**, not the whole page. Status transitions are patched in place via `updateShortlistStatus(id, status)`.

---

## 5. State Model (CV Evaluation)

The Phase 3 wizard stepper is driven by three booleans per job, derived from `fetchJobState(jobId)`:

```
has_criteria     = /criteria-sets?job_id=N   returns ≥ 1 row
has_cvs          = /candidates?job_id=N      returns ≥ 1 row
has_evaluations  = /evaluations?job_id=N     returns ≥ 1 row
```

**Access rules** (enforced by `evalStepClick`):
- Step 1 (Select Job): always
- Step 2 (Set Criteria): if `job_selected`
- Step 3 (Upload CVs): if `job_selected`
- Step 4 (Results): if `job_selected && (has_cvs || has_evaluations)`

**Edge case:** `has_evaluations && !has_criteria` means evaluations were scored with ad-hoc criteria text that was never saved to `criteria_sets`. The job status badge shows "Criteria used (not saved)" in yellow instead of "No criteria" to avoid confusion.

---

## 6. Candidate Status Model

Status is stored in `shortlist.status`. Values (via DB CHECK constraint):

| Value | Meaning |
|-------|---------|
| `shortlisted` | HR moved them forward from evaluation results |
| `interviewed` | Interview completed |
| `hired` | Offer accepted |
| `rejected` | Declined (can be triggered from eval results or from shortlist) |

A candidate without a `shortlist` row is effectively **pending** — scored but no decision made.

Rejection also triggers a row in `email_log` with `email_type = 'rejection'`.

---

## 7. Email Rules

### SMTP States
- `not_configured` — `SMTP_HOST` env var empty. Emails get logged with status `logged`, not actually sent.
- `configured_not_tested` — SMTP env vars set, but no recent sends to confirm they work.
- `healthy` — recent sends succeeded.
- `failing` — recent sends failed (bad credentials, server down, etc.).

### Test Connection / Test Email
- The sidecar `GET /` returns whether `SMTP_HOST` is set.
- Planned: `POST /test-connection` (dry-run SMTP handshake) and `POST /send-test` (real send to an address HR enters).

### Logging Requirements
Every send attempt, success or failure, must insert into `email_log` with:
- `candidate_id`, `job_opening_id`
- `email_type` (`rejection` / `interview_invite` / `offer` / `custom`)
- `recipient_email`, `subject`, `body`
- `status` (`sent` / `failed` / `logged` / `pending`)
- `error_message` (only set on failure)
- `sent_at` (or attempted_at)

---

## 8. Fix Log

Major bugs + how they were fixed. Use this to avoid re-introducing them.

| Date | Bug | Root cause | Fix |
|------|-----|------------|-----|
| 2026-04 | "Run Evaluation" button sat in Upload CVs step | Mixed responsibilities | Split — Upload is upload-only, Results step has the "Run Evaluation" button |
| 2026-04 | Shortlist "Reconsider" reloaded entire page | Called `loadShortlist()` on status change | In-place patch via `updateShortlistStatus(id, status)` |
| 2026-04 | Reject button clipped / missing on some rows | `display:flex` on `<td>` is invalid + `.table-wrap` had `overflow:hidden` | Wrapped buttons in `<div class="actions-container">` inside `<td class="actions-cell">`, added `.table-scroll { overflow-x: auto }`, made Reject candidate-level |
| 2026-04 | Criteria auto-generated without user asking | Various triggers (load, job select, tab switch) all fired generation | Audited all code paths — only the "Generate Criteria" button `onclick` triggers generation |
| 2026-04 | Generate button appeared before weights | Originally placed before the weight sliders | Moved after weights so it reads the current values |
| 2026-04 | Set Criteria blocked for existing jobs | `evalStepClick` required `.completed` class on target step | Rewrote `evalStepClick` — Step 2 is reachable whenever a job is selected |
| 2026-04 | "No criteria" shown despite evaluations existing | `has_criteria` only checks `criteria_sets` table, but evals can run with ad-hoc text | Added "Criteria used (not saved)" yellow pill for the `has_evaluations && !has_criteria` case |
| 2026-03 | n8n webhooks didn't register after import | `activeVersionId` was not set in `workflow_entity` | `UPDATE workflow_entity SET active=1, activeVersionId=versionId WHERE id='N'` in sqlite after every import |
| 2026-04 | Results table overflowed horizontally — Actions column clipped behind scrollbar | Table mixed summary + detail columns (Skills / Experience / Education badges) | Simplified to 5 summary columns (Candidate / Email / Submitted / Overall / Actions). Per-dimension breakdown moved exclusively to the Details modal. Removed `.table-scroll` wrapper since the narrower table fits natively |

---

## 9. Development Rules

- **No silent failures.** Every API call in the UI has error handling. Every failure surfaces a toast.
- **Preserve existing data.** Schema changes are additive migrations (`ALTER TABLE ADD COLUMN IF NOT EXISTS`), not destructive rewrites. Never drop a table in a migration.
- **Validate before save.** Server side via CHECK constraints, client side via explicit checks (weights sum to 100, valid email format, required fields).
- **Keep project tidy.** New files follow the existing structure: workflow → `workflows/phaseN-*/`, migration → `db/migrations/NNN-*.sql`, doc → `docs/*.md`.
- **Do not break working flows.** Before changing a wizard step or workflow, verify the other steps/workflows still function end-to-end.
- **Trust internal invariants.** Don't add defensive checks for cases that can't happen in this codebase. Only validate at external boundaries (user input, HTTP requests from the browser, Ollama output parsing).
- **Don't rewrite unrelated code** during a bug fix. A UI fix doesn't need adjacent JS refactored.
- **No code change without documentation update.** Every code change must be paired with the matching docs update in the **same commit**:
  - UI behavior change → update UX rules in `claude.md`
  - Table / modal structure → update `claude.md` UX rules **and** `docs/architecture.md`
  - Workflow logic → update `docs/n8n.md`
  - Database schema → update `docs/database.md` **and** list the migration in `claude.md` §3
  - Feature behavior → update the README feature summary and the relevant `docs/*.md`
  - Any bug fix → add a row to the Fix Log in `claude.md` §8
  If docs are outdated, the system is considered broken. Reviewer should reject PRs with code changes that leave docs stale.

---

## 10. Future Work

- **Better CV parsing.** Current PDF.js extraction is brittle on multi-column or scanned CVs. Could add OCR fallback or use a library like `pdf-parse` with server-side parsing.
- **Better scoring.** Currently one big prompt to `qwen3:4b`. Could split into per-dimension scoring, add structured output (JSON schema), use a larger model when available.
- **Email templates.** Right now rejection emails use a hardcoded template. Add a template manager with variables (`{{candidate_name}}`, `{{job_title}}`).
- **Analytics improvements.** Dashboard is basic counts. Could add funnel visualization (applied → scored → shortlisted → hired), time-to-hire, source-of-hire if that data were tracked.
- **SMTP test endpoints.** Sidecar needs `POST /test-connection` and `POST /send-test` for the Emails page buttons.
- **Multi-user auth.** Everything assumes one HR user on localhost. Adding real auth means enabling `N8N_USER_MANAGEMENT_DISABLED=false` and wiring a login.
