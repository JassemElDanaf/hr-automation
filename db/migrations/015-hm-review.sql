-- Hiring Manager review (post-interview): HR logs the manager's final-interview
-- verdict + notes against the shortlist row. Additive, nullable.
ALTER TABLE shortlist ADD COLUMN IF NOT EXISTS hm_verdict VARCHAR(20);   -- 'hire' | 'hold' | 'reject'
ALTER TABLE shortlist ADD COLUMN IF NOT EXISTS hm_notes TEXT;
ALTER TABLE shortlist ADD COLUMN IF NOT EXISTS hm_reviewed_at TIMESTAMP;
