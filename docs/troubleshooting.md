# Troubleshooting

Symptom-first index. Each entry: what you'll see, why it happens, exact fix.

---

## Startup

### `launch.bat` flashes and closes
**Symptom:** double-clicking `launch.bat` opens a window that closes immediately.
**Cause:** Git Bash not found at any of the paths probed in `launch.bat`.
**Fix:** install Git for Windows from <https://git-scm.com/download/win>, or edit `launch.bat` lines 11–13 to point to your `bash.exe`.

### `start.sh` hangs at "Launching Docker Desktop"
**Symptom:** script prints dots for 2+ minutes then errors out.
**Cause:** Docker Desktop isn't installed, or it's installed but WSL2 isn't set up.
**Fix:** launch Docker Desktop manually, wait for the whale icon to settle, then re-run `start.sh`. If first-time install, reboot after the Docker install.

---

## Docker / PostgreSQL

### `docker: Cannot connect to the Docker daemon`
**Cause:** Docker Desktop not running.
**Fix:**
```bash
# Windows
"/c/Program Files/Docker/Docker/Docker Desktop.exe" &
# then wait ~60s
docker info
```

### `Error response from daemon: port is already allocated`
**Cause:** another process is using port 5432 (another Postgres, another app).
**Fix (temporary):** stop the conflicting process. **Fix (permanent):** change host port:
```bash
docker rm hr-postgres
docker run -d --name hr-postgres \
  -e POSTGRES_USER=hr_admin -e POSTGRES_PASSWORD=hr_pass \
  -e POSTGRES_DB=hr_automation -p 5433:5432 postgres:16
```
Then update `POSTGRES_PORT=5433` in `.env` and in the n8n credential.

### `hr-postgres` exits immediately after start
**Cause:** corrupted data volume or bad env var.
**Fix:**
```bash
docker logs hr-postgres
# read the error, then
docker rm hr-postgres
bash scripts/setup-db.sh
```

### Can't connect from n8n: `password authentication failed for user "hr_admin"`
**Cause:** n8n credential has wrong password.
**Fix:** open n8n → Settings → Credentials → `HR PostgreSQL` → re-enter password `hr_pass`.

### "relation does not exist"
**Cause:** migration not applied.
**Fix:**
```bash
for f in db/migrations/*.sql; do
  docker exec -i hr-postgres psql -U hr_admin -d hr_automation < "$f"
done
```

---

## n8n

### `curl http://localhost:5678/healthz` returns connection refused
**Cause:** n8n not running.
**Fix:**
```bash
npx n8n start > /dev/null 2>&1 &
sleep 8
curl http://localhost:5678/healthz
```

### Webhooks return 404 but workflow shows "Active" in UI
**Cause:** n8n bug — `activeVersionId` not set in sqlite.
**Fix:**
```bash
pkill -f "npx n8n start"
cd ~/.n8n
sqlite3 database.sqlite "UPDATE workflow_entity SET active=1, activeVersionId=versionId WHERE id IN ('1','2','3','4','5');"
npx n8n start > /dev/null 2>&1 &
```

### Webhooks work but return empty / wrong data
**Cause:** stale cached workflow after a re-import.
**Fix:**
1. Open the workflow in n8n UI
2. Toggle Active off → on
3. If that doesn't work: delete from UI, re-import the JSON, re-activate

### "Could not find credential: HR PostgreSQL"
**Cause:** n8n credential wasn't created, or was named differently.
**Fix:** n8n → Settings → Credentials → Add Postgres → name it **exactly** `HR PostgreSQL` with the params in `docs/database.md`.

### Execution fails at an HTTP Request node calling Ollama
**Cause:** Ollama not running, or model not pulled.
**Fix:**
```bash
curl -s http://localhost:11434/api/tags | grep qwen3
# if empty:
ollama pull qwen3:4b
# if Ollama itself is down:
"/e/ollama/program/ollama.exe" serve &
```

---

## Frontend

### `http://localhost:3000` shows "Cannot GET /"
**Cause:** `serve` was started in the wrong directory.
**Fix:**
```bash
pkill -f "serve -l 3000"
cd frontend
npx serve -l 3000 -s . > /dev/null 2>&1 &
```

### UI loads but all API calls fail with CORS error
**Cause:** frontend hitting a different host than where n8n listens (e.g., file:// origin, or remote host).
**Fix:** open the frontend via `http://localhost:3000`, not by double-clicking `index.html`. Keep n8n on the same machine.

### UI shows stale data after a code change
**Cause:** browser cache on `index.html`.
**Fix:** hard reload with `Ctrl+Shift+R`. The server has no cache headers, so once refreshed you get the latest.

### "Submit CV" shows upload progress forever
**Cause:** PDF.js extraction stuck on a malformed PDF, or `cv-submit` webhook not responding.
**Fix:** check the browser DevTools console for PDF.js errors. If extraction fails, re-save the PDF in a different viewer and retry. If the webhook is slow, confirm n8n is up and Ollama isn't hogging CPU.

---

## Ollama

### CV evaluation takes 100+ seconds per candidate
**Not a bug.** `qwen3:4b` on CPU processes roughly that fast. Keep the number of CVs in a single run small (<10) for demos.

### Ollama returns `{"error": "model 'qwen3:4b' not found"}`
**Fix:**
```bash
ollama pull qwen3:4b
```

### Ollama eats all RAM
**Cause:** too many concurrent requests.
**Fix:** the evaluate workflow is sequential on purpose — don't call `/cv-evaluate` in parallel from multiple tabs.

---

## SMTP

### Emails page shows "SMTP status unknown" or "not configured"
**Cause:** `SMTP_HOST` env var is empty when the sidecar started.
**Fix:**
```bash
# Put real values in .env
# Then restart the sidecar
pkill -f smtp_server.py
python scripts/smtp_server.py > /dev/null 2>&1 &
curl http://127.0.0.1:8901/    # should show smtp_configured: true
```

### Every email shows `status='failed'` with `error: SMTPAuthenticationError`
**Cause:** wrong Gmail app password, or 2FA not enabled on the account.
**Fix:**
1. Enable 2-Step Verification on the Google account
2. Create a new App Password at <https://myaccount.google.com/apppasswords>
3. Put it in `.env` as `SMTP_PASS` (no spaces)
4. Restart the sidecar

### Emails silently land in spam
**Cause:** `SMTP_FROM` domain doesn't match the authenticated `SMTP_USER`. For example, sending via a Gmail account but setting `SMTP_FROM="HR <hr@diyar.com>"` — Gmail flags the mismatch.
**Fix:** set `SMTP_FROM` to match `SMTP_USER`, e.g. `SMTP_FROM="Diyar HR <your-address@gmail.com>"`.

---

## Stale / cached state

### UI state doesn't match DB after a direct SQL change
**Cause:** frontend caches list responses in module-level JS variables.
**Fix:** hard refresh the page (Ctrl+Shift+R), or navigate away and back.

### Workflow JSON edited but n8n still runs old version
**Cause:** n8n only re-reads the JSON on import, not on file change.
**Fix:**
```bash
npx n8n import:workflow --input=workflows/phase2-cv-evaluation/phase2-cv-evaluation.json
# then in UI toggle active off/on, or run the sqlite UPDATE above
```

---

## Schema mismatches

### Workflow fails with `column "X" does not exist`
**Cause:** migration added a column but workflow was not updated; or vice versa.
**Fix:** find the owning migration in `db/migrations/`, run it:
```bash
docker exec -i hr-postgres psql -U hr_admin -d hr_automation < db/migrations/005-phase4-smtp.sql
```

### `INSERT ... ON CONFLICT` fails: "no unique or exclusion constraint"
**Cause:** the UNIQUE constraint on the target table is missing — migration not applied or was dropped.
**Fix:** re-run the migration file that creates the UNIQUE constraint.

---

## Missing env vars

### `start.sh` reports "Loaded config from .env" but SMTP still logs only
**Cause:** .env was edited after services started.
**Fix:** restart the sidecar — env vars are read at process start.

### Completely fresh machine — `.env` doesn't exist
**Fix:** `cp .env.example .env` and fill in the SMTP values.
