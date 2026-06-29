-- Add unique constraint so ON CONFLICT (candidate_id, job_opening_id) in the
-- save-transcript workflow works correctly. Without this constraint, n8n's
-- Postgres node crashes on the INSERT and silently returns an empty 200.
ALTER TABLE interview_sessions
  ADD CONSTRAINT uq_interview_sessions_cand_job UNIQUE (candidate_id, job_opening_id);
