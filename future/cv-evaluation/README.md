# CV Evaluation — Status Note

> This folder originally held planning notes from before CV Evaluation was built. Those notes are **out of date**.

CV Evaluation is now **Phase 3** of the running system and is **fully implemented**. For the current design, see:

- User flow and UX rules: [`../../claude.md`](../../CLAUDE.md) §4 (CV Evaluation)
- Architecture: [`../../docs/architecture.md`](../../docs/architecture.md)
- Workflow JSON: [`../../workflows/phase2-cv-evaluation/phase2-cv-evaluation.json`](../../workflows/phase2-cv-evaluation/phase2-cv-evaluation.json)
- Webhooks: [`../../docs/n8n.md`](../../docs/n8n.md) (Phase 3 section)
- Database tables: [`../../docs/database.md`](../../docs/database.md) (`candidates`, `evaluations`, `criteria_sets`)
- Stakeholder progress report: [`../../report/report.pdf`](../../report/report.pdf)

## What was delivered

1. **Job Selection** — 4-step wizard entry with auto-selection of the global selected job.
2. **Criteria Configuration** — three sources (Write / AI Generate / Upload) into a single editable draft; weights for Skills / Experience / Education must total 100%; named criteria sets can be saved and reloaded.
3. **CV Upload** — drag-and-drop, in-browser PDF text extraction via `pdf.js`, duplicate detection.
4. **AI Evaluation** — sequential Ollama (`qwen3:4b`) scoring; per-dimension scores + reasoning + strengths/weaknesses.
5. **Results** — summary table (Candidate / Email / Submitted / Overall / Actions) with a Details modal for full breakdown; shortcut actions for Shortlist and Reject.

## Why this folder still exists

The `future/` tree is kept as a historical sketchpad for ideas considered before code landed. It is not loaded by the running system. Do not add new planning docs here — use `docs/` or a new folder at the repo root.
