-- Phase 2 Enhancement: Per-item criteria with required flag + weight
-- HR can now mark individual criteria items as required vs optional and set
-- per-item weight. Backward compatible — criteria_text still used as fallback.
ALTER TABLE criteria_sets
    ADD COLUMN IF NOT EXISTS criteria_items JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN criteria_sets.criteria_items IS
    'Optional structured criteria: [{"text":"string","required":bool,"weight":int}]. Empty array means use criteria_text only.';
