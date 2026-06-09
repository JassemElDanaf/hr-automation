CREATE TABLE IF NOT EXISTS question_bank (
  id SERIAL PRIMARY KEY,
  question TEXT NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'hr',
  job_type VARCHAR(100) DEFAULT '',
  model_answer TEXT DEFAULT '',
  times_used INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);
