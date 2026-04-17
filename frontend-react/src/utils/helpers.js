export function nameFromFilename(filename) {
  let name = filename.replace(/\.[^.]+$/, '');
  name = name.replace(/[-_\.]+/g, ' ');
  name = name.replace(/([a-z])([A-Z])/g, '$1 $2');
  name = name.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  name = name.replace(/^(cv|resume|résumé|curriculum\s*vitae)\s+/i, '');
  name = name.replace(/\s+(cv|resume|résumé|curriculum\s*vitae|II|III|IV|v\d+|final|updated|new|copy|\d{4}|\(\d+\))$/gi, '');
  name = name.replace(/\s+/g, ' ').trim();
  if (!name) return '';
  return name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
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

export function scoreLabel(score) {
  const s = parseFloat(score);
  if (s >= 8) return 'Excellent';
  if (s >= 6) return 'Good';
  if (s >= 4) return 'Average';
  if (s >= 2) return 'Below Average';
  return 'Poor';
}
