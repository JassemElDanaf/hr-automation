-- Phase 4 Enhancement: Real SMTP sending
-- Add error_message for failed sends, widen status to include 'logged' (SMTP not configured)

ALTER TABLE email_log ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Replace the status check to include new values
ALTER TABLE email_log DROP CONSTRAINT IF EXISTS email_log_status_check;
ALTER TABLE email_log ADD CONSTRAINT email_log_status_check
    CHECK (status IN ('sent', 'failed', 'pending', 'logged'));
