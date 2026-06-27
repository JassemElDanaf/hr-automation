# Diyar HR — End-to-End Tests (Playwright)

E2E suite driving the **live Docker stack** through the real UI: frontend (`:3001`)
→ n8n webhooks (`:5678`) → PostgreSQL / Ollama / SMTP+IMAP sidecars.

## Prerequisites

1. The stack is up and healthy:
   ```bash
   docker compose up -d
   docker compose ps          # all 5 services "Up"; postgres/n8n/ollama "(healthy)"
   ```
2. Ollama has the model: `docker compose exec ollama ollama list` → `qwen3:4b`.
3. Browser binary installed (one-time): `cd frontend-react && npx playwright install chromium`.

## Run

```bash
cd frontend-react
npx playwright test                 # whole suite (headless)
npx playwright test 01-auth         # one file
npx playwright test --debug         # step a single test in the inspector
npx playwright show-report tests/report   # open the HTML report
```

## How data isolation works (READ THIS)

There is **no separate test database.** n8n is wired to the `hr_automation` DB at
container startup and has no per-request DB routing, so the app always writes to
production. Instead, **every test row is labelled** and deleted by label afterward:

- Jobs:        `QA <name> (TEST)`
- Candidates:  name `QA <name>`, email `qa.<x>@example.com`
- Criteria:    `QA <name> (TEST)`

`tests/global-teardown.ts` runs after the suite and `DELETE`s everything matching
those patterns from the production DB (children first, FK-safe). If a run is
interrupted, re-run the teardown SQL manually or just `npx playwright test` again
(teardown runs at the end regardless of pass/fail).

> ⚠️ Because tests touch the live DB, run them with `workers: 1` (configured) and
> not against a production instance you care about. This is a demo system.

## Selector strategy

The app has **no `data-testid` attributes**, so locators use Playwright's
role/text/placeholder engine (e.g. `getByPlaceholder('you@diyarme.com')`,
`getByRole('button', { name: 'Job Openings' })`). Shared locators/helpers live in
`tests/helpers.ts`. If the UI text changes, update helpers there, not each spec.

## Timing — AI steps are slow

Ollama runs on **CPU** in Docker. Expect:
- JD generation: ~70–120 s
- CV evaluation: ~30–90 s per batch
- Interview evaluation: ~30–60 s

The config sets a 240 s per-test timeout and generous action timeouts. Don't lower
them or AI-dependent tests will flake.

## If a test fails

1. Check the stack first: `docker compose ps` and `docker logs hr-automation-n8n-1`.
2. Ollama OOM? `docker logs hr-automation-ollama-1` for `llama-server … killed` →
   raise WSL2 memory (`~/.wslconfig` `memory=6GB`, `wsl --shutdown`).
3. n8n just restarted? Webhooks register ~15–30 s after `/healthz` is OK — re-run.
4. Open the trace: `npx playwright show-trace tests/results/<test>/trace.zip`.

## Output

- Screenshots: `tests/results/*.png` (captured at each major step)
- HTML report: `tests/report/` (`npx playwright show-report tests/report`)
- Traces/video on failure: `tests/results/`

## Coverage

| Spec | Flow |
|------|------|
| `01-auth.spec.ts`        | Login (admin/recruiter/viewer) + invalid-credential rejection |
| `02-jobs.spec.ts`        | Create job (manual + AI JD via Ollama), edit, toggle active |
| `03-cv-eval.spec.ts`     | Criteria gen, CV upload, run evaluation, score sanity (0–10, not all 0) |
| `04-shortlist.spec.ts`   | Shortlist a candidate, change status, verify card state |
| `05-interview.spec.ts`   | Build questions, generate candidate link, run interview, save + score session |
| `06-email.spec.ts`       | Send an email, verify it lands in the Emails tab with a real status |
| `07-dashboard.spec.ts`   | KPI cards reflect created data |
