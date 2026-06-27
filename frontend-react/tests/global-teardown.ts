import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

// Delete every QA-labelled row from the production DB after the suite finishes.
// We run against production (no test DB — n8n can't route per-request), so all
// test rows are tagged "(TEST)" / qa.*@example.com and removed here by label.
// Order respects FKs (children first). Container = hr-automation-postgres-1.
const PG = 'hr-automation-postgres-1';
const DB = 'hr_automation';
const USER = 'hr_admin';

const SQL = `
DO $$
DECLARE job_ids int[];
BEGIN
  SELECT array_agg(id) INTO job_ids FROM job_openings WHERE job_title LIKE 'QA %(TEST)';
  -- children of candidates/jobs first
  DELETE FROM interview_sessions       WHERE candidate_name LIKE 'QA %' OR candidate_email LIKE 'qa.%@example.com' OR job_opening_id = ANY(job_ids);
  DELETE FROM candidate_prepared_questions WHERE job_opening_id = ANY(job_ids);
  DELETE FROM email_log                WHERE recipient_email LIKE 'qa.%@example.com' OR job_opening_id = ANY(job_ids);
  DELETE FROM evaluations              WHERE job_opening_id = ANY(job_ids) OR candidate_id IN (SELECT id FROM candidates WHERE email LIKE 'qa.%@example.com');
  DELETE FROM shortlist                WHERE job_opening_id = ANY(job_ids) OR candidate_id IN (SELECT id FROM candidates WHERE email LIKE 'qa.%@example.com');
  DELETE FROM candidates               WHERE email LIKE 'qa.%@example.com' OR job_opening_id = ANY(job_ids) OR candidate_name LIKE 'QA %';
  DELETE FROM criteria_sets            WHERE job_opening_id = ANY(job_ids) OR name LIKE 'QA %(TEST)';
  DELETE FROM question_bank            WHERE question LIKE 'QA %' OR category = 'qa-test';
  DELETE FROM job_openings             WHERE id = ANY(job_ids);
END $$;
`;

export default async function globalTeardown() {
  if (process.env.KEEP_QA) { console.log('[teardown] KEEP_QA set — skipping cleanup'); return; }
  try {
    const { stdout } = await run('docker', ['exec', '-i', PG, 'psql', '-U', USER, '-d', DB, '-c', SQL]);
    console.log('[teardown] QA data cleaned:', stdout.trim());
  } catch (e: any) {
    console.warn('[teardown] cleanup failed (clean manually):', e?.message || e);
  }
}
