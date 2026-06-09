-- Migration 011: Interview sessions table
-- Stores completed live interview results (scores, transcript, evaluation).

CREATE TABLE IF NOT EXISTS interview_sessions (
  id SERIAL PRIMARY KEY,
  job_opening_id INTEGER REFERENCES job_openings(id) ON DELETE SET NULL,
  candidate_id INTEGER REFERENCES candidates(id) ON DELETE SET NULL,
  evaluation_id INTEGER REFERENCES evaluations(id) ON DELETE SET NULL,
  candidate_name VARCHAR(255),
  candidate_email VARCHAR(255),
  duration_seconds INTEGER DEFAULT 0,
  language VARCHAR(10) DEFAULT 'en',
  transcript JSONB DEFAULT '[]',
  qa_pairs JSONB DEFAULT '[]',
  score_communication NUMERIC(4,1),
  score_technical NUMERIC(4,1),
  score_confidence NUMERIC(4,1),
  score_culture_fit NUMERIC(4,1),
  score_overall NUMERIC(4,1),
  summary TEXT,
  recommendation TEXT,
  per_question JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_is_candidate_id ON interview_sessions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_is_job_opening_id ON interview_sessions(job_opening_id);
