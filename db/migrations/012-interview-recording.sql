-- Migration 012: Add recording_path and requirements_match to interview_sessions
ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS recording_path TEXT DEFAULT '';
ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS requirements_match JSONB DEFAULT '[]'::jsonb;
