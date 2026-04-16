-- Phase 4: Email Notification Log
CREATE TABLE IF NOT EXISTS email_log (
    id              SERIAL PRIMARY KEY,
    candidate_id    INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    job_opening_id  INTEGER NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
    email_type      VARCHAR(30) NOT NULL CHECK (email_type IN ('rejection', 'interview_invite', 'offer', 'custom')),
    recipient_email VARCHAR(255) NOT NULL,
    subject         TEXT NOT NULL,
    body            TEXT NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'pending')),
    sent_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_log_candidate ON email_log (candidate_id);
CREATE INDEX IF NOT EXISTS idx_email_log_job ON email_log (job_opening_id);
