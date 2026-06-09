export function nameFromFilename(filename) {
  let name = filename.replace(/\.[^.]+$/, '');
  name = name.replace(/[-_\.]+/g, ' ');
  name = name.replace(/([a-z])([A-Z])/g, '$1 $2');
  name = name.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  name = name.replace(/^(cv|resume|résumé|curriculum\s*vitae)\s+/i, '');
  // Strip trailing junk: cv, resume, numbers (any length), version markers, dates
  name = name.replace(/\s+(cv|resume|résumé|curriculum\s*vitae|II|III|IV|v\d+|final|updated|new|copy|\d+|\(\d+\)|\d{4}[-]\d{2}[-]\d{2})$/gi, '');
  // Repeat once in case of stacked suffixes like "cv 25" → strip "25" then "cv"
  name = name.replace(/\s+(cv|resume|résumé|\d+)$/gi, '');
  name = name.replace(/\s+/g, ' ').trim();
  if (!name) return '';
  return name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

// Extract candidate's real name from CV text — looks at the first few lines for a
// 2–4 word all-alpha sequence that doesn't look like a section header or contact info.
export function extractNameFromCV(text) {
  if (!text) return '';
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 8)) {
    if (/^[+\d(]/.test(line)) continue;          // phone number
    if (/@/.test(line)) continue;                  // email
    if (/^https?:/i.test(line)) continue;          // URL
    if (/linkedin|github|twitter/i.test(line)) continue;
    if (/EDUCATION|EXPERIENCE|SKILLS|SUMMARY|OBJECTIVE|PROFILE|EMPLOYMENT|CERTIF/i.test(line)) continue;
    const words = line.split(/\s+/).filter(w => /^[a-zA-Z'-]{2,}$/.test(w));
    if (words.length >= 2 && words.length <= 5 && line.length <= 60) {
      return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
  }
  return '';
}

export function extractEmail(text) {
  const match = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : '';
}

export function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(dateStr) {
  return new Date(dateStr).toLocaleString();
}

export function relativeTime(dateStr) {
  const s = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

export function scoreClass(score) {
  const s = parseFloat(score);
  if (s >= 7) return 'score-high';
  if (s >= 4) return 'score-mid';
  return 'score-low';
}

// User-facing label for an `email_log.email_type` value. Centralized so the
// Shortlist banner, Emails table, and detail panels all stay in sync — the
// 'recommendation' backend type is presented as 'Handed off to HM' everywhere.
export function emailTypeLabel(type) {
  switch (type) {
    case 'recommendation': return 'Handed off to HM';
    case 'interview_invite': return 'Interview invite';
    case 'rejection': return 'Rejection';
    case 'offer': return 'Job offer';
    case 'custom': return 'Shortlist email';
    default: return type ? type.replace(/_/g, ' ') : 'Email';
  }
}

export function scoreLabel(score) {
  const s = parseFloat(score);
  if (s >= 8) return 'Excellent';
  if (s >= 6) return 'Good';
  if (s >= 4) return 'Average';
  if (s >= 2) return 'Below Average';
  return 'Poor';
}
