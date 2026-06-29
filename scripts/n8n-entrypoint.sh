#!/bin/sh
# n8n startup entrypoint — patch + import + publish workflows, seed credential, then run.
# Gemini branch: no Ollama host detection needed — AI calls go to Gemini API.
set -e

SIDECAR="${SIDECAR_DOCKER_HOST:-sidecars}"
export DB_FILE="/home/node/.n8n/database.sqlite"
NODE=$(find /opt/nodejs -name node -type f 2>/dev/null | head -1)
export SQLITE3_MOD="/usr/local/lib/node_modules/n8n/node_modules/.pnpm/sqlite3@5.1.7/node_modules/sqlite3"

# ── Sync config file encryption key with N8N_ENCRYPTION_KEY env var ──────────
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

COMPANY_NAME="${COMPANY_NAME:-Diyar United Company}"
COMPANY_NAME_SED=$(printf '%s' "$COMPANY_NAME" | sed -e 's/[&|\\]/\\&/g')

find /workflows -name '*.json' -type f | while IFS= read -r f; do
  dir_name=$(basename "$(dirname "$f")")
  base_name=$(basename "$f")
  out="$PATCH_DIR/${dir_name}__${base_name}"
  sed \
    -e "s|http://127.0.0.1:8901|http://${SIDECAR}:8901|g" \
    -e "s|http://127.0.0.1:8902|http://${SIDECAR}:8902|g" \
    -e "s|http://127.0.0.1:8903|http://${SIDECAR}:8903|g" \
    -e "s|http://127.0.0.1:8904|http://${SIDECAR}:8904|g" \
    -e "s|Diyar United Company|${COMPANY_NAME_SED}|g" \
    "$f" > "$out"
done

# ── Import workflows (sorted; retry any that fail on first pass) ───────────────
echo "[n8n-setup] Importing workflows..."
FAILED=""
for f in $(ls "$PATCH_DIR"/*.json | sort); do
  [ -f "$f" ] || continue
  echo "  $(basename "$f")"
  if ! n8n import:workflow --input="$f" 2>&1; then
    echo "  WARN: import failed for $f (will retry)"
    FAILED="$FAILED $f"
  fi
done
# Retry pass — some workflows fail on cold start due to n8n validation quirks
if [ -n "$FAILED" ]; then
  echo "[n8n-setup] Retrying failed imports..."
  for f in $FAILED; do
    echo "  $(basename "$f")"
    n8n import:workflow --input="$f" 2>&1 || echo "  WARN: retry failed for $f"
  done
fi

# ── Publish (activate) all workflows ─────────────────────────────────────────
echo "[n8n-setup] Publishing workflows..."
for id in 1 2 3 4 5 6 7; do
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

const rawKey = process.env.N8N_ENCRYPTION_KEY;
if (!rawKey) { console.error('[n8n-setup] N8N_ENCRYPTION_KEY not set'); process.exit(1); }

const SALTED = Buffer.from('53616c7465645f5f', 'hex');

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
  db.run(
    `INSERT INTO credentials_entity (id, name, data, type, createdAt, updatedAt, isGlobal)
     VALUES ('1', 'Postgres HR', ?, 'postgres', ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET data=excluded.data, isGlobal=1, updatedAt=excluded.updatedAt`,
    [credData, now, now],
    (e) => { if (e) console.error('[n8n-setup] Cred upsert error:', e.message); else console.log('[n8n-setup] Credential upserted.'); }
  );

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
