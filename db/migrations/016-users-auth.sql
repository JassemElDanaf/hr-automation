-- Migration 016: application login + RBAC
-- Adds a users table (bcrypt-hashed passwords via pgcrypto) and an opaque
-- session-token table. Passwords are hashed by Postgres itself with
-- crypt()/gen_salt('bf', 12) — never stored or transmitted in plain text.
-- The initial admin is seeded by the auth sidecar on first run (so no password
-- ever lives in this committed file).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT,
  role          TEXT NOT NULL DEFAULT 'recruiter' CHECK (role IN ('admin', 'recruiter', 'viewer')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- Opaque random session tokens (UUID). A token is validated against this table
-- on every request to /auth/me — no client-side JWT to forge.
CREATE TABLE IF NOT EXISTS auth_sessions (
  token      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
