# Frontend Architecture — React + Vite

> **Project status:** Proof of concept, pre-finalization. The React app in `frontend-react/` replaces the legacy monolithic `frontend/index.html`.

---

## Stack

| Tool | Version | Purpose |
|------|---------|---------|
| React | 18 | UI framework |
| Vite | 5 | Dev server + bundler |
| react-router-dom | 6 | Client-side routing |
| chart.js + react-chartjs-2 | — | Dashboard charts |
| pdfjs-dist | — | Client-side PDF text extraction |
| React Context API | — | Shared state (no Redux) |

---

## Directory Structure

```
frontend-react/
  index.html                  ← Vite entry point
  vite.config.js              ← Port 3001, auto-open
  .env                        ← VITE_API_URL=http://localhost:5678/webhook
  package.json
  src/
    main.jsx                  ← ReactDOM.createRoot
    App.jsx                   ← BrowserRouter, providers, routes
    pages/
      Dashboard.jsx           ← Phase 1: KPIs, chart, funnel, activity feed
      JobOpenings.jsx         ← Phase 2: job list, search/filter, create wizard
      CVEvaluation.jsx        ← Phase 3: 4-step wizard
      Shortlist.jsx           ← Phase 4: candidate cards, status transitions
      Emails.jsx              ← Phase 5: email history, SMTP status
    components/
      layout/
        Header.jsx            ← App title + global job badge
        NavTabs.jsx           ← Tab navigation (react-router links)
      common/
        Badge.jsx             ← Status badge (colored pill)
        ScoreBadge.jsx        ← Score display with color coding
        StatCard.jsx          ← Metric display card
        Loading.jsx           ← Spinner
        EmptyState.jsx        ← Empty state message
        Toast.jsx             ← Toast notification
      modals/
        Modal.jsx             ← Reusable modal (backdrop click, Escape key)
        EmailComposerModal.jsx ← Universal editable email composer
        JobDetailModal.jsx    ← Job detail view/edit + toggle active/inactive
        EvalDetailModal.jsx   ← Evaluation detail with score bars, CV preview
    state/
      selectedJob.jsx         ← SelectedJobContext + provider (localStorage persistence)
      uiState.jsx             ← UIContext: toast + email composer state
    services/
      api.js                  ← apiGet(), apiPost() wrappers with VITE_API_URL
      email.js                ← sendEmailRequest(), getEmailStatus(), template generators
    utils/
      helpers.js              ← nameFromFilename, extractEmail, formatDate, scoreClass, etc.
      pdf.js                  ← PDF text extraction via pdfjs-dist worker
    styles/
      global.css              ← All CSS (ported from legacy index.html)
```

---

## Routing

Defined in `App.jsx`:

| Path | Page Component | Phase |
|------|----------------|-------|
| `/` | `Dashboard` | Phase 1 |
| `/job-openings` | `JobOpenings` | Phase 2 |
| `/cv-evaluation` | `CVEvaluation` | Phase 3 |
| `/shortlist` | `Shortlist` | Phase 4 |
| `/emails` | `Emails` | Phase 5 |

Navigation is handled by `NavTabs.jsx` using `useNavigate` / `useLocation` from react-router-dom.

---

## State Management

### Global Job Selection (`state/selectedJob.jsx`)

React Context providing:
- `selectedJob` — `{ id, job_title, department }` or `null`
- `setSelectedJob(job)` — updates context + writes to `localStorage` key `hr_selected_job`
- `clearSelectedJob()` — clears context + removes from `localStorage`

Every page that operates on a single job reads from this context. The Header displays a badge showing the current job. Selection in any page propagates everywhere.

### UI State (`state/uiState.jsx`)

React Context providing:
- `toast` / `showToast(message, type)` — auto-dismissing notification
- `emailComposer` / `openEmailComposer(config)` / `closeEmailComposer()` — universal email modal state

### Local Component State

Each page manages its own data-fetching state (loading, error, lists) via `useState` + `useEffect`. There is no global data cache — each page fetches fresh data on mount or when the selected job changes.

---

## API Layer (`services/api.js`)

```js
const API = import.meta.env.VITE_API_URL;  // http://localhost:5678/webhook

apiGet(path)         → fetch(API + path, { method: 'GET' })
apiPost(path, data)  → fetch(API + path, { method: 'POST', body: JSON.stringify(data) })
```

No custom backend — all requests go to n8n webhook endpoints.

---

## Key Patterns

### Universal Email Composer
All email flows (rejection, shortlist, interview, offer) go through `EmailComposerModal`. The caller provides `emailType`, default subject/body, and an `onSend` callback. The user can edit subject and body before sending. "Reset to default template" restores the prefilled values.

### Job Detail Modal (Editable)
Clicking a job title in the Job Openings table opens `JobDetailModal` in **view mode** showing all job fields (department, employment type, seniority, location, reporting to, description, status, dates). The modal has three modes:
- **View mode:** Read-only display. Footer: Edit | Activate/Deactivate | Close
- **Edit mode:** Form with editable fields (job title, department with custom "Other" option, employment type, seniority level, location type, reporting to, job description). Footer: Cancel | Save Changes
- **Toggle:** Activate/Deactivate patches local state in-place (no full reload)

Save submits to `/job-opening-update` (POST) which dynamically builds an UPDATE query for only the changed fields. The `onToggle` callback refreshes the parent table.

### CV Evaluation Wizard
4-step wizard managed entirely in `CVEvaluation.jsx`:
1. **Select Job** — job cards with state badges
2. **Set Criteria** — 3-row stacked layout:
   - **Row 1** (`.criteria-grid`, 2-column): Criteria Source (left) + Scoring Preferences (right)
   - **Row 2** (full width): Action card — three buttons (Write/Paste, AI Generate, Upload File) + source-specific controls inside
   - **Row 3** (full width): Criteria Draft textarea + unsaved warning + save checkbox
   - **Save logic:** when save checkbox is checked, user must provide a name (prompted on Continue if blank); saved sets refresh immediately and appear in the dropdown
3. **Upload CVs** — drag-and-drop file upload with PDF extraction
4. **Results** — scored candidate table with filter bar, sorting, and state-dependent actions:
   - **Filter bar:** All (default) | Active | Shortlisted | Rejected | Duplicates | Archived — each with count badge
   - **Sort:** unevaluated first → evaluated-pending → shortlisted → rejected; newest first within each group
   - **Pending:** Details, Shortlist, Reject buttons (+ Run Evaluation if unevaluated)
   - **Shortlisted/Interviewed/Hired:** green status badge + Archive button
   - **Rejected:** red status badge + Archive button
   - **Duplicates:** auto-detected by email match; primary = evaluated or newest; others get yellow "Duplicate" badge + "Archive Duplicate" action
   - **Archive:** fade-out animation → undo toast (5s) → committed to localStorage. Archived view shows muted rows + Restore button
   - Status fetched from `/shortlist?job_id=N`, persists on reload
   - Pop animation on state change, subtle row tinting (red/green)
   - Rejected/shortlisted rows stay visible in current filter until user switches tab (deferred removal via `retainedInView`)
   - Toast colors: green for shortlist, red for reject, blue for archive

Step access is governed by job state (`has_criteria`, `has_cvs`, `has_evaluations`). Existing jobs allow non-linear navigation.

### Shortlist
Candidate cards with status pipeline (shortlisted → interviewed → hired) and email actions. Features:
- **Filter bar:** All (default) | Shortlisted | Interviewed | Hired | Rejected | Archived
- **Archive:** same UX as Results — archive button, undo toast (5s), restore from Archived view
- **Email actions:** shortlist notification, interview invite, job offer — all through the shared email composer
- **Email status:** distinct messages for sent/logged/failed — never vague "logged only"
- **Communication status on cards:** each candidate card shows a clickable email banner (latest type, status, timestamp). Clicking expands to show full email history: all emails for that candidate with recipient, subject, date, full body, and error details. Built from `/email-history?job_id=N`, stored as array per candidate. Green banner for sent, red for failed/logged. Updates immediately after sending
- **Full card state transitions:** each card gets a CSS state class (`candidate-card--shortlisted/interviewed/hired/rejected`) that tints the entire card (background, border, shadow). On state change: scale+sweep animation plays (`candidate-card--transitioning`), a status chip appears top-right (`.card-status-chip`), and for decided statuses (hired/rejected) the action buttons are replaced with an animated state badge (`.card-state-badge`). Cards stay visible in the current filter via `retainedInView` until the user switches filters — the visual transition is the primary feedback, toasts are secondary
- **Notified vs not-notified distinction:** shortlisted candidates with at least one successfully sent email get a stronger green card tint, green left accent border (`candidate-card--notified`), and a "✉ Notified" chip next to their name. Candidates not yet emailed keep the lighter default styling
- **Sort order:** cards sorted by `updated_at` (fallback `shortlisted_at`), newest first

### Emails
Email history table with expandable row details. Features:
- **Filter tabs:** All | Sent | Failed
- **SMTP status banner:** derives health from recent send history (working/not configured/unknown)
- **Expandable rows:** each row is clickable — expands to show full email details (recipient, type, date, delivery status badge, error message, full subject and body). Toggle arrow in a fixed-width last column stays in place when expanding/collapsing. Only one row expanded at a time
- **Setup guide modal:** step-by-step SMTP/Gmail configuration instructions

### Dashboard Charts
Uses Chart.js via react-chartjs-2. Doughnut chart for job status distribution, hiring funnel visualization, top jobs table, and recent activity feed.

---

## Running

### Development
```bash
cd frontend-react
npm install
npm run dev          # http://localhost:3001
```

### Production build
```bash
cd frontend-react
npm run build        # outputs to dist/
npx serve -l 3001 -s dist
```

---

## Relationship to Legacy Frontend

The React app is a full rewrite of `frontend/index.html` (3526 lines of HTML+CSS+JS). Both can run simultaneously on different ports (legacy on 3000, React on 3001). The backend (n8n webhooks) is shared — no backend changes were needed.

The legacy frontend remains as a reference and fallback. Once the React app is validated, the legacy frontend can be retired.
