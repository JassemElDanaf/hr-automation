-- 017: editable email templates + audit log (served by the auth sidecar, port 8904)

-- Overrides for the candidate-facing email templates. The frontend ships the
-- defaults (services/email.js); this table only stores admin edits. A key absent
-- here = use the built-in default. Bodies use {placeholder} tokens.
CREATE TABLE IF NOT EXISTS email_templates (
    template_key  TEXT PRIMARY KEY,
    subject       TEXT NOT NULL,
    body          TEXT NOT NULL,
    updated_at    TIMESTAMPTZ DEFAULT now(),
    updated_by    TEXT
);

-- Who did what, when. Written by the frontend at the apiPost chokepoint + key
-- auth/admin actions; viewable by admins only.
CREATE TABLE IF NOT EXISTS audit_log (
    id           BIGSERIAL PRIMARY KEY,
    user_id      INTEGER,
    user_email   TEXT,
    action       TEXT NOT NULL,
    entity_type  TEXT,
    entity_id    TEXT,
    detail       JSONB,
    created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);
