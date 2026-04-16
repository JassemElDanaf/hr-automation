-- Phase 3: Shortlist & Interview Tracking
CREATE TABLE IF NOT EXISTS shortlist (
    id              SERIAL PRIMARY KEY,
    candidate_id    INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    job_opening_id  INTEGER NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
    status          VARCHAR(20) NOT NULL DEFAULT 'shortlisted'
                    CHECK (status IN ('shortlisted', 'interviewed', 'hired', 'rejected')),
    notes           TEXT,
    shortlisted_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(candidate_id, job_opening_id)
);

CREATE INDEX IF NOT EXISTS idx_shortlist_job ON shortlist (job_opening_id);
CREATE INDEX IF NOT EXISTS idx_shortlist_status ON shortlist (status);
