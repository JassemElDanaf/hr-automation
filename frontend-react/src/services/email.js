import { apiPost } from './api';

export async function sendEmailRequest({ candidateId, jobId, emailType, recipientEmail, candidateName, jobTitle, subject, body }) {
  const res = await apiPost('/send-email', {
    candidate_id: candidateId,
    job_opening_id: jobId,
    email_type: emailType,
    recipient_email: recipientEmail,
    candidate_name: candidateName,
    job_title: jobTitle,
    custom_subject: subject,
    custom_body: body,
  });
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
