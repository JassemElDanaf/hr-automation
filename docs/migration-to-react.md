# Migration to React — What Changed and Why

> Documents the migration from `frontend/index.html` (monolithic SPA) to `frontend-react/` (React + Vite).

---

## Motivation

The legacy frontend was a single 3526-line HTML file containing all CSS (~667 lines), HTML (~660 lines), and JavaScript (~2200 lines). This worked for rapid prototyping but became difficult to maintain as the feature set grew. Specific pain points:

- No component reuse — modal, toast, badge patterns duplicated across pages
- State scattered across module-level variables with manual DOM manipulation
- No dev server with hot reload — every change required a full page refresh
- Difficult to onboard new developers — one file, no separation of concerns

---

## What Was Migrated

Every feature from the legacy frontend was ported:

| Feature | Legacy Location | React Location |
|---------|----------------|----------------|
| Dashboard (KPIs, chart, funnel, activity) | `loadDashboard()` + inline HTML | `pages/Dashboard.jsx` |
| Job Openings (list, create wizard) | `loadJobs()`, `openCreateJobModal()` | `pages/JobOpenings.jsx` |
| CV Evaluation (4-step wizard) | `loadJobsForEval()`, `evalGoStep()`, etc. | `pages/CVEvaluation.jsx` |
| Shortlist (status transitions) | `loadShortlist()`, `updateShortlistStatus()` | `pages/Shortlist.jsx` |
| Emails (history, SMTP status) | `loadEmails()`, `loadEmailHistory()` | `pages/Emails.jsx` |
| Global job selection | `globalSelectedJob` + `localStorage` | `state/selectedJob.jsx` (Context) |
| Email composer | `openEmailComposer()` | `components/modals/EmailComposerModal.jsx` |
| Toast notifications | `showToast()` | `state/uiState.jsx` + `components/common/Toast.jsx` |
| PDF extraction | Inline `pdfjsLib` usage | `utils/pdf.js` |
| All CSS | `<style>` block in index.html | `styles/global.css` |

---

## Architecture Decisions

### React Context over Redux
The app has two pieces of shared state (selected job and UI state). React Context is sufficient — Redux would add complexity without benefit at this scale.

### Single CSS file (ported as-is)
All CSS was lifted from the legacy `<style>` block into `global.css`. No CSS modules or styled-components — keeps the migration simple and the visual output identical. Can be refactored later if needed.

### Services layer
API calls were extracted from inline `fetch()` calls into `services/api.js` and `services/email.js`. This centralizes the base URL and error handling.

### No backend changes
The React app talks to the exact same n8n webhook endpoints. No new API routes, no proxy, no BFF. The `.env` file sets `VITE_API_URL=http://localhost:5678/webhook`.

---

## State Mapping

| Legacy Variable | React Equivalent |
|----------------|-----------------|
| `globalSelectedJob` | `SelectedJobContext` value |
| `evalWizardStep` | `useState` in `CVEvaluation.jsx` |
| `evalSelectedJob` | Derived from `selectedJob` context |
| `evalCriteria` | `useState` in `CVEvaluation.jsx` |
| `shortlistData` | `useState` in `Shortlist.jsx` |
| `emailData` | `useState` in `Emails.jsx` |
| `currentEmailContext` | `emailComposer` in `UIContext` |
| `allJobs` (cached list) | `useState` in each page (no global cache) |

---

## File Count

| Category | Count |
|----------|-------|
| Pages | 5 |
| Layout components | 2 |
| Common components | 6 |
| Modal components | 4 |
| State providers | 2 |
| Services | 2 |
| Utils | 2 |
| Styles | 1 |
| Config files | 3 (vite.config.js, .env, index.html) |
| **Total** | **~30 files** |

---

## How to Verify

1. Start all backend services (Docker, n8n, Ollama, SMTP sidecar)
2. Run the React dev server: `cd frontend-react && npm run dev`
3. Walk through the verification checklist in `docs/runbook.md` section 5, using port 3001 instead of 3000
4. Compare behavior against the legacy frontend on port 3000 side by side

---

## Known Differences from Legacy

- **Port:** React runs on 3001 (dev) vs legacy on 3000
- **Routing:** React uses URL paths (`/job-openings`, `/cv-evaluation`) vs legacy uses JS-based page switching (no URL change)
- **Build step:** React requires `npm install` + `npm run dev` (or `npm run build`); legacy has no build step
- **Bundle size:** Vite build produces a ~500KB+ chunk (includes React, Chart.js, pdfjs-dist). Legacy loads libraries from CDN
