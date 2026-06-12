import { apiPost } from './api';

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
      const isHeading = t.length >= 2 && t.length <= 30 && /^[A-Za-z][A-Za-z /&-]*$/.test(t) && !/^(Hi|Hello|Dear)\b/i.test(t);
      return isHeading
        ? `<strong style="display:inline-block;margin-top:6px;color:#111827;">${t}</strong>`
        : line;
    })
    .join('\n');
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f4f6;">
  <div style="max-width:640px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="background:#1e40af;padding:18px 28px;">
      <div style="color:#ffffff;font-size:16px;font-weight:700;">Diyar United Company</div>
      <div style="color:#bfdbfe;font-size:12px;margin-top:2px;">Human Resources</div>
    </div>
    <div style="padding:26px 28px;color:#1f2937;font-size:14px;line-height:1.75;white-space:pre-wrap;">${withHeadings}</div>
    <div style="padding:14px 28px;border-top:1px solid #f3f4f6;color:#9ca3af;font-size:11px;">Sent by Diyar HR Automation</div>
  </div>
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
  // Every send also carries a styled HTML version of the same text (the
  // recipient sees the branded card; plain text is logged + used as fallback).
  if (body) payload.html_body = buildEmailHtml(body);
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

export function getRejectionTemplate(candidateName, jobTitle) {
  return {
    subject: 'Application Update - ' + jobTitle,
    body: `Dear ${candidateName},\n\nThank you for your interest in the ${jobTitle} position and for taking the time to apply.\n\nAfter careful review of all applications, we regret to inform you that we have decided to move forward with other candidates whose qualifications more closely match our current requirements.\n\nWe appreciate your interest in our organization and encourage you to apply for future openings that match your skills and experience.\n\nWe wish you all the best in your job search and future endeavors.\n\nBest regards,\nHR Department`,
  };
}

export function getShortlistTemplate(candidateName, jobTitle) {
  return {
    subject: 'You have been shortlisted — ' + jobTitle,
    body: `Dear ${candidateName},\n\nGreat news! After reviewing your application for the ${jobTitle} position, we are pleased to inform you that you have been shortlisted for the next stage of our hiring process.\n\nWe were impressed by your background and would like to move forward with your candidacy. A member of our team will be in touch shortly with next steps.\n\nThank you for your interest in joining our team.\n\nBest regards,\nHR Department`,
  };
}

export function getInterviewTemplate(candidateName, jobTitle) {
  return {
    subject: 'Interview Invitation - ' + jobTitle,
    body: `Dear ${candidateName},\n\nWe are pleased to inform you that after reviewing your application for the ${jobTitle} position, we would like to invite you for an interview.\n\nPlease reply to this email with your availability for the coming week, and we will schedule a convenient time.\n\nWe look forward to speaking with you.\n\nBest regards,\nHR Department`,
  };
}

export function getOfferTemplate(candidateName, jobTitle) {
  return {
    subject: 'Job Offer - ' + jobTitle,
    body: `Dear ${candidateName},\n\nWe are delighted to extend an offer for the ${jobTitle} position.\n\nPlease find the details of the offer attached. We kindly ask you to review and respond within 5 business days.\n\nCongratulations, and we look forward to welcoming you to our team!\n\nBest regards,\nHR Department`,
  };
}

export function getCandidateHandoffTemplate({ candidateName, candidateEmail, jobTitle, department, evaluation, status }) {
  const e = evaluation || {};
  const overall = e.overall_score != null ? Number(e.overall_score).toFixed(1) : '\u2014';
  const skills = e.skills_score != null ? Number(e.skills_score).toFixed(1) : '\u2014';
  const experience = e.experience_score != null ? Number(e.experience_score).toFixed(1) : '\u2014';
  const education = e.education_score != null ? Number(e.education_score).toFixed(1) : '\u2014';
  const fmtList = (raw) => {
    if (!raw) return '  \u2014 None noted';
    return raw.split(';').map(s => s.trim()).filter(Boolean).map(s => '  \u2022 ' + s).join('\n') || '  \u2014 None noted';
  };
  const strengths = fmtList(e.strengths);
  const weaknesses = fmtList(e.weaknesses);
  const reasoning = (e.reasoning || '').trim();
  const stageLabel = status === 'interviewed' ? 'interviewed' : 'shortlisted';
  const subject = `Handing off ${candidateName} \u2014 ${jobTitle}`;
  const body =
`Hi,

${candidateName} has been ${stageLabel} for the ${jobTitle}${department ? ' (' + department + ')' : ''} role and I'm handing the rest of the process over to you.

Candidate
  Name:   ${candidateName}
  Email:  ${candidateEmail || '\u2014'}

Evaluation summary
  Overall:     ${overall} / 10
  Skills:      ${skills} / 10
  Experience:  ${experience} / 10
  Education:   ${education} / 10

Strengths
${strengths}

Areas to probe
${weaknesses}

${reasoning ? 'Notes\n' + reasoning + '\n\n' : ''}From here you own scheduling the interview, sending the offer, and updating the status. Let me know if you need anything from HR.

Best regards,
HR Department`;
  return { subject, body };
}

export function getInterviewPackTemplate({ candidateName, candidateEmail, jobTitle, department, meeting, questions, generalNotes, evaluation }) {
  const m = meeting || {};
  const platformLabel = m.platform || 'Not specified';
  const when = m.datetime ? new Date(m.datetime).toLocaleString() : 'TBD';
  const link = (m.link || '').trim();
  const interviewers = (m.interviewers || '').trim();
  const meetingBlock =
`Meeting details
  Platform:     ${platformLabel}
  Date / time:  ${when}${link ? '\n  Link / room:  ' + link : ''}${interviewers ? '\n  Interviewer(s): ' + interviewers : ''}`;

  const e = evaluation || {};
  const hasEval = e.overall_score != null;
  let evalBlock = '';
  if (hasEval) {
    const fmt = v => v != null ? Number(v).toFixed(1) : '\u2014';
    const fmtList = raw => {
      if (!raw) return '  \u2014 None noted';
      return raw.split(';').map(s => s.trim()).filter(Boolean).map(s => '  \u2022 ' + s).join('\n') || '  \u2014 None noted';
    };
    evalBlock =
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

  const qBlock = (Array.isArray(questions) && questions.length)
    ? questions.map((q, i) => {
        const cat = q.category ? '[' + q.category.toUpperCase() + '] ' : '';
        const hint = q.hints ? '\n   Hint: ' + q.hints : '';
        return `${i + 1}. ${cat}${q.question}${hint}`;
      }).join('\n\n')
    : '(No questions generated yet \u2014 pack only includes meeting details.)';
  const notesBlock = (generalNotes || '').trim();
  const subject = `Interview pack: ${candidateName} \u2014 ${jobTitle}`;
  const body =
`Hi,

Handing off ${candidateName}${candidateEmail ? ' <' + candidateEmail + '>' : ''} for the ${jobTitle}${department ? ' (' + department + ')' : ''} role. From here you own scheduling, interviewing, and the offer \u2014 below is everything I prepared.

${evalBlock}${meetingBlock}

Suggested questions
${qBlock}
${notesBlock ? '\nGeneral notes\n' + notesBlock + '\n' : ''}
Let me know if you'd like anything adjusted before the interview.

Best regards,
HR Department`;
  return { subject, body };
}

export function getRecommendationTemplate({ candidateName, candidateEmail, jobTitle, department, evaluation }) {
  const e = evaluation || {};
  const overall = e.overall_score != null ? Number(e.overall_score).toFixed(1) : '\u2014';
  const skills = e.skills_score != null ? Number(e.skills_score).toFixed(1) : '\u2014';
  const experience = e.experience_score != null ? Number(e.experience_score).toFixed(1) : '\u2014';
  const education = e.education_score != null ? Number(e.education_score).toFixed(1) : '\u2014';
  const fmtList = (raw) => {
    if (!raw) return '  \u2014 None noted';
    return raw.split(';').map(s => s.trim()).filter(Boolean).map(s => '  \u2022 ' + s).join('\n') || '  \u2014 None noted';
  };
  const strengths = fmtList(e.strengths);
  const weaknesses = fmtList(e.weaknesses);
  const reasoning = (e.reasoning || '').trim();
  const subject = `Candidate recommendation: ${candidateName} \u2014 ${jobTitle}`;
  const body =
`Hi,

I'd like to share a candidate recommendation for the ${jobTitle}${department ? ' (' + department + ')' : ''} role.

Candidate: ${candidateName}${candidateEmail ? ' <' + candidateEmail + '>' : ''}

Evaluation summary
  Overall:     ${overall} / 10
  Skills:      ${skills} / 10
  Experience:  ${experience} / 10
  Education:   ${education} / 10

Strengths
${strengths}

Areas to probe
${weaknesses}

${reasoning ? 'Notes\n' + reasoning + '\n\n' : ''}Happy to discuss next steps \u2014 let me know if you'd like to move forward with an interview.

Best regards,
HR Department`;
  return { subject, body };
}
