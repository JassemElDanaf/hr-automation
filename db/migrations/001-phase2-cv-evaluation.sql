-- Phase 2: CV Evaluation Pipeline
-- Run after Phase 1 schema is in place

CREATE TABLE IF NOT EXISTS candidates (
    id              SERIAL PRIMARY KEY,
    job_opening_id  INTEGER NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
    candidate_name  VARCHAR(255) NOT NULL,
    email           VARCHAR(255),
    cv_text         TEXT NOT NULL,
    cv_file_name    VARCHAR(255),
    submitted_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS evaluations (
    id                SERIAL PRIMARY KEY,
    candidate_id      INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    job_opening_id    INTEGER NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
    overall_score     DECIMAL(3,1) NOT NULL CHECK (overall_score >= 0 AND overall_score <= 10),
    skills_score      DECIMAL(3,1) CHECK (skills_score >= 0 AND skills_score <= 10),
    experience_score  DECIMAL(3,1) CHECK (experience_score >= 0 AND experience_score <= 10),
    education_score   DECIMAL(3,1) CHECK (education_score >= 0 AND education_score <= 10),
    reasoning         TEXT,
    strengths         TEXT,
    weaknesses        TEXT,
    evaluated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(candidate_id, job_opening_id)
);

CREATE INDEX IF NOT EXISTS idx_candidates_job ON candidates (job_opening_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_job ON evaluations (job_opening_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_candidate ON evaluations (candidate_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_score ON evaluations (overall_score DESC);
