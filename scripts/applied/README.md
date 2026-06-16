# Applied patch scripts

One-shot n8n workflow patchers that have **already been applied** to the live
sqlite DB (`workflow_entity` + `workflow_history`) **and** exported back into
the repo workflow JSONs via `../export-live-workflows.py`.

They are kept for reference (canonical examples of the dual-table patch
protocol — see CLAUDE.md §8) but should not need to be re-run. If you write a
new patcher, run it from `scripts/`, then move it here once applied + exported.
