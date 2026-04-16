-- HR Automation Database Schema
-- Phase 1: Job Openings

CREATE TABLE IF NOT EXISTS job_openings (
    id                      SERIAL PRIMARY KEY,
    job_title               VARCHAR(255) NOT NULL,
    department              VARCHAR(255) NOT NULL,
    employment_type         VARCHAR(50)  NOT NULL CHECK (employment_type IN ('Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary')),
    seniority_level         VARCHAR(50)  NOT NULL CHECK (seniority_level IN ('Junior', 'Mid-level', 'Senior', 'Lead', 'Manager', 'Director', 'VP', 'C-level')),
    location_type           VARCHAR(50)  NOT NULL CHECK (location_type IN ('On-site', 'Remote', 'Hybrid')),
    reporting_to            VARCHAR(255),
    description_source_type VARCHAR(20)  NOT NULL CHECK (description_source_type IN ('ai_generated', 'manual', 'file_upload')),
    job_description         TEXT         NOT NULL,
    uploaded_file_name      VARCHAR(255),
    status                  VARCHAR(20)  NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed', 'on_hold')),
    is_active               BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_job_openings_active ON job_openings (is_active);
CREATE INDEX IF NOT EXISTS idx_job_openings_status ON job_openings (status);
CREATE INDEX IF NOT EXISTS idx_job_openings_department ON job_openings (department);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_job_openings_updated_at ON job_openings;
CREATE TRIGGER update_job_openings_updated_at
    BEFORE UPDATE ON job_openings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
