-- Allow `recommendation` as an email_type so HR can email a hiring manager
-- with the recommendation/evaluation summary for a candidate.

ALTER TABLE email_log DROP CONSTRAINT IF EXISTS email_log_email_type_check;
ALTER TABLE email_log ADD CONSTRAINT email_log_email_type_check
    CHECK (email_type IN ('rejection', 'interview_invite', 'offer', 'custom', 'recommendation'));
