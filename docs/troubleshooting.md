# Troubleshooting

Symptom-first index. Each entry: what you will see, why it happens, and the exact fix.

---

## Startup

### `launch.bat` flashes and closes

**Symptom:** double-clicking `launch.bat` opens a window that closes immediately.
**Cause:** Git Bash not found at any of the paths probed in `launch.bat`.
**Fix:** install Git for Windows from <https://git-scm.com/download/win>, or edit `launch.bat` to point to your `bash.exe`.

### `start.sh` hangs at "Launching Docker Desktop"

**Symptom:** script prints dots for 2+ minutes then errors out.
**Cause:** Docker Desktop is not installed, or it is installed but WSL2 is not set up.
**Fix:** launch Docker Desktop manually, wait for the whale icon to settle, then re-run `start.sh`. On a first-time install, reboot after Docker installs.

### Services appear to start but all status pills stay red

**Symptom:** `start.sh` completes, the React app opens, but every service pill shows red.
**Cause:** a leftover `node.exe` process from a previous session is holding port 5678. The new n8n process fails silently and the frontend cannot reach the webhooks.
**Fix:**
```bash
taskkill /f /im node.exe
# then re-run start.sh
```

---

## Docker / PostgreSQL

### `docker: Cannot connect to the Docker daemon`

**Cause:** Docker Desktop is not running.
**Fix:**
```bash
# Launch Docker Desktop from the Start menu, then wait ~60 s
docker info
```

### Port 5432 already allocated

**Cause:** another process (a second Postgres, another app) is already using port 5432.
**Fix (temporary):** stop the conflicting process.
**Fix (permanent):** change the host port:
```bash
docker rm hr-postgres
docker run -d --name hr-postgres \
  -e POSTGRES_USER=hr_admin -e POSTGRES_PASSWORD=hr_pass \
  -e POSTGRES_DB=hr_automation -p 5433:5432 postgres:16
```
Then update the host port in the n8n `HR PostgreSQL` credential to match.

### `hr-postgres` exits immediately after start

**Cause:** corrupted data volume or bad environment variable on creation.
**Fix:**
```bash
docker logs hr-postgres
# read the error, then:
docker rm hr-postgres
# recreate with the docker run command from the runbook
```

### Password authentication failed for user "hr_admin"

**Cause:** the n8n credential has the wrong password.
**Fix:** n8n > Settings > Credentials > `HR PostgreSQL` > re-enter password `hr_pass`.

### "relation does not exist"

**Cause:** a migration has not been applied.
**Fix:** run all migrations:
```bash
for f in db/migrations/*.sql; do
  docker exec -i hr-postgres psql -U hr_admin -d hr_automation < "$f"
done
```

---

## n8n

### `curl` to `/healthz` returns a CORS error in the browser

**Cause:** the `/healthz` endpoint has no CORS headers and cannot be called from browser JavaScript.
**Fix:** use a webhook endpoint to verify n8n is up instead:
```bash
curl http://localhost:5678/webhook/interview/jobs
```
Any valid JSON response (not connection refused) means n8n is running.

### Webhooks return 404 but the workflow shows Active

**Cause:** `activeVersionId` is not set correctly in sqlite — n8n's internal registration did not complete.
**Fix:** toggle the workflow OFF then ON in the n8n UI. If the issue persists after any REST deactivate/activate cycle, re-patch the DB before calling activate:
```bash
# In the n8n sqlite DB (D:\n8n\.n8n\database.sqlite)
UPDATE workflow_entity SET active=1, activeVersionId=<ver> WHERE id='N';
```
Then call the activate endpoint. See runbook section 7 for the full REST auth flow.

### n8n returns HTTP 200 with an empty body when Postgres is unreachable

**Cause:** the n8n webhook responds 200 even when a Code node catches a DB error internally. The failure is not surfaced as a 5xx.
**Fix:** health checks that inspect n8n DB connectivity must check that the response body is non-empty — HTTP status alone is not sufficient.

### Workflow patch applied but n8n still runs the old behavior

**Cause:** you patched `workflow_entity.nodes` but not `workflow_history`. n8n executes the snapshot in `workflow_history` indexed by `activeVersionId`, not the draft in `workflow_entity`.
**Fix:** always patch both tables. See the patching protocol in the runbook.

### "Could not find credential: HR PostgreSQL"

**Cause:** the n8n credential does not exist, or it was created with a different name.
**Fix:** n8n > Settings > Credentials > Add Credential > Postgres. Name it exactly `HR PostgreSQL` (case-sensitive, with a space).

### Execution fails at the Ollama HTTP Request node

**Cause:** Ollama is not running, or the model has not been pulled.
**Fix:**
```bash
# Check if Ollama is running
curl -s http://localhost:11434/api/tags

# If not running:
"D:/ollama/program/ollama.exe" serve

# If the model is missing:
"D:/ollama/program/ollama.exe" pull qwen3:4b
```

---

## Frontend

### All service status pills show red on first load

**Symptom:** every pill is red immediately after the app opens.
**Cause:** services take a few seconds to start and register their webhooks after `start.sh` launches them. The first health-check poll fires before they are ready.
**Fix:** click the refresh icon to recheck, or wait 30 seconds for the automatic re-check.

### The DB pill stays green when Docker is paused

**Cause:** the health check reads the n8n webhook response body, not the HTTP status code. If the webhook returns a 200 with a non-empty body for any reason (e.g. a cached response), the pill stays green.
**Fix:** ensure the n8n DB-check webhook is configured to verify the response body is non-empty and contains expected data.

### Tooltip appears above the pills instead of below

**Cause:** CSS bug — the tooltip used `bottom` positioning instead of `top`.
**Fix:** in the relevant stylesheet, use `top: calc(100% + 8px)` instead of `bottom`.

### Generate Interview Link button does nothing

**Cause:** `btoa()` crashes on Unicode characters (such as em dashes) in AI-generated questions. The exception is swallowed silently.
**Fix:** this has been corrected in the current codebase. The encoder now uses:
```js
btoa(unescape(encodeURIComponent(data)))
```
If you see a blank button with no error, verify the fix is in place and rebuild.

### "Failed to save to bank" in QBank

**Cause:** either the `question_bank` table was not created (migration 013 not run), or the QBank webhook nodes are missing a `webhookId` field.
**Fix:** run all migrations, then verify the QBank workflow nodes have `webhookId` set.

### React app loads but all API calls fail

**Cause:** n8n is not running, or `VITE_API_URL` in `frontend-react/.env` points to the wrong address.
**Fix:**
1. Verify n8n is up: `curl http://localhost:5678/webhook/interview/jobs`
2. Check `frontend-react/.env` contains `VITE_API_URL=http://localhost:5678/webhook`
3. Restart the dev server after editing `.env` (Vite only reads env vars at startup)

---

## Ollama

### CV evaluation takes 100+ seconds per candidate

**Not a bug.** `qwen3:4b` running on CPU takes approximately 100 seconds per CV. Keep batch sizes small (fewer than 10) for demos.

### `{"error": "model 'qwen3:4b' not found"}`

**Fix:**
```bash
"D:/ollama/program/ollama.exe" pull qwen3:4b
```

### Questions or JD output starts with "Okay, the user wants..."

**Cause:** the preamble-stripping patch has not been applied to the n8n workflow nodes. `qwen3:4b` emits inline reasoning even when `think:false` is set.
**Fix:** run `scripts/patch_ollama_thinking.py` (patches both `workflow_entity` and `workflow_history` in `D:\n8n\.n8n\database.sqlite`), then restart n8n.

---

## SMTP / IMAP

### Emails show status "logged" (not sent)

**Cause:** `SMTP_HOST` is not set in `.env`. The sidecar runs but skips actual delivery and logs the attempt instead.
**Fix:** fill in `SMTP_HOST` (and the other `SMTP_*` vars) in `.env`, then restart the sidecar:
```bash
taskkill /f /im python.exe
python scripts/smtp_server.py
curl http://127.0.0.1:8901/   # should show smtp_configured: true
```

### `SMTPAuthenticationError`

**Cause:** wrong Gmail App Password, or two-step verification is not enabled on the account.
**Fix:**
1. Enable 2-Step Verification on the Google account
2. Create a new App Password at <https://myaccount.google.com/apppasswords>
3. Put it in `.env` as `SMTP_PASS` (no spaces, no quotes)
4. Restart the SMTP sidecar

### IMAP sidecar is running but no inbound replies appear

**Cause:** either `IMAP_HOST` is not set in `.env`, or the reply email has no `In-Reply-To` header (a cold inbound from someone who was not originally emailed from the system). Cold inbounds are intentionally not supported — they have no parent row to attach to.
**Fix:** set `IMAP_HOST`, `IMAP_USER`, `IMAP_PASS` in `.env` and restart the sidecar. Cold inbounds cannot be threaded and will be acknowledged as orphans.

### Multiple SMTP sidecar instances running

**Symptom:** `curl http://127.0.0.1:8901/` returns "address already in use" errors, or emails are duplicated.
**Fix:**
```bash
taskkill /f /im python.exe   # kills all Python processes
python scripts/smtp_server.py
python scripts/imap_server.py
# restart any other Python sidecars as needed
```

---

## Live Interview

### Interview link decodes to garbage / JSON parse error

**Cause:** encoding mismatch between the link generator and decoder.
**Fix:** the encoder must use `btoa(unescape(encodeURIComponent(...)))` and the decoder must use `decodeURIComponent(escape(atob(...)))`. Both sides must use the same pair.

### QBank PUT returns an empty response

**Cause:** a WHERE clause bug used `body.id` when the `id` is passed as a query parameter.
**Fix:** this has been corrected in the current codebase. Verify the fix is present if you see empty responses on PUT.

### `advanceQuestion` crashes during an interview

**Cause:** an undefined variable `q` was used instead of `nextQ` in the `speak()` call.
**Fix:** this has been corrected in the current codebase.

---

## Report (LaTeX)

### `pdflatex` not found

**Cause:** MiKTeX is not on the system PATH.
**Fix:** call the binary directly:
```bash
"C:/Users/Jasse/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdflatex.exe" report.tex
```

### TOC or page numbers look wrong after compile

**Cause:** LaTeX needs a second pass to resolve forward references.
**Fix:** run `pdflatex` twice in the `report/` folder.

### "File `images/xxx.png' not found"

**Cause:** the screenshot filename does not match what `report.tex` expects.
**Fix:** check `report/images/` — filenames are lowercase and hyphen-separated with no spaces (e.g. `dashboard.png`, `criteria-ai.png`). Rename the file to match rather than editing the `.tex`.
