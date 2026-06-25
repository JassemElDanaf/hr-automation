import { apiPost } from './api';
import { COMPANY_NAME } from '../config/brand';

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// Wraps the (user-edited, verbatim) plain-text body in a branded HTML card so
// the email looks designed in the recipient's inbox instead of raw text.
// Short label-only lines (e.g. "Scores", "Recommendation", "Strengths") are
// rendered as bold section headings; everything else keeps its line breaks.
export function buildEmailHtml(body) {
  const esc = escapeHtml(body);
  const withHeadings = esc
    .split('\n')
    .map(line => {
      const t = line.trim();
      // A bare URL on its own line (e.g. the interview link) becomes a real
      // button instead of an ugly, line-wrapping raw URL in the inbox.
      if (/^https?:\/\/\S+$/.test(t)) {
        const label = /\/interview\//.test(t) ? 'Start Your Interview' : 'Open Link';
        return `<div style="margin:16px 0;"><a href="${t}" class="email-cta" style="display:inline-block;background:#1e40af;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;line-height:1;padding:14px 26px;border-radius:8px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${label} &rarr;</a></div>`;
      }
      const isHeading = t.length >= 2 && t.length <= 30 && /^[A-Za-z][A-Za-z /&-]*$/.test(t) && !/^(Hi|Hello|Dear)\b/i.test(t);
      return isHeading
        ? `<strong style="display:inline-block;margin-top:6px;color:#111827;">${t}</strong>`
        : line;
    })
    .join('\n');
  // Table-based, mobile-first layout. Critical for phones: the viewport meta
  // (without it mobile mail clients render at a fixed desktop width and zoom
  // out), a fluid width:100% + max-width container, and word-break so long URLs
  // (e.g. interview links) wrap instead of forcing horizontal scroll.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta http-equiv="x-ua-compatible" content="ie=edge">
<title>${COMPANY_NAME}</title>
<style>
  /* Mobile: card goes edge-to-edge, padding tightens, body text bumps up, and
     the CTA becomes a full-width tap target. Clients that strip <style> simply
     keep the inline styles below, so nothing breaks. */
  @media only screen and (max-width:480px) {
    .email-outer { padding:0 !important; }
    .email-card { border-radius:0 !important; border-left:0 !important; border-right:0 !important; }
    .email-header { padding:16px 18px !important; }
    .email-body { padding:18px 18px !important; font-size:16px !important; }
    .email-cta { display:block !important; text-align:center !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;">
    <tr>
      <td align="center" class="email-outer" style="padding:16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-card" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <tr>
            <td class="email-header" style="background:#1e40af;padding:18px 24px;">
              <div style="color:#ffffff;font-size:16px;font-weight:700;">${COMPANY_NAME}</div>
              <div style="color:#bfdbfe;font-size:12px;margin-top:2px;">Human Resources</div>
            </td>
          </tr>
          <tr>
            <td class="email-body" style="padding:24px;color:#1f2937;font-size:15px;line-height:1.7;white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;">${withHeadings}</td>
          </tr>
          <tr>
            <td style="padding:14px 24px;border-top:1px solid #f3f4f6;color:#9ca3af;font-size:11px;">Sent by Diyar HR</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body></html>`;
}

export async function sendEmailRequest({ candidateId, jobId, emailType, recipientEmail, candidateName, jobTitle, subject, body, attachments, recordingFile }) {
  const payload = {
    candidate_id: candidateId,
    job_opening_id: jobId,
    email_type: emailType,
    recipient_email: recipientEmail,
    candidate_name: candidateName,
    job_title: jobTitle,
    custom_subject: subject,
    custom_body: body,
  };
  // Small files (CV / generated PDF) travel base64 through n8n; the recording
  // goes by filename only — the SMTP sidecar reads it from recordings/ itself.
  if (Array.isArray(attachments) && attachments.length) payload.attachments = attachments;
  if (recordingFile) payload.recording_file = recordingFile;
  // Emails go out as plain text (cleaner, broadest device compatibility, and
  // already the multipart fallback). The ONE exception is the interview invite:
  // its link is a long (~500-char) URL-safe-base64 token that wraps badly / can
  // become unclickable as raw text, so that flow keeps the branded HTML version
  // (which renders the link as a "Start Your Interview" button).
  if (body && emailType === 'interview_invite') payload.html_body = buildEmailHtml(body);
  const res = await apiPost('/send-email', payload);
  return res;
}

export function getEmailStatus(res) {
  const status = res.data && res.data.status;
  if (status === 'sent') return { type: 'success', message: 'Email sent to ' + (res.data.recipient_email || '') };
  if (status === 'logged') return { type: 'error', message: 'Email not sent \u2014 SMTP not configured. Email was saved to log only.' };
  if (status === 'failed') return { type: 'error', message: 'Email failed to send: ' + (res.data.error || 'unknown error') };
  return { type: 'error', message: 'Email delivery uncertain \u2014 check Emails tab for status.' };
}

// ── Editable email templates ─────────────────────────────────────────────
// Built-in defaults (the baseline). Admins can override subject/body in the
// Email Templates settings page; overrides load from the DB into `_overrides`
// on app start. Bodies use {placeholder} tokens.
export const TEMPLATE_DEFS = {
  interview_invite: {
    name: 'Interview invitation',
    placeholders: ['candidate_name', 'job_title', 'interview_link'],
    subject: 'Interview Invitation — {job_title}',
    body: `Dear {candidate_name},\n\nCongratulations! After reviewing your application for the {job_title} role, we'd like to invite you to the next step: a short online interview you can complete in your own time.\n\nHow it works\nThe interview runs in your web browser and guides you through each question, one at a time. There's nothing to install and nothing to schedule — just open your personal link below whenever you're ready.\n\nYour interview link\n{interview_link}\n\nPlease try to complete it within the next few days. If the link doesn't open or you run into any trouble, simply reply to this email and we'll be glad to help.\n\nWe're looking forward to learning more about you.\n\nWarm regards,\nHR Department\n${COMPANY_NAME}`,
  },
  shortlist: {
    name: 'Shortlisted',
    placeholders: ['candidate_name', 'job_title'],
    subject: 'You have been shortlisted — {job_title}',
    body: `Dear {candidate_name},\n\nGreat news — you've been shortlisted for the {job_title} role.\n\nAfter reviewing your application, we were impressed by your background and would like to move you forward to the next stage of our hiring process.\n\nA member of our team will be in touch shortly with the next steps. In the meantime, thank you for your interest in joining us.\n\nWarm regards,\nHR Department\n${COMPANY_NAME}`,
  },
  rejection: {
    name: 'Rejection',
    placeholders: ['candidate_name', 'job_title'],
    subject: 'Application Update — {job_title}',
    body: `Dear {candidate_name},\n\nThank you for applying for the {job_title} role and for the time you put into your application.\n\nAfter careful consideration, we've decided to move forward with other candidates whose experience more closely matches what this position needs right now. This was not an easy decision, and it isn't a reflection of your abilities.\n\nWe'd genuinely welcome your application for future roles that fit your skills, and we wish you every success in your search.\n\nWarm regards,\nHR Department\n${COMPANY_NAME}`,
  },
  offer: {
    name: 'Job offer',
    placeholders: ['candidate_name', 'job_title'],
    subject: 'Job Offer — {job_title}',
    body: `Dear {candidate_name},\n\nWe're delighted to offer you the {job_title} position — congratulations!\n\nThe full details of your offer are attached. Please take the time to review them and let us know your decision within 5 business days. If you have any questions at all, just reply to this email and we'll be happy to help.\n\nWe're excited at the prospect of you joining the team and look forward to hearing from you.\n\nWarm regards,\nHR Department\n${COMPANY_NAME}`,
  },
  // ── Hiring-manager-facing templates ──────────────────────────────────────
  // These carry computed data blocks (scores, strengths, question lists,
  // meeting details) that can't be expressed as simple word substitutions, so
  // those blocks are pre-rendered into composite tokens by the get*Template()
  // functions below. The admin can move the tokens around and rewrite the prose
  // between them, but shouldn't edit inside a token's generated content.
  recommendation: {
    name: 'Recommendation to hiring manager',
    placeholders: ['candidate_name', 'job_title', 'role_label', 'candidate_line', 'evaluation_summary', 'strengths', 'areas_to_probe', 'notes'],
    subject: 'Candidate recommendation: {candidate_name} — {job_title}',
    body: `Hi,\n\nI'd like to recommend {candidate_name} for the {role_label} role. A quick summary of where they landed in our evaluation is below.\n\n{candidate_line}\n\nScores (out of 10)\n{evaluation_summary}\n\nStrengths\n{strengths}\n\nAreas to probe\n{areas_to_probe}\n\n{notes}Happy to talk through any of this. Let me know if you'd like to take them forward to an interview.\n\nBest regards,\nHR Department`,
  },
  interview_pack: {
    name: 'Interview pack to hiring manager',
    placeholders: ['candidate_name', 'job_title', 'candidate_ref', 'role_label', 'evaluation_summary', 'meeting_details', 'questions', 'general_notes'],
    subject: 'Interview pack: {candidate_name} — {job_title}',
    body: `Hi,\n\nI'm handing off {candidate_ref} for the {role_label} role. From here, scheduling, interviewing, and the offer are yours — everything I've prepared to make that easy is below.\n\n{evaluation_summary}{meeting_details}\n\nSuggested questions\n{questions}\n{general_notes}\nLet me know if you'd like anything adjusted before the interview.\n\nBest regards,\nHR Department`,
  },
};

let _templateOverrides = {}; // template_key -> { subject, body } (from DB)
export function setTemplateOverrides(obj) { _templateOverrides = obj || {}; }
export function effectiveTemplate(key) {
  const def = TEMPLATE_DEFS[key] || { subject: '', body: '' };
  const ov = _templateOverrides[key];
  return {
    subject: (ov && ov.subject != null) ? ov.subject : def.subject,
    body: (ov && ov.body != null) ? ov.body : def.body,
    isOverridden: !!ov,
  };
}
function fillTemplate(t, vars) {
  const sub = (s) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
  return { subject: sub(t.subject), body: sub(t.body) };
}

export function getRejectionTemplate(candidateName, jobTitle) {
  return fillTemplate(effectiveTemplate('rejection'), { candidate_name: candidateName, job_title: jobTitle });
}

export function getShortlistTemplate(candidateName, jobTitle) {
  return fillTemplate(effectiveTemplate('shortlist'), { candidate_name: candidateName, job_title: jobTitle });
}

export function getInterviewTemplate(candidateName, jobTitle, link) {
  // `link` is the AI self-interview link generated in the Interview tab; if HR
  // hasn't generated one yet, a clear placeholder is inserted (body is editable).
  return fillTemplate(effectiveTemplate('interview_invite'), {
    candidate_name: candidateName, job_title: jobTitle,
    interview_link: link ? link : '[PASTE INTERVIEW LINK HERE]',
  });
}

export function getOfferTemplate(candidateName, jobTitle) {
  return fillTemplate(effectiveTemplate('offer'), { candidate_name: candidateName, job_title: jobTitle });
}

export function getInterviewPackTemplate({ candidateName, candidateEmail, jobTitle, department, meeting, questions, generalNotes, evaluation }) {
  const m = meeting || {};
  const platform = (m.platform || '').trim();
  const when = m.datetime ? new Date(m.datetime).toLocaleString() : '';
  const link = (m.link || '').trim();
  const interviewers = (m.interviewers || '').trim();

  // Spell out how/where the interview happens, adapted to the chosen platform —
  // online platforms get a join link, In person gets a location, Phone gets a
  // number — so the hiring manager sees it at a glance.
  const ONLINE = ['Zoom', 'Microsoft Teams', 'Google Meet'];
  let conductedLine, detailLine = '';
  if (ONLINE.includes(platform)) {
    conductedLine = `This interview will be conducted online via ${platform}.`;
    detailLine = `Join link: ${link || '(to be shared)'}`;
  } else if (platform === 'In person') {
    conductedLine = 'This interview will be conducted in person.';
    detailLine = `Location: ${link || '(to be confirmed)'}`;
  } else if (platform === 'Phone') {
    conductedLine = 'This interview will be conducted by phone.';
    detailLine = `Phone number: ${link || '(to be shared)'}`;
  } else {
    conductedLine = 'Interview format to be confirmed.';
    if (link) detailLine = `Details: ${link}`;
  }
  const meetingLines = ['Meeting details', '  ' + conductedLine, '  Date / time: ' + (when || '(to be confirmed)')];
  if (detailLine) meetingLines.push('  ' + detailLine);
  if (interviewers) meetingLines.push('  Interviewer(s): ' + interviewers);
  const meeting_details = meetingLines.join('\n');

  const e = evaluation || {};
  const fmt = v => v != null ? Number(v).toFixed(1) : '\u2014';
  const fmtList = raw => {
    if (!raw) return '  \u2014 None noted';
    return raw.split(';').map(s => s.trim()).filter(Boolean).map(s => '  \u2022 ' + s).join('\n') || '  \u2014 None noted';
  };
  // Whole eval block is one composite token (it's optional \u2014 empty when the
  // candidate hasn't been scored, so the pack can carry meeting details alone).
  let evaluation_summary = '';
  if (e.overall_score != null) {
    evaluation_summary =
`Evaluation summary
  Overall:     ${fmt(e.overall_score)} / 10
  Skills:      ${fmt(e.skills_score)} / 10
  Experience:  ${fmt(e.experience_score)} / 10
  Education:   ${fmt(e.education_score)} / 10

Strengths
${fmtList(e.strengths)}

Areas to probe
${fmtList(e.weaknesses)}

`;
  }

  const questionsBlock = (Array.isArray(questions) && questions.length)
    ? questions.map((q, i) => {
        const cat = q.category ? '[' + q.category.toUpperCase() + '] ' : '';
        const hint = q.hints ? '\n   Hint: ' + q.hints : '';
        return `${i + 1}. ${cat}${q.question}${hint}`;
      }).join('\n\n')
    : '(No questions generated yet \u2014 pack only includes meeting details.)';
  const notesBlock = (generalNotes || '').trim();
  const general_notes = notesBlock ? 'General notes\n' + notesBlock + '\n' : '';
  const candidate_ref = candidateName + (candidateEmail ? ' <' + candidateEmail + '>' : '');
  const role_label = jobTitle + (department ? ' (' + department + ')' : '');

  return fillTemplate(effectiveTemplate('interview_pack'), {
    candidate_name: candidateName, job_title: jobTitle,
    candidate_ref, role_label, evaluation_summary, meeting_details,
    questions: questionsBlock, general_notes,
  });
}

export function getRecommendationTemplate({ candidateName, candidateEmail, jobTitle, department, evaluation }) {
  const e = evaluation || {};
  const fmt = v => v != null ? Number(v).toFixed(1) : '\u2014';
  const fmtList = (raw) => {
    if (!raw) return '  \u2014 None noted';
    return raw.split(';').map(s => s.trim()).filter(Boolean).map(s => '  \u2022 ' + s).join('\n') || '  \u2014 None noted';
  };
  const evaluation_summary =
`  Overall:     ${fmt(e.overall_score)} / 10
  Skills:      ${fmt(e.skills_score)} / 10
  Experience:  ${fmt(e.experience_score)} / 10
  Education:   ${fmt(e.education_score)} / 10`;
  const reasoning = (e.reasoning || '').trim();
  const role_label = jobTitle + (department ? ' (' + department + ')' : '');
  const candidate_line = `Candidate: ${candidateName}` + (candidateEmail ? ' <' + candidateEmail + '>' : '');

  return fillTemplate(effectiveTemplate('recommendation'), {
    candidate_name: candidateName, job_title: jobTitle, role_label, candidate_line,
    evaluation_summary, strengths: fmtList(e.strengths), areas_to_probe: fmtList(e.weaknesses),
    notes: reasoning ? 'Notes\n' + reasoning + '\n\n' : '',
  });
}
