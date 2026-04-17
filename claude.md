# Diyar HR Automation — Project Memory

Persistent source of truth for the project. Read this before making changes.

> **Project status (April 2026):** Proof of concept, pre-finalization. All five phases are functional end to end but work remains before production rollout. A progress report for Diyar management lives at `report/report.pdf` (LaTeX source at `report/report.tex`, compiled with MiKTeX).

---

## 1. Project Overview

**Diyar HR Automation** is a local-first, demo-grade HR pipeline that an HR user drives from a single-page web UI. The backend is a collection of n8n workflows that expose webhooks, persist to PostgreSQL, and call a local Ollama model for AI work. Nothing in this project is a cloud service — everything runs on the HR user's laptop.

**What each module does**

| Module | Job |
|--------|-----|
| Frontend — React (`frontend-react/`) | React + Vite app. 5 pages, shared state via Context, react-router. Primary frontend. |
| Frontend — Legacy (`frontend/index.html`) | Single HTML+JS file. Reference/fallback. No build step. |
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

### Frontend (React — primary)
- `frontend-react/` — React + Vite app, replaces the legacy monolith
- 5 page components: Dashboard, JobOpenings, CVEvaluation, Shortlist, Emails
- State: React Context API (`selectedJob` + `uiState`), localStorage persistence for selected job
- Routing: react-router-dom with URL paths (`/`, `/job-openings`, `/cv-evaluation`, `/shortlist`, `/emails`)
- API: `services/api.js` reads `VITE_API_URL` from `.env` → n8n webhooks
- PDF parsing: `pdfjs-dist` (bundled, not CDN)
- Charts: `chart.js` + `react-chartjs-2`
- Dev server: `npm run dev` on port 3001
- Full architecture: `docs/frontend-architecture.md`

### Frontend (Legacy — reference/fallback)
- `frontend/index.html` — 3526-line monolithic SPA (HTML + CSS + JS)
- `frontend/server.js` — optional Node server (normally served via `npx serve` on port 3000)
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

### Report (`report/`)
- `report.tex` — LaTeX source of the stakeholder progress report (12pt Times New Roman via `mathptmx`, cover page with Diyar logo).
- `report.pdf` — compiled output sent to Diyar management.
- `images/` — screenshots (Dashboard, Jobs, Criteria, Upload, Results, Shortlist, Emails, Docker Desktop, n8n) and `diyar-logo.jpg`, all with clean filenames so LaTeX handles them without space-escaping issues.
- Compiled with MiKTeX on `C:\Users\Jasse\AppData\Local\Programs\MiKTeX\miktex\bin\x64\pdflatex.exe`. Run `pdflatex` twice after TOC or label changes.

### Environment / Config
- `.env` (gitignored) holds SMTP credentials + any overrides. Loaded by `start.sh`.
- `.env.example` is the template — copy to `.env` and fill in real values.
- n8n's own DB (`~/.n8n/database.sqlite`) stores imported workflow state separately.

---

## 4. Core UX / Product Rules

These rules are **load-bearing**. Breaking them has caused real bugs.

### Cross-tab Job Context
0. **One selected job, visible everywhere.** CV Evaluation, Shortlist, and Emails all operate on the same `globalSelectedJob`. The header renders a "Current Job: {title} · {department}" badge that reflects it, and every per-tab selector mirrors it. Any selection in one tab propagates to the others instantly — the user never has to re-select a job after switching tabs. Persisted in `localStorage` under `hr_selected_job` so selection survives reloads. See §5a for the full lifecycle.

### CV Evaluation (Phase 3)
1. **Existing jobs must be non-linear.** If a job already has state, the stepper lets the user jump between Set Criteria / Upload CVs / Results freely. Don't force them back through Step 1.
2. **Set Criteria is always reachable once a job is selected.** It's an editable workspace, not a one-time gate. Entering it with empty criteria is valid.
3. **Results is directly reachable when state allows.** If `has_evaluations`, clicking Step 4 (or the "View Results" shortcut) opens Results immediately and loads the scored table.
4. **Criteria generation is a manual trigger only.** Never auto-generate on page load, job selection, tab switch, or weight change. The user clicks "Generate Criteria" explicitly.
5. **Generation flow is input → generate → edit.** The "Additional Context" textarea collects HR intent, the button runs Ollama with current weights, the output appears in an editable textarea.
6. **Generate Criteria button lives AFTER the scoring weights.** The button reads the current weights to inform the prompt.
7. **Candidate row actions are state-dependent.** The actions column shows different content based on the candidate's shortlist status:
   - **Pending** (no shortlist entry): `Run Evaluation` (if unevaluated) · `Details` / `View CV` · `Shortlist` · `Reject`
   - **Shortlisted** (or interviewed/hired): a centered green pill badge showing the status (e.g. "\u2713 Shortlisted") + an Archive button.
   - **Rejected**: a centered red pill badge "\u2717 Rejected" + an Archive button.
   Status is fetched from `/shortlist?job_id=N` on Step 4 load, so it persists across page refreshes. On shortlist/reject, the local `shortlistMap` state is updated immediately (no full reload needed) and the candidate is added to `retainedInView` so the row stays visible in the current filter until the user switches filters or reloads — status changes feel like updates, not instant disappearances. A pop animation plays on the badge when the state first changes. Rows also get a subtle tint: light red for rejected, light green for shortlisted. Status badges are centered horizontally in the Actions column via `.actions-container:has(.status-action-badge) { justify-content: center }`. Actions are always rendered in a `<div class="actions-container">` inside a `<td class="actions-cell">`. **Toast styling:** shortlist uses green (`success`), reject uses red (`error`), archive uses blue (`info`). Positive and destructive actions must be visually distinct.
   **Run Evaluation button:** pre-checks for unevaluated candidates before calling the backend. If all candidates are already evaluated, the button is disabled and shows "\u2713 All Evaluated". Otherwise it shows the unevaluated count. Error messages are actionable: "no candidates uploaded", "all already evaluated", "Ollama may not have responded", "cannot reach n8n", etc.
8. **Reject is candidate-level, not evaluation-level.** Every pending candidate row has a Reject button regardless of whether they've been scored.
9. **Results table is summary-only.** Columns are fixed at: **Candidate | Email | Submitted | Overall | Actions**. Per-dimension scores (Skills / Experience / Education), strengths, weaknesses, reasoning, and CV text belong in the **Details modal**, never in the table. This keeps the table narrow enough to fit without horizontal scroll and keeps the Actions column (Details / Shortlist / Reject) fully visible on every row. **Sort order:** unevaluated/new candidates first, then evaluated-pending, then shortlisted, then rejected. Within each group: newest submission first. **Filter bar** above the table with pill buttons: Active (default), Shortlisted, Rejected, Duplicates, Archived, All. Each button shows a count badge. **Candidates stat card** shows unique count (total minus duplicates). **Archive flow:** finalized candidates (shortlisted/rejected) and duplicates have an Archive button. On click: row fades out (0.35s), toast shows "Candidate archived — Undo" for 5s. Undo restores immediately; after 5s the archive commits to `localStorage` (`hr_archived_candidates_v2`, object mapping candidateId → previousStatus). Archived candidates appear in the Archived filter tab with muted styling (greyed rows) and a Restore button. No database records are deleted. **Duplicate detection:** candidates sharing the same email (case-insensitive, trimmed) are grouped. Within each group: the primary is the evaluated candidate (or newest if none evaluated); all others are marked as duplicates. Duplicate rows show a yellow "Duplicate" badge next to the name, amber row tint, and "Archive Duplicate" instead of Shortlist/Reject. A warning banner appears above the table when duplicates exist (hidden when viewing the Duplicates filter). Active filter excludes duplicates by default.
10. **Set Criteria is a 3-row stacked layout.** Row 1 is a 2-column grid (`.criteria-grid`), rows 2–3 are full-width cards below it:
    - **Row 1 left — Criteria Source:** saved-set dropdown (or empty-state message if none exist; default reads "Create new criteria (from scratch)"). No action buttons here.
    - **Row 1 right — Scoring Preferences:** compact weight sliders with running total (must equal 100%). Both cards match height within the row via grid default stretch.
    - **Row 2 — Action Panel** (`.criteria-actions-card`, full width): titled "Choose How to Create Criteria" with three action buttons (Write / Paste · AI Generate · Upload File) and a `.criteria-action-content` area for source-specific controls. All dynamic content stays inside this card.
    - **Row 3 — Criteria Draft** (`.criteria-draft-section`, full width): textarea that every source populates, plus unsaved-criteria warning and save checkbox.
    **Save logic:** when the save checkbox is checked, the user must provide a criteria set name (prompted on Continue if not already entered); saved sets appear immediately in the dropdown. Responsive: grid stacks to single column under 900px. Never put action buttons inside the Criteria Source card, never let dynamic content float outside the action card, and never add a second "Generated Criteria" textarea.

### Emails (Phase 5)
9. **SMTP status must be real, not "unknown".** Four states: `not_configured`, `configured_not_tested`, `healthy`, `failing`. The Emails page surfaces the live status with a colored badge.
10. **Every send attempt is logged** — `email_log` row with candidate, job, recipient, subject, timestamp, status, and error message if any.
11. **Every candidate-facing email is editable before send.** Subject and body are real `<input>` / `<textarea>` fields, never read-only preview. Default templates prefill on open; a "Reset to default template" button restores them. The backend uses the user-edited subject/body verbatim (via `custom_subject` / `custom_body`) — it never silently regenerates or overwrites user input. This rule applies to **every** email flow: rejection, shortlist notification, interview invitation, job offer, and any future status-change email. All flows route through one shared `openEmailComposer({ candidate, job, emailType, defaultSubject, defaultBody, sendLabel, showSendToggle, onSend })` helper in `frontend/index.html` — don't build per-flow modals.
12. **Email composer validation before send:** subject non-empty, body non-empty, recipient email contains `@`. The "Reject Candidate" flow is the only one that allows completing the action **without** sending an email (via the "Also send email" toggle); all other flows require a valid recipient.

### Shortlist (Phase 4)
11. **Reconsider / status changes refresh only the affected card**, not the whole page. Status transitions are patched in place via `updateShortlistStatus(id, status)`.

---

## 5. State Model

### 5a. Global Selected Job (cross-tab context)

Every tab that operates on a single job (CV Evaluation, Shortlist, Emails, and optionally Dashboard) reads from the **same** job selection. This is stored in one place — `globalSelectedJob` — and mirrored into each tab's per-tab selector. A "Current Job" badge in the header always shows the active job so the user never loses context when switching tabs.

**State:**
```js
let globalSelectedJob = null;   // { id, job_title, department } or null
const GLOBAL_JOB_KEY = 'hr_selected_job';   // localStorage key
```

**Lifecycle rules:**
1. **Single source of truth.** Any job selection (CV Eval card click, Shortlist dropdown, Email filter, Dashboard filter with a specific job) calls `setGlobalSelectedJob(job)`, which updates the in-memory state, writes to `localStorage`, re-renders the header badge, and mirrors the value into every other tab's selector via `syncSelectorsToGlobal()`.
2. **Persistence.** `loadGlobalSelectedJob()` runs once at init (before `loadDashboard`) to restore the last-selected job from `localStorage` so selection survives reloads.
3. **Per-tab population.** `loadJobsForShortlist()`, `loadJobsForEmailFilter()`, and the Dashboard's filter read `select.value || globalSelectedJob.id` when rebuilding options — so the first visit to any tab preselects the global job and immediately loads its data.
4. **CV Evaluation entry.** On the Select Job step, if no card is selected yet and a `globalSelectedJob` exists, `loadJobsForEval()` auto-clicks the matching card. If the user is already mid-wizard on a different job (past Step 1) we do **not** switch jobs on them — per-tab override wins for workflow continuity.
5. **Dashboard "All Jobs" exception.** On the Dashboard, picking a specific job updates global as usual, but switching to "All Jobs" is a dashboard-local view and does NOT clear the global selection — other tabs keep their current job.
6. **Clearing.** The `&times;` button on the header badge calls `clearGlobalSelectedJob()` which removes localStorage and resets every mirrored selector to empty.
7. **Option data attributes.** Every `<option>` populated for job selectors carries `data-title` and `data-dept` so `readJobFromSelect()` can reconstruct `{id, job_title, department}` without an extra API lookup.

Selector IDs that mirror `globalSelectedJob`:

| Tab | Selector | onchange handler |
|-----|----------|------------------|
| Dashboard | `#dash-job-filter` | `onDashboardJobFilterChange()` |
| CV Evaluation | (job cards, not a `<select>`) | `selectJobCard(id)` |
| Shortlist | `#shortlist-job-select` | `onShortlistJobChange()` |
| Emails | `#email-job-filter` | `onEmailJobFilterChange()` |

### 5b. CV Evaluation Wizard

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
| 2026-04 | Candidate emails not editable before send — subject locked, body preview-only | Reject modal used `<span>`/`<pre>` read-only elements; shortlist flow passed `custom_*` only when `email_type === 'custom'` | Replaced modal with editable `<input>` + `<textarea>`. All flows now route through a shared `openEmailComposer()` helper. Every send passes `custom_subject`/`custom_body` verbatim to `/send-email`. Added validation (non-empty subject/body, valid email) and a "Reset to default template" button |
| 2026-04 | Selecting a job in one tab didn't carry over to other tabs — user had to reselect on every tab | Each tab had its own state (`evalSelectedJob`, `#shortlist-job-select`, `#email-job-filter`, `#dash-job-filter`) with no shared source of truth | Introduced `globalSelectedJob` (module-level + `localStorage` under `hr_selected_job`). Every per-tab selector mirrors it via `syncSelectorsToGlobal()`, every selection calls `setGlobalSelectedJob()`. Header renders a "Current Job" badge. CV Eval Step 1 auto-selects the matching card on entry. Dashboard "All Jobs" doesn't clear global (view-only mode) |
| 2026-04 | Set Criteria page was a long vertical stack — saved sets → tabs → manual textarea → AI block with its own textarea → upload block → giant weights → generate block → save checkbox → footer. Users couldn't tell what order to do things in, weights dominated the page, and two textareas (`#criteria-text` + `#criteria-text-ai`) fought for the "real" criteria | Grew organically across three features (manual, AI, upload) with each adding its own panel | Rebuilt as a 3-section, 2-column layout: left = (A) Source + source-specific inputs + (B) compact weight sliders + (C) optional AI Generate block; right = single **Criteria Draft** textarea + unsaved-criteria warning + save checkbox. Removed `#criteria-text-ai` and `syncAICriteriaText()` — generation now writes to the one draft. Added `onCriteriaDraftInput` / `onSaveCriteriaToggle` / `updateUnsavedWarning` helpers. Responsive below 900px |
| 2026-04 | "Use custom criteria" wording was vague; AI Generate mode pushed Criteria Draft box downward; no empty state for saved criteria; save didn't prompt for name | AI Generate block rendered as a separate section between left column and right column, causing layout shift. Dropdown always showed even when no saved sets existed | Renamed to "Create new criteria (from scratch)". Added empty-state message when no saved sets. Moved AI Generate button into source card. Save logic prompts for name if not provided. Saved sets refresh after save |
| 2026-04 | Set Criteria draft squeezed on the right next to config panels — cramped editor, awkward layout | Two-column layout put config (left) beside draft (right), giving the editor less than half the width | Restructured to two-row layout: Row 1 = Criteria Source + Scoring Preferences side by side; Row 2 = full-width Criteria Draft below. Draft now has full content width. CSS class changed from `.criteria-grid`/`.criteria-col` to `.criteria-top-row` |
| 2026-04 | Rejecting or shortlisting a candidate only showed a toast — row actions didn't change, status wasn't visible after refresh | No shortlist status was fetched on Step 4 load; actions were always the same pending set regardless of actual status | Step 4 now fetches `/shortlist?job_id=N` and builds a `shortlistMap`. Rows render state-dependent actions: pending shows buttons, shortlisted shows centered green badge, rejected shows centered red badge. Status updates in-place with pop animation (`statusPop` keyframe). Rows get tinted backgrounds. State persists across refresh |
| 2026-04 | "Run Evaluation" showed generic "Evaluation failed" with no useful info; also failed silently when all candidates were already evaluated (n8n returned empty body) | `apiPost` crashed on empty response body (`res.json()` on empty string); `runEvaluation` catch block had no detail; no pre-check for unevaluated candidates | Fixed `apiPost` to handle empty/malformed response bodies. `runEvaluation` pre-checks candidate state: blocks with clear message if no candidates or all evaluated. Button shows unevaluated count and disables with "\u2713 All Evaluated" when done. Error messages are actionable (network, Ollama, backend, HTTP status) |

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
