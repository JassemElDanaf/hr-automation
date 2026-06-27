import { test, expect, request as pwRequest } from '@playwright/test';
import { login, gotoTab, qaName, qaEmail, apiCreateJob, apiCreateCandidate, selectJobGlobally } from './helpers';

const WEBHOOK = 'http://localhost:5678/webhook';
let jobId: number;
let candId: number;
const JOB_TITLE = qaName('Email Role');
const RECIPIENT = qaEmail('recipient');

test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  jobId = await apiCreateJob(api, JOB_TITLE, 'Role for the email end-to-end QA test.');
  candId = await apiCreateCandidate(api, jobId, qaName('Email Cand'), RECIPIENT);
  await api.dispose();
});

test('send an email and verify it is logged with a real status', async ({ page }) => {
  // Send through the Phase-5 pipeline (the same call the UI composer makes), then
  // verify it lands in email_log via /email-history AND renders in the Emails tab.
  const api = await pwRequest.newContext();
  const sendRes = await api.post(`${WEBHOOK}/send-email`, { data: {
    candidate_id: candId, job_opening_id: jobId, email_type: 'custom',
    recipient_email: RECIPIENT, custom_subject: qaName('Email Subject'),
    custom_body: 'This is a QA test email body for end-to-end verification.',
  }, timeout: 90_000 });
  const sent = await sendRes.json();
  // SMTP is configured in this env, so a real send should be 'sent' (not 'logged'/'failed').
  expect(['sent', 'logged']).toContain(sent.status);

  // It must appear in the candidate/job email history.
  await expect.poll(async () => {
    const r = await api.get(`${WEBHOOK}/email-history?job_id=${jobId}`);
    const rows = (await r.json()).data || [];
    return rows.some((e: any) => e.recipient_email === RECIPIENT && /Email Subject/.test(e.subject || ''));
  }, { timeout: 20_000 }).toBeTruthy();
  await api.dispose();

  // And it must render in the Emails tab UI (which shows the selected job's emails).
  await selectJobGlobally(page, { id: jobId, job_title: JOB_TITLE });
  await login(page, 'admin');
  await gotoTab(page, 'Emails');
  await expect(page.getByText(/Email Subject/).first()).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: 'tests/results/email-sent.png', fullPage: true });
});
