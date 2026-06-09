-- Store the raw uploaded CV file (base64) so HR can view it as PDF after evaluation.
-- Extracted text stays in cv_text; file_data/file_mime are optional for the original file.
ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS cv_file_data TEXT,
    ADD COLUMN IF NOT EXISTS cv_file_mime VARCHAR(100);

COMMENT ON COLUMN candidates.cv_file_data IS 'Base64-encoded original file (PDF/TXT) for viewing. NULL for legacy rows.';
COMMENT ON COLUMN candidates.cv_file_mime IS 'MIME type, e.g. application/pdf, text/plain.';
