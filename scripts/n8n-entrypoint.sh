#!/bin/sh
# n8n startup entrypoint — patch + import + publish workflows, seed credential, then run.
set -e

# Ollama host selection. OLLAMA_DOCKER_HOST may be:
#   host.docker.internal  → always use a host-installed Ollama (e.g. GPU on Windows)
#   ollama                → always use the bundled Docker container (CPU)
#   auto (default)        → detect: use a host Ollama if one is reachable, else the
#                           bundled container. This makes a fresh `git pull` + Docker
#                           run work anywhere (Ubuntu with no host Ollama → CPU container).
OLLAMA_HOST="${OLLAMA_DOCKER_HOST:-auto}"
if [ "$OLLAMA_HOST" = "auto" ] || [ -z "$OLLAMA_HOST" ]; then
  if wget -q -T 3 -O /dev/null "http://host.docker.internal:11434/api/tags" 2>/dev/null; then
    OLLAMA_HOST="host.docker.internal"
    echo "[entrypoint] Ollama: host install detected (host.docker.internal:11434) — using it."
  else
    OLLAMA_HOST="ollama"
    echo "[entrypoint] Ollama: no host install — using the bundled Docker container (CPU)."
  fi
fi
SIDECAR="${SIDECAR_DOCKER_HOST:-sidecars}"
export DB_FILE="/home/node/.n8n/database.sqlite"
NODE="/opt/nodejs/node-v24.14.1/bin/node"
export SQLITE3_MOD="/usr/local/lib/node_modules/n8n/node_modules/.pnpm/sqlite3@5.1.7/node_modules/sqlite3"

# ── Sync config file encryption key with N8N_ENCRYPTION_KEY env var ──────────
# n8n 2.x refuses to start if the config file key != env var.
# Overwrite the config file so they always match on every startup.
mkdir -p /home/node/.n8n
"$NODE" -e "
const fs = require('fs');
const key = process.env.N8N_ENCRYPTION_KEY;
if (key) {
  fs.writeFileSync('/home/node/.n8n/config', JSON.stringify({encryptionKey: key}, null, '\t'));
  console.log('[n8n-setup] Config file synced with N8N_ENCRYPTION_KEY.');
}
"

# ── Build N8N_CREDENTIALS_OVERWRITE_DATA ─────────────────────────────────────
export N8N_CREDENTIALS_OVERWRITE_DATA="{\"postgres\":{\"host\":\"${DB_HOST:-postgres}\",\"port\":${DB_PORT:-5432},\"database\":\"${DB_NAME:-hr_automation}\",\"user\":\"${DB_USER:-hr_admin}\",\"password\":\"${DB_PASS:-hr_pass}\",\"ssl\":\"disable\"}}"

# ── Patch workflow JSONs for Docker networking + tenant company name ──────────
PATCH_DIR="/tmp/workflows-patched"
mkdir -p "$PATCH_DIR"

# Global tenant company name — baked into the AI prompts (JD/criteria generation)
# at import time so generated content references the right company. Single source
# of truth: the COMPANY_NAME env (docker-compose ← .env). Escape sed specials so a
# name with & or | doesn't break the substitution.
COMPANY_NAME="${COMPANY_NAME:-Diyar United Company}"
COMPANY_NAME_SED=$(printf '%s' "$COMPANY_NAME" | sed -e 's/[&|\\]/\\&/g')

find /workflows -name '*.json' -type f | while IFS= read -r f; do
  dir_name=$(basename "$(dirname "$f")")
  base_name=$(basename "$f")
  out="$PATCH_DIR/${dir_name}__${base_name}"
  sed \
    -e "s|http://localhost:11434|http://${OLLAMA_HOST}:11434|g" \
    -e "s|http://127.0.0.1:11434|http://${OLLAMA_HOST}:11434|g" \
    -e "s|http://127.0.0.1:8901|http://${SIDECAR}:8901|g" \
    -e "s|http://127.0.0.1:8902|http://${SIDECAR}:8902|g" \
    -e "s|http://127.0.0.1:8903|http://${SIDECAR}:8903|g" \
    -e "s|http://127.0.0.1:8904|http://${SIDECAR}:8904|g" \
    -e "s|Diyar United Company|${COMPANY_NAME_SED}|g" \
    "$f" > "$out"
done

# ── Import workflows ──────────────────────────────────────────────────────────
echo "[n8n-setup] Importing workflows..."
for f in "$PATCH_DIR"/*.json; do
  [ -f "$f" ] || continue
  echo "  $(basename "$f")"
  n8n import:workflow --input="$f" 2>&1 || echo "  WARN: import failed for $f"
done

# ── Publish (activate) all workflows ─────────────────────────────────────────
echo "[n8n-setup] Publishing workflows..."
for id in 1 2 3 4 5 6; do
  n8n publish:workflow --id=$id 2>&1 | grep -v "Error tracking\|older than 6"
done

# ── Seed Postgres credential with proper encryption ───────────────────────────
echo "[n8n-setup] Seeding postgres credential..."
"$NODE" - <<'JSEOF'
const sqlite3 = require(process.env.SQLITE3_MOD);
const crypto  = require('crypto');

const DB_FILE     = process.env.DB_FILE;
const dbHost      = process.env.DB_HOST     || 'postgres';
const dbPort      = parseInt(process.env.DB_PORT || '5432');
const dbName      = process.env.DB_NAME     || 'hr_automation';
const dbUser      = process.env.DB_USER     || 'hr_admin';
const dbPass      = process.env.DB_PASS     || 'hr_pass';

// Use the pinned encryption key from env (must match N8N_ENCRYPTION_KEY in docker-compose)
const rawKey = process.env.N8N_ENCRYPTION_KEY;
if (!rawKey) { console.error('[n8n-setup] N8N_ENCRYPTION_KEY not set'); process.exit(1); }

// n8n cipher: OpenSSL-compatible AES-256-CBC with "Salted__" magic + MD5 key derivation
// matches n8n-core/dist/encryption/cipher.js exactly
const SALTED = Buffer.from('53616c7465645f5f', 'hex'); // "Salted__"

function getKeyAndIv(encKey, salt) {
  const pass = Buffer.concat([Buffer.from(encKey, 'binary'), salt]);
  const h1 = crypto.createHash('md5').update(pass).digest();
  const h2 = crypto.createHash('md5').update(Buffer.concat([h1, pass])).digest();
  const iv = crypto.createHash('md5').update(Buffer.concat([h2, pass])).digest();
  return [Buffer.concat([h1, h2]), iv];
}

function encrypt(data) {
  const salt = crypto.randomBytes(8);
  const [key, iv] = getKeyAndIv(rawKey, salt);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const plain = JSON.stringify(data);
  return Buffer.concat([SALTED, salt, cipher.update(plain), cipher.final()]).toString('base64');
}

const credData = encrypt({
  host: dbHost, port: dbPort, database: dbName,
  user: dbUser, password: dbPass,
  ssl: 'disable', sshTunnel: false
});

const db  = new sqlite3.Database(DB_FILE);
const now = new Date().toISOString();

db.serialize(() => {
  // Upsert credential
  db.run(
    `INSERT INTO credentials_entity (id, name, data, type, createdAt, updatedAt, isGlobal)
     VALUES ('1', 'Postgres HR', ?, 'postgres', ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET data=excluded.data, isGlobal=1, updatedAt=excluded.updatedAt`,
    [credData, now, now],
    (e) => { if (e) console.error('[n8n-setup] Cred upsert error:', e.message); else console.log('[n8n-setup] Credential upserted.'); }
  );

  // Share with personal project
  db.get(`SELECT id FROM project WHERE type='personal' LIMIT 1`, [], (e, row) => {
    if (e || !row) { console.log('[n8n-setup] No project found, skipping share.'); return; }
    db.run(
      `INSERT OR IGNORE INTO shared_credentials (credentialsId, projectId, role, createdAt, updatedAt)
       VALUES ('1', ?, 'credential:owner', ?, ?)`,
      [row.id, now, now],
      (e2) => {
        if (e2) console.error('[n8n-setup] Share error:', e2.message);
        else console.log('[n8n-setup] Credential shared with project', row.id);
        db.close();
      }
    );
  });
});
JSEOF

# ── Start n8n ─────────────────────────────────────────────────────────────────
echo "[n8n-setup] Starting n8n..."
exec n8n start
