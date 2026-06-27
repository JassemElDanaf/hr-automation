# Docker Usage

> **Two modes (as of 2026-06-23):**
> 1. **Full Docker Compose stack** (recommended) — the *entire* app runs in containers: postgres, n8n, ollama, sidecars, frontend. See the next section. This is the primary deployment.
> 2. **Local Windows dev** (`start.sh`/`launch.bat`) — only PostgreSQL runs as a Docker container (`hr-postgres`); everything else runs as native processes. The single-container instructions further down describe *this* mode. Use it for native iteration on Windows.

## Full Docker Compose stack

`docker-compose.yml` runs all five services. Authoritative reference: **README → "Docker Deployment"** and **CLAUDE.md §3**. Quick reference:

```bash
cp .env.example .env           # edit: SMTP/IMAP creds, OLLAMA_DOCKER_HOST, OLLAMA_DATA_DIR (D:)
docker compose up -d           # starts postgres + n8n + ollama + sidecars + frontend
docker compose exec ollama ollama pull qwen3:4b   # one-time model pull (→ OLLAMA_DATA_DIR on D:)
# app: http://localhost:3001   n8n editor: http://localhost:5678 (admin@diyarme.com / ChangeMe123!)

docker compose stop            # shut down (resume: docker compose start)
docker compose down            # stop + remove containers (data kept)
# ⚠️ NEVER `docker compose down -v` — deletes postgres_data/n8n_data/recordings (all data)
```

- **Ollama is always-on** (no profile flag). Models bind-mount to `OLLAMA_DATA_DIR` (keep on D:). Needs **WSL2 memory ≥ 6 GB** (`~/.wslconfig`) or `llama-server` OOM-kills → 0/0/0 evals.
- **n8n** auto-imports/publishes the 6 workflows and seeds the postgres credential (encrypted with n8n's `Salted__`/MD5/base64 cipher; `N8N_ENCRYPTION_KEY` pinned in compose).
- **Volumes:** `postgres_data`, `n8n_data`, `recordings` + the Ollama bind mount — all survive `stop`/`down`/`--build`. Only `down -v` destroys them.

---

## Local-dev mode: the single PostgreSQL container

The rest of this doc covers **mode 2** — the `hr-postgres` container used by `start.sh`/`launch.bat`. Docker Desktop must be running for it to start.

---

## Requirements

- **Docker Desktop** (Windows / Mac) or Docker Engine (Linux)
- Start Docker Desktop before running `launch.bat` / `start.sh`
- `start.sh` attempts to auto-launch Docker Desktop on Windows if it's not running (waits up to 2 minutes for the daemon)

---

## Container Inventory

| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| `hr-postgres` | `postgres:16` | `5432:5432` | Diyar HR database |

Everything else runs natively on the host:
- n8n via `npx n8n`
- Frontend via `npx serve`
- Ollama as a native process
- SMTP sidecar as a Python process

---

## Create the Container (first time)

```bash
docker run -d \
  --name hr-postgres \
  -e POSTGRES_USER=hr_admin \
  -e POSTGRES_PASSWORD=hr_pass \
  -e POSTGRES_DB=hr_automation \
  -p 5432:5432 \
  postgres:16
```

The same command lives in `scripts/setup-db.sh`.

---

## Everyday Commands

### Start an existing container
```bash
docker start hr-postgres
```

### Stop
```bash
docker stop hr-postgres
```

### Restart
```bash
docker restart hr-postgres
```

### Check status
```bash
docker ps                    # running containers
docker ps -a                 # include stopped
docker ps --filter name=hr-postgres
```

### Logs
```bash
docker logs hr-postgres              # dump all
docker logs -f hr-postgres           # follow tail
docker logs --tail 100 hr-postgres   # last 100 lines
```

### Exec into the container
```bash
# psql shell
docker exec -it hr-postgres psql -U hr_admin -d hr_automation

# shell
docker exec -it hr-postgres bash
```

### Inspect
```bash
docker inspect hr-postgres
docker inspect hr-postgres --format '{{.State.Status}}'
```

---

## Data Persistence

Docker's data lives on D:\ — the WSL2 `docker-desktop` distro was exported and re-registered in place at `D:\Docker\wsl\data` so the virtual disk (`.vhdx`) is physically on D:\. This keeps C:\ free. Do **not** set `"data-root"` in `daemon.json` — that forces Docker to use the slow `vfs` storage driver instead of `overlay2`. Data survives `docker stop` / `docker start`.

**To wipe everything:**
```bash
docker stop hr-postgres
docker rm hr-postgres
docker volume prune    # only if you know no other project needs those volumes
```

Then re-run the `docker run` command above and re-apply schema + migrations.

**To back up data:**
```bash
docker exec hr-postgres pg_dump -U hr_admin hr_automation > backup.sql
```

**To restore:**
```bash
docker exec -i hr-postgres psql -U hr_admin -d hr_automation < backup.sql
```

---

## Common Problems

### `docker: Cannot connect to the Docker daemon`
Docker Desktop isn't running. Launch it from the Start menu and wait ~60 seconds.

### `port is already allocated`
Something else is using port 5432. Either stop that process, or edit the `docker run` command to use a different host port (e.g. `-p 5433:5432`) and update `POSTGRES_PORT` in `.env`.

### Container exits immediately
```bash
docker logs hr-postgres
```
Most common: wrong environment variables or password rules violated. Delete the container and re-run with corrected env vars.

### `docker: Error response from daemon: Conflict. The container name "hr-postgres" is already in use`
You already have a container with this name (running or stopped). Either `docker start hr-postgres` to reuse it, or `docker rm hr-postgres` to delete it and recreate.

---

## Memory Limits (WSL2 / Docker Desktop)

Docker Desktop on Windows runs inside WSL2. By default it can consume all available RAM. To cap it:

**Config file:** `C:\Users\Jasse\.wslconfig`

```ini
[wsl2]
memory=4GB
swap=2GB
```

After creating or editing this file:
```bash
wsl --shutdown
# then restart Docker Desktop
```

Docker Desktop will now be limited to 4 GB of RAM. This is the current setting on this machine.

> **Note:** `.wslconfig` must live under `C:\Users\<username>\` — it cannot be relocated to E:\.

---

## History note

This doc originally said "there is no `docker-compose.yml`" because only PostgreSQL was containerized. **That changed on 2026-06-23** — the whole stack (postgres, n8n, ollama, sidecars, frontend) now runs under `docker-compose.yml` (see the "Full Docker Compose stack" section at the top). The single-`docker run` `hr-postgres` container documented above is retained only for the local Windows dev mode (`start.sh`).
