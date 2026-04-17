# Docker Usage

> **Project status:** Proof of concept, pre-finalization. The PostgreSQL container below is the only service that runs under Docker today; other services may be containerized during finalization. See `report/report.pdf` for the stakeholder progress report.

## TL;DR

The only Docker container in this project is **PostgreSQL**. There is **no `docker-compose.yml`** — the container is created and managed with plain `docker` commands. Docker Desktop must be running for the container to start.

---

## Requirements

- **Docker Desktop** (Windows / Mac) or Docker Engine (Linux)
- Start Docker Desktop before running `launch.bat` / `start.sh`
- `start.sh` attempts to auto-launch Docker Desktop on Windows if it's not running (waits up to 2 minutes for the daemon)

---

## Container Inventory

| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| `hr-postgres` | `postgres:16` | `5432:5432` | HR Automation database |

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

The container uses its default volume. Data survives `docker stop` / `docker start`.

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

## Why no `docker-compose.yml`?

This project has a single container and a single orchestration step. `docker run` is self-documenting at that scale, and avoids pulling in Compose as another dependency. If more services move to Docker (e.g., n8n container or Ollama container), converting to Compose would be reasonable.
