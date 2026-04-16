-- Phase 2 Enhancement: Criteria Sets
CREATE TABLE IF NOT EXISTS criteria_sets (
    id                SERIAL PRIMARY KEY,
    name              VARCHAR(255) NOT NULL,
    job_opening_id    INTEGER REFERENCES job_openings(id) ON DELETE SET NULL,
    criteria_text     TEXT NOT NULL,
    skills_weight     INTEGER NOT NULL DEFAULT 40 CHECK (skills_weight >= 0 AND skills_weight <= 100),
    experience_weight INTEGER NOT NULL DEFAULT 35 CHECK (experience_weight >= 0 AND experience_weight <= 100),
    education_weight  INTEGER NOT NULL DEFAULT 25 CHECK (education_weight >= 0 AND education_weight <= 100),
    created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_criteria_sets_job ON criteria_sets (job_opening_id);
