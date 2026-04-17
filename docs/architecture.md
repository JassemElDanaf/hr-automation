# Architecture

> **Project status:** Proof of concept, pre-finalization. The compiled progress report sent to Diyar management lives at `report/report.pdf`.

Full system design. For the quick tour, read `claude.md` first.

---

## System Diagram

```
+--------------------------------------------------+
|                      Browser                     |
|   http://localhost:3000  (frontend/index.html)   |
+-------------------------+------------------------+
                          | fetch()
                          v
+--------------------------------------------------+
|                       n8n                        |
|      http://localhost:5678/webhook/...           |
|   +----------------+  +---------------------+    |
|   | Phase 1 Dash   |  | Phase 2 Job Open.   |    |
|   | Phase 3 CV Ev. |  | Phase 4 Shortlist   |    |
|   |                   | Phase 5 Emails      |    |
|   +--------+-------+  +------+--------------+    |
|            |                 |                   |
+------------+-----------------+-------------------+
             |                 |
             v                 v
  +----------+----+   +--------+------------+   +--------------+
  | PostgreSQL   |   | Ollama              |   | SMTP sidecar |
  | (Docker)     |   | qwen3:4b            |   | Python 8901  |
  | hr-postgres  |   | :11434              |   | -> SMTP      |
  | :5432        |   |                     |   |    provider  |
  +--------------+   +---------------------+   +--------------+
```

Every request the browser sends lands on n8n. n8n orchestrates:
- DB reads/writes via the Postgres node
- AI calls via HTTP Request node → `http://localhost:11434/api/generate`
- Email sends via HTTP Request node → `http://127.0.0.1:8901/`

n8n is both the API gateway and the business-logic engine. There is no separate backend service.

---

## Components

### Frontend — `frontend/index.html`
Single-file SPA. Includes inline:
- HTML for all 5 pages (dashboard, jobs, CV eval wizard, shortlist, emails)
- CSS (custom properties for theming, no framework)
- JS (ES2020, no bundler, no TypeScript)
- `pdf.js` loaded from cdnjs for browser-side PDF text extraction

**State management** — module-level JS variables:
- `allJobs`, `evalJobsCache` — list caches
- `evalSelectedJob`, `evalWizardStep`, `evalCriteria`, `evalUploadedFiles` — CV wizard state
- `currentPage`, `evalJobId` — navigation
- `globalSelectedJob` — the single cross-tab job selection (see "Global selected job" below)

**Global selected job (cross-tab context).**
`globalSelectedJob` is the one source of truth for "which job is the user working on right now?" It's a module-level `{id, job_title, department}` (or `null`) backed by `localStorage` under the key `hr_selected_job`. A dashed-pill badge in the header ("Current Job: {title} · {department}") is always visible so the user never loses context when switching tabs.

| Helper | Role |
|--------|------|
| `loadGlobalSelectedJob()` | Called once at init — restores the last selection from `localStorage` before any tab loads |
| `setGlobalSelectedJob(job)` | Updates state + storage + badge, then calls `syncSelectorsToGlobal()` to mirror into every per-tab `<select>` |
| `clearGlobalSelectedJob()` | Wired to the `&times;` button on the badge — clears state, storage, and every mirrored selector |
| `renderGlobalJobBadge()` | Re-renders the header pill (empty state vs. populated) |
| `syncSelectorsToGlobal()` | Sets `.value` on `#shortlist-job-select`, `#email-job-filter`, `#dash-job-filter` if the matching option exists |
| `readJobFromSelect(el)` | Reconstructs `{id, job_title, department}` from a selector's current `<option>` using `data-title` / `data-dept` attributes set at render time |

**Propagation rules:**
- CV Eval **card click** (`selectJobCard`) → `setGlobalSelectedJob(evalSelectedJob)`.
- Shortlist dropdown change (`onShortlistJobChange`) → `setGlobalSelectedJob(...)` → `loadShortlist()`.
- Email filter change (`onEmailJobFilterChange`) → `setGlobalSelectedJob(...)` → `loadEmails()`.
- Dashboard filter change (`onDashboardJobFilterChange`) → a **specific** job updates global; "All Jobs" does **not** clear global (it's a dashboard-local view so other tabs keep their current selection).
- On CV Eval entry, if no card is selected yet and `globalSelectedJob` exists, `loadJobsForEval()` auto-clicks the matching card — but if the user is past Step 1 on a different job, per-tab override wins (workflow continuity).
- Each per-tab load (`loadJobsForShortlist`, `loadJobsForEmailFilter`, `loadDashboard`) reads `select.value || globalSelectedJob.id` when rebuilding options, so first visit to any tab preselects the global job and auto-loads its data.

**API access** — a single constant `const API = 'http://localhost:5678/webhook';` and two helpers `apiGet(path)` / `apiPost(path, body)`.

**Summary table / Details modal split (CV Evaluation Results).**
The Results screen uses a deliberately narrow table — only summary-level columns — backed by a richer Details modal. This keeps the table scannable at a glance and guarantees the Actions column (Details / Shortlist / Reject) never clips or hides behind a horizontal scrollbar.

| Surface | Shown here |
|---------|------------|
| Results table | Candidate, Email, Submitted, **Overall** (colored badge), Actions |
| Details modal (`viewEvalDetail`) | Overall score (large numeric + tier label), **Skills / Experience / Education** score bars, Strengths, Weaknesses, Evaluation Method + reasoning, Rank (`#N of M`), CV text preview |

Rendered by `renderEvalResults(candidates, results)` (table) and `viewEvalDetail(candidateId)` (modal). Sort defaults to Overall score descending; unevaluated rows fall to the bottom. Rows with no evaluation show "Not evaluated" in the Overall cell and a "Run Evaluation" button in Actions.

The same pattern should be used whenever a dataset has both a quick-scan summary and detailed per-row dimensions: keep the table minimal, put decomposition in a modal.

**Set Criteria page layout (Phase 3 Step 2).**
The Set Criteria step is a three-section, two-column page with a single source of truth for the criteria text.

| Column | Section | Contents |
|--------|---------|----------|
| Left | **A. Criteria Source** | Saved criteria sets dropdown (with refresh); four source tiles (From Job Description · Write / Paste · AI Generate · Upload File); source-specific inputs inline ("From Job Description" loads the selected job's JD into the draft; Additional Context textarea for AI; file input for Upload; a hint for Manual) |
| Left | **B. Scoring Preferences** | Compact weight sliders (Skills, Experience, Education) with a running **Total:** line that turns red + shows a ⚠ prefix when the total ≠ 100% |
| Left | **C. Generate with AI** (conditional) | A subtle-gradient card with the **Generate Criteria** button and a status line. Visible only when the AI source tile is active, so the button physically sits *below* the weights it reads |
| Right | **Criteria Draft** | One editable `<textarea id="criteria-text" class="criteria-draft">`. Every source writes here — AI generation, file upload, saved-set load, and manual typing all populate this single field. Below it: an amber **"Unsaved criteria"** warning card (shown when the draft has text and the save checkbox is unchecked) and the "Save this criteria set" checkbox + name input |

Helpers that keep state coherent:
- `onCriteriaDraftInput()` — fires on every keystroke in the draft; calls `refreshAIGenBtnState()` and `updateUnsavedWarning()`.
- `onSaveCriteriaToggle()` — toggles the save-name input and hides the warning if the user opts to save.
- `updateUnsavedWarning()` — shows the amber card iff `hasText && !willSave`.
- `refreshAIGenBtnState()` — enables the Generate button only when a job is selected AND there's context (job description, current draft, or AI extra-context).

**Invariant:** there is exactly one criteria textarea (`#criteria-text`). Earlier iterations had a second `#criteria-text-ai` textarea inside the AI source panel to show generated output separately — that fought the "editable draft" invariant and has been removed along with its `syncAICriteriaText()` helper. Do not reintroduce a second textarea; if generation output needs a preview, show a diff or confirm-before-replace prompt instead.

Responsive: the `.criteria-grid` collapses to a single column below 900px, and the draft textarea shrinks from 280px to 200px minimum height.

**Shared email composer.**
Every candidate-facing email flow (Reject, Shortlist notification, Interview invitation, Job offer, plus any future status-change email) opens the **same** `#email-modal` via a single helper `openEmailComposer(cfg)`. Subject is a real `<input>`, body is a real `<textarea>` — both pre-filled with a flow-specific template and fully editable. The caller supplies:

| Field | Purpose |
|-------|---------|
| `title`, `description` | Modal heading + one-line explainer |
| `candidate {id, name, email}` | Displayed in the "To" / "Candidate" row |
| `job {id, title}` | Used by `onSend` when building the send payload |
| `emailType` | One of `rejection` / `interview_invite` / `offer` / `custom` — mapped to `email_log.email_type` |
| `defaultSubject`, `defaultBody` | Prefilled into the editable fields; "Reset to default template" restores them |
| `sendLabel`, `sendClass` | Customizes the primary action button |
| `showSendToggle` | `true` for Reject (email is optional — candidate may be rejected silently). `false` for invite/offer (reaching the modal means the user committed to sending) |
| `onSend({ subject, body, sendEmail })` | Async callback with the **user-edited** values. The helper never regenerates or overrides them |

Validation before `onSend` fires: subject non-empty, body non-empty, recipient contains `@`. All send paths call `sendEmailRequest(...)`, which POSTs to `/webhook/send-email` with `custom_subject` + `custom_body` — the backend validator (n8n Code node) uses those verbatim for every `email_type`.

### n8n workflows — `workflows/*`
Each JSON file is one logical workflow containing multiple webhooks. Tags identify the phase.

Node pattern inside each workflow:
```
[Webhook node] → [Code / Validate] → [Postgres node] → [Code / Shape response] → [RespondToWebhook]
```

More complex flows add:
- `If` nodes for branching (e.g., valid input vs. error response)
- HTTP Request node to call Ollama or the SMTP sidecar
- Set node to rename / restructure fields

### PostgreSQL — `hr-postgres` container
Docker container built from `postgres:16`. Single database `hr_automation`. Schema grows additively via numbered migrations. Docker WSL2 distro lives on `E:\Docker\wsl\data` (reimported from C:\ to save space).

### Ollama — local process (`E:\ollama`)
Program at `E:\ollama\program\ollama.exe`. Models stored at `E:\ollama` (set via `OLLAMA_MODELS` and `OLLAMA_HOME` env vars). Model: `qwen3:4b` (~2.5 GB, runs fine on CPU). Invoked with:
```json
POST http://localhost:11434/api/generate
{
  "model": "qwen3:4b",
  "prompt": "...",
  "stream": false,
  "options": { "temperature": 0.4, "num_predict": 4000, "num_ctx": 4096 }
}
```

Used from workflows for:
- JD generation (Phase 2)
- Criteria generation from job description (Phase 3, `/generate-criteria`)
- CV scoring (Phase 3, `/cv-evaluate`)

### SMTP sidecar — `scripts/smtp_server.py`
Tiny `http.server.BaseHTTPRequestHandler` on `127.0.0.1:8901`. Exists because n8n's built-in email node silently succeeded on some credential errors.

Contract:
- `GET /` — health check + configuration state
- `POST /` with `{to, subject, body, from?}` — sends via `smtplib`, returns `{status, error?}`

Reads `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` from env vars.

### Stakeholder report — `report/`
LaTeX progress report packaged separately from the running system. `report.tex` uses `mathptmx` for 12pt Times New Roman, `graphicx` with `\graphicspath{{images/}}` so all screenshots/logo resolve locally, and a custom cover page. Compiled with MiKTeX (`pdflatex` run twice for TOC). Not wired into the runtime — it is documentation artifact, not code.

---

## Data Flow Walkthroughs

### Create Job Opening (Phase 2)
1. Browser POST `/webhook/job-openings` with `{job_title, department, ..., description_source, job_description?}`
2. Validate required fields + enum values
3. Branch on `description_source`:
   - `ai_generate` — call Ollama with a prompt built from the job title + dept + level, return generated JD
   - `manual` — use the provided `job_description` text
   - `file_upload` — extract text from uploaded PDF/TXT on the frontend, then pass to workflow
4. `INSERT INTO job_openings ... RETURNING *`
5. Respond with the created row

### Evaluate CVs (Phase 3)
1. Browser POST `/webhook/cv-evaluate` with `{job_id, criteria_text?, skills_weight, experience_weight, education_weight}`
2. Fetch all unscored candidates for `job_id`
3. For each candidate (sequential, because Ollama is CPU-bound):
   - Build scoring prompt from criteria + weights + CV text
   - POST to Ollama
   - Parse structured response (skills/experience/education scores + reasoning)
   - `INSERT INTO evaluations ... ON CONFLICT (candidate_id, job_opening_id) DO UPDATE`
4. Respond with list of scored evaluations
5. Frontend renders the response in the **Results table** (summary: Candidate, Email, Submitted, Overall, Actions) sorted by Overall desc. Clicking **Details** opens the modal with the full per-dimension breakdown, strengths/weaknesses, reasoning, and CV text. See the "Summary table / Details modal split" note above.

### Reject Candidate (Phase 4 → Phase 5)
1. Browser POST `/webhook/shortlist-update` with `{candidate_id, status: 'rejected'}` (and optional email fields)
2. Upsert into `shortlist` with new status
3. If email fields present, call `/webhook/send-email` inside the same flow
4. `send-email` workflow:
   - Compose MIME message
   - POST to SMTP sidecar
   - Read sidecar response — `sent` / `logged` / `failed`
   - INSERT into `email_log` with the result + error message on failure

---

## Port Map

| Port | Service | Notes |
|------|---------|-------|
| 3000 | Legacy Frontend | `npx serve -l 3000 -s frontend` (fallback) |
| 3001 | React Frontend | `npx vite --port 3001` (primary) |
| 5432 | PostgreSQL | `hr-postgres` container (Docker WSL distro on `E:\Docker\wsl\data`) |
| 5678 | n8n | web UI + `/webhook/*` API (data in `E:\n8n`) |
| 8901 | SMTP sidecar | loopback only (`127.0.0.1`) |
| 11434 | Ollama | loopback (program + models on `E:\ollama`) |

---

## Why these choices

- **n8n over a custom backend** — zero-code webhook + orchestration in a binary HR already understands. Easy to inspect individual executions.
- **Local Ollama over OpenAI** — privacy + cost. `qwen3:4b` runs on consumer CPUs at 100–150s per CV, acceptable for demo-scale.
- **Python SMTP sidecar over n8n's email node** — the built-in node silently routed credential errors to the success branch in early versions. A 100-line Python server with an explicit contract is easier to reason about.
- **Single `index.html`** — no framework tax, no build step, editable with any text editor. Fine for a demo with one active developer.
- **Additive migrations** — safe to re-run, preserves data, matches how the schema grew during development.
