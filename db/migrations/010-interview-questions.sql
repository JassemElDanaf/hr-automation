-- Migration 010: Interview questions table for pre-generated questions
-- Stores questions generated via InterviewQuestionsModal so the Live Interview
-- page can load them without re-generating (falls back to AI generation if empty).

CREATE TABLE IF NOT EXISTS interview_questions (
  id SERIAL PRIMARY KEY,
  evaluation_id INTEGER REFERENCES evaluations(id) ON DELETE CASCADE,
  job_opening_id INTEGER REFERENCES job_openings(id) ON DELETE CASCADE,
  candidate_id INTEGER REFERENCES candidates(id) ON DELETE CASCADE,
  question_number INTEGER NOT NULL,
  category VARCHAR(50) DEFAULT 'hr',
  question TEXT NOT NULL,
  hints TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iq_evaluation_id ON interview_questions(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_iq_candidate_id ON interview_questions(candidate_id);
