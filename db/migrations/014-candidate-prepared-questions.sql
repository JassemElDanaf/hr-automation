-- Stores interview questions prepared for a specific candidate+job pair via InterviewQuestionsModal.
-- Enables questions to follow the candidate across the app (Shortlist → Live Interview → AI interview link).
CREATE TABLE IF NOT EXISTS candidate_prepared_questions (
  id              SERIAL PRIMARY KEY,
  candidate_id    INTEGER NOT NULL,
  job_opening_id  INTEGER NOT NULL,
  questions       JSONB   NOT NULL DEFAULT '[]',
  notes           JSONB   NOT NULL DEFAULT '[]',
  general_notes   TEXT    NOT NULL DEFAULT '',
  meeting         JSONB   NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(candidate_id, job_opening_id)
);

CREATE INDEX IF NOT EXISTS idx_cpq_candidate ON candidate_prepared_questions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_cpq_job      ON candidate_prepared_questions(job_opening_id);
