import { jsPDF } from 'jspdf';

// Builds the AI-interview summary report as a PDF and returns base64 (no data: prefix).
// Layout is a simple y-cursor flow with automatic page breaks.
export function buildInterviewReportPdf({ session, qaPairs, perQuestion, requirements, jobTitle }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, MARGIN = 18, MAXW = W - MARGIN * 2;
  let y = 20;

  const ensure = (h) => { if (y + h > 280) { doc.addPage(); y = 20; } };
  const text = (str, size, opts = {}) => {
    doc.setFontSize(size);
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    if (opts.color) doc.setTextColor(...opts.color); else doc.setTextColor(30, 30, 30);
    const lines = doc.splitTextToSize(String(str || ''), opts.width || MAXW);
    ensure(lines.length * size * 0.45 + 2);
    doc.text(lines, opts.x || MARGIN, y);
    y += lines.length * size * 0.45 + (opts.gap ?? 2);
  };

  const fmt = (v) => { const n = parseFloat(v); return isNaN(n) ? '-' : n.toFixed(1); };

  // Header
  text('AI Interview Report', 18, { bold: true, color: [30, 64, 175] });
  text(`${session.candidateName || session.candidateEmail || 'Candidate'} — ${jobTitle || ''}`, 12, { bold: true });
  const when = session.completedAt ? new Date(session.completedAt).toLocaleString() : '';
  const mins = session.durationSeconds ? `${Math.round(session.durationSeconds / 60)} min` : '';
  text([when, mins, `${(qaPairs || []).length} questions`].filter(Boolean).join('  ·  '), 10, { color: [110, 110, 110], gap: 6 });

  // Scores
  text('Scores', 13, { bold: true, gap: 3 });
  const rows = [
    ['Communication', session.scoreComm], ['Technical', session.scoreTech],
    ['Confidence', session.scoreConf], ['Culture Fit', session.scoreCulture],
    ['Overall', session.scoreOverall],
  ];
  rows.forEach(([label, score]) => {
    doc.setFontSize(11);
    doc.setFont('helvetica', label === 'Overall' ? 'bold' : 'normal');
    ensure(7);
    doc.setTextColor(60, 60, 60);
    doc.text(label, MARGIN, y);
    doc.text(`${fmt(score)} / 10`, MARGIN + 60, y);
    y += 6;
  });
  y += 4;

  if (session.summary) {
    text('AI Summary', 13, { bold: true, gap: 3 });
    text(session.summary, 11, { gap: 5 });
  }
  if (session.recommendation) {
    text('Recommendation', 13, { bold: true, gap: 3 });
    text(session.recommendation, 11, { gap: 5 });
  }

  if (Array.isArray(requirements) && requirements.length) {
    text('Requirements Check', 13, { bold: true, gap: 3 });
    requirements.forEach((r) => {
      text(`${r.met ? '[MET]' : '[NOT MET]'} ${r.category || ''}: ${r.requirement || ''}`, 11, {
        bold: true, color: r.met ? [22, 101, 52] : [153, 27, 27], gap: 1,
      });
      if (r.extracted) text(`Candidate stated: ${r.extracted}`, 10, { color: [90, 90, 90], gap: 3 });
    });
    y += 3;
  }

  if (Array.isArray(qaPairs) && qaPairs.length) {
    text('Interview Transcript', 13, { bold: true, gap: 4 });
    qaPairs.forEach((p, i) => {
      const pq = (perQuestion || []).find(x => x.index === i + 1) || (perQuestion || [])[i] || {};
      text(`Q${i + 1}. ${p.question || ''}${pq.score != null ? `   (${pq.score}/10)` : ''}`, 11, { bold: true, gap: 1 });
      text(p.answer || '(no answer captured)', 10.5, { gap: pq.feedback ? 1 : 4 });
      if (pq.feedback) text(`AI: ${pq.feedback}`, 9.5, { color: [120, 120, 120], gap: 4 });
    });
  }

  return doc.output('datauristring').split(',')[1];
}
