# Troubleshooting

> **Project status:** Proof of concept, pre-finalization. Known issues listed here are the ones encountered during build-out; production hardening will add more. See `report/report.pdf` for the stakeholder progress report.

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
cd /d/n8n
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

### CV evaluation workflow execution fails with `null value in column "candidate_id"`
**Symptom:** Phase 3 CV Evaluation workflow (`wf=2`) shows `status=error` in the execution list and the browser shows a generic evaluation failure.
**Cause:** the request reached the workflow when all candidates for that job were already scored. "Eval - Prepare Prompts" emits a single no-candidates marker item (`error:true`, no `candidate_id`), which earlier fell through "Call Ollama" → "Score Candidates" → "Save Evaluations" and tried to INSERT with a null candidate_id.
**Fix:** already shipped — "Eval - Score Candidates" now has an early guard that filters prompt items and returns `{error:true,message:'No unevaluated candidates to score'}` when there's nothing to score. If it happens again, confirm the workflow JSON in `workflows/phase2-cv-evaluation/` contains the guard block at the top of the `Eval - Score Candidates` node's `jsCode`.

### Ollama appears to run on integrated GPU, not the dGPU
**Symptom:** Task Manager → Performance shows Ollama activity on the integrated GPU, inference feels slow.
**Cause:** Windows Optimus hides per-process GPU assignment behind the default "GPU 0" view. Most of the time Ollama is already on the NVIDIA dGPU but Task Manager just shows the iGPU.
**Fix (verify first):**
```powershell
nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv
curl http://localhost:11434/api/ps
# size_vram > 0 means model is on the dGPU
```
If the NVIDIA GPU genuinely isn't being used, force it per-app (no admin needed):
```powershell
$k = 'HKCU:\Software\Microsoft\DirectX\UserGpuPreferences'
if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }
Set-ItemProperty -Path $k -Name 'D:\ollama\program\ollama.exe' -Value 'GpuPreference=2;' -Type String
```
Then restart Ollama.

### Per-row "Run Evaluation" button in CV Evaluation seems to do nothing
**Symptom:** clicking the purple "Run Evaluation" button on a single candidate row produces no visible feedback; ~15 s later a toast fires (or not).
**Cause / fix:** already shipped — `evaluateOne` now shows `Evaluating… NN%` on the clicked row with a progress bar above the table, disables other rows, and fires an immediate info toast so you know the click registered. If you're still seeing no response at all, it's a backend issue — check `/healthz`, `ollama ps`, and the n8n execution list for an `error` status.

### Execution fails at an HTTP Request node calling Ollama
**Cause:** Ollama not running, or model not pulled.
**Fix:**
```bash
curl -s http://localhost:11434/api/tags | grep qwen3
# if empty:
ollama pull qwen3:4b
# if Ollama itself is down:
"/d/ollama/program/ollama.exe" serve &
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
**Not a bug.** `qwen3:4b` on CPU processes roughly that fast (~100 s per CV). On this host Ollama runs on the NVIDIA GTX 1650 via CUDA (~10-15 s per CV). For demos, still keep batches under ~10 CVs so the progress bar stays snappy.

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

---

## React Frontend (`frontend-react/`)

### `npm run dev` fails with "port 3001 already in use"
**Cause:** another process is on port 3001.
**Fix:** kill it, or let Vite auto-select the next free port (it will print the actual URL).
```bash
# find what's using 3001
netstat -ano | findstr :3001
# kill by PID
taskkill /PID <pid> /F
```

### React app loads but API calls fail (CORS or connection refused)
**Cause:** n8n is not running, or `VITE_API_URL` is wrong.
**Fix:**
1. Confirm n8n is up: `curl http://localhost:5678/healthz`
2. Check `frontend-react/.env` contains `VITE_API_URL=http://localhost:5678/webhook`
3. Restart the dev server after editing `.env` (Vite only reads env at startup)

### React app shows blank page / white screen
**Cause:** JS error during render.
**Fix:** open browser DevTools → Console, read the error. Common causes:
- Missing dependency → run `npm install` in `frontend-react/`
- API returning unexpected shape → check n8n workflow is active

### Charts don't render on Dashboard
**Cause:** `chart.js` or `react-chartjs-2` not installed.
**Fix:**
```bash
cd frontend-react && npm install chart.js react-chartjs-2
```

### PDF upload / extraction doesn't work
**Cause:** `pdfjs-dist` not installed or worker misconfigured.
**Fix:**
```bash
cd frontend-react && npm install pdfjs-dist
```
Check `src/utils/pdf.js` points to the correct worker path.

### Build produces "chunk size > 500 kB" warning
**Not a bug.** Vite warns when output chunks are large. The app works fine. To suppress or split:
```js
// vite.config.js
build: {
  rollupOptions: {
    output: { manualChunks: { vendor: ['react', 'react-dom'] } }
  }
}
```

---

## Report (LaTeX / MiKTeX)

### `pdflatex` not found
**Cause:** MiKTeX not installed or not on PATH.
**Fix:** call the binary directly:
```bash
"C:/Users/Jasse/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdflatex.exe" report.tex
```

### TOC or page numbers look wrong after compile
**Cause:** LaTeX needs a second pass to resolve forward references.
**Fix:** run `pdflatex report.tex` twice.

### "File `images/xxx.png' not found"
**Cause:** screenshot filename does not match what `report.tex` expects.
**Fix:** check `report/images/` — filenames are lowercase, hyphen-separated, no spaces (`dashboard.png`, `criteria-ai.png`, `n8n-workflows.png`, etc.). Rename on copy rather than editing the `.tex`.
