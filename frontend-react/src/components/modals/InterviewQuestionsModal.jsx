import { useEffect, useState } from 'react';
import { apiPost } from '../../services/api';
import { useUI } from '../../state/uiState';
import { getInterviewPackTemplate, sendEmailRequest, getEmailStatus } from '../../services/email';

const NOTES_LS_KEY = 'hr_interview_notes';
const HM_LS_KEY = 'hr_hiring_manager_emails';
const PLATFORMS = [
  { value: 'Zoom', label: 'Zoom', icon: '\uD83D\uDCF9' },
  { value: 'Microsoft Teams', label: 'Teams', icon: '\uD83D\uDCBC' },
  { value: 'Google Meet', label: 'Meet', icon: '\uD83C\uDFA5' },
  { value: 'In person', label: 'In person', icon: '\uD83C\uDFE2' },
  { value: 'Phone', label: 'Phone', icon: '\uD83D\uDCDE' },
];

function loadAllNotes() {
  try { return JSON.parse(localStorage.getItem(NOTES_LS_KEY) || '{}'); } catch { return {}; }
}
function saveCandidateNotes(candidateId, payload) {
  if (!candidateId) return;
  const all = loadAllNotes();
  all[candidateId] = { ...payload, savedAt: new Date().toISOString() };
  try { localStorage.setItem(NOTES_LS_KEY, JSON.stringify(all)); } catch {}
}
function loadHMEmails() {
  try { return JSON.parse(localStorage.getItem(HM_LS_KEY) || '{}'); } catch { return {}; }
}
function saveHMEmail(jobId, email) {
  if (!jobId || !email) return;
  const m = loadHMEmails();
  m[jobId] = email;
  try { localStorage.setItem(HM_LS_KEY, JSON.stringify(m)); } catch {}
}
function looksLikeEmail(s) { return typeof s === 'string' && /@/.test(s) && /\./.test(s.split('@').pop() || ''); }

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildWordBlob({ candidateName, jobTitle, department, meeting, questions, notes, generalNotes }) {
  const m = meeting || {};
  const when = m.datetime ? new Date(m.datetime).toLocaleString() : '';
  const meetingHtml = (m.platform || when || m.link || m.interviewers) ? `
    <h2>Meeting</h2>
    <table style="border-collapse:collapse;margin-bottom:14px;">
      ${m.platform ? `<tr><td style="padding:2px 12px 2px 0;font-weight:bold;">Platform</td><td>${escapeHtml(m.platform)}</td></tr>` : ''}
      ${when ? `<tr><td style="padding:2px 12px 2px 0;font-weight:bold;">Date / time</td><td>${escapeHtml(when)}</td></tr>` : ''}
      ${m.link ? `<tr><td style="padding:2px 12px 2px 0;font-weight:bold;">Link / room</td><td>${escapeHtml(m.link)}</td></tr>` : ''}
      ${m.interviewers ? `<tr><td style="padding:2px 12px 2px 0;font-weight:bold;">Interviewer(s)</td><td>${escapeHtml(m.interviewers)}</td></tr>` : ''}
    </table>` : '';
  const rows = questions.map((q, i) => {
    const note = (notes[i] || '').trim();
    return `
      <h3 style="margin-bottom:4px;">Q${i + 1}. <span style="font-weight:normal;color:#555;">[${escapeHtml(q.category)}]</span></h3>
      <p style="margin:4px 0 6px 0;">${escapeHtml(q.question)}</p>
      ${q.hints ? `<p style="margin:0 0 8px 0;color:#666;font-style:italic;font-size:11pt;">Hint: ${escapeHtml(q.hints)}</p>` : ''}
      <p style="margin:4px 0 0 0;font-weight:bold;">Notes:</p>
      <p style="margin:0 0 14px 0;border:1px solid #ccc;padding:8px;min-height:40px;white-space:pre-wrap;">${escapeHtml(note) || '&nbsp;'}</p>
    `;
  }).join('');
  const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset="utf-8"><title>Interview Questions - ${escapeHtml(candidateName)}</title></head>
<body style="font-family:Calibri,Arial,sans-serif;font-size:12pt;">
  <h1 style="margin-bottom:0;">Interview Questions</h1>
  <p style="margin-top:4px;color:#444;">${escapeHtml(candidateName)} \u2014 ${escapeHtml(jobTitle)}${department ? ' (' + escapeHtml(department) + ')' : ''}</p>
  <hr/>
  ${meetingHtml}
  ${rows}
  <h2>General Interview Notes</h2>
  <p style="border:1px solid #ccc;padding:10px;min-height:120px;white-space:pre-wrap;">${escapeHtml(generalNotes) || '&nbsp;'}</p>
</body></html>`;
  return new Blob(['\uFEFF', html], { type: 'application/msword' });
}

const CATEGORY_COLORS = {
  hr: { bg: '#eff6ff', border: '#bfdbfe', text: '#1e40af' },
  technical: { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534' },
  salary: { bg: '#fef3c7', border: '#fde68a', text: '#92400e' },
};

// Interview questions should be grouped by category in a fixed flow:
// HR (warm-up / behavioral) → Technical (skills probing) → Salary (closing).
// LLM returns them in arbitrary order, so we sort here and keep notes paired.
const CATEGORY_ORDER = { hr: 0, technical: 1, salary: 2 };
function sortQuestionsByCategory(qs, notesArr) {
  const list = (qs || []).map((q, i) => ({ q, note: (notesArr || [])[i] || '' }));
  list.sort((a, b) => {
    const ai = CATEGORY_ORDER[a.q.category] ?? 99;
    const bi = CATEGORY_ORDER[b.q.category] ?? 99;
    return ai - bi;
  });
  return { questions: list.map(x => x.q), notes: list.map(x => x.note) };
}

export default function InterviewQuestionsModal({ candidate, job, isOpen, onClose, onPackSent }) {
  const { showToast, openEmailComposer } = useUI();
  const [numQuestions, setNumQuestions] = useState(8);
  const [includeHr, setIncludeHr] = useState(true);
  const [includeTechnical, setIncludeTechnical] = useState(true);
  const [includeSalary, setIncludeSalary] = useState(false);
  const [extraContext, setExtraContext] = useState('');
  const [generating, setGenerating] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [notes, setNotes] = useState([]);
  const [generalNotes, setGeneralNotes] = useState('');
  const [savedTimestamp, setSavedTimestamp] = useState(null);
  const [meeting, setMeeting] = useState({ platform: '', datetime: '', link: '', interviewers: '' });

  useEffect(() => {
    if (!isOpen || !candidate?.id) return;
    const all = loadAllNotes();
    const prev = all[candidate.id];
    if (prev && Array.isArray(prev.questions)) {
      const sorted = sortQuestionsByCategory(prev.questions, prev.notes);
      setQuestions(sorted.questions);
      setNotes(sorted.notes);
      setGeneralNotes(prev.generalNotes || '');
      setSavedTimestamp(prev.savedAt || null);
    } else {
      setQuestions([]); setNotes([]); setGeneralNotes(''); setSavedTimestamp(null);
    }
    setMeeting(prev?.meeting || { platform: '', datetime: '', link: '', interviewers: '' });
  }, [isOpen, candidate?.id]);

  if (!isOpen || !candidate) return null;

  async function generate() {
    if (!includeHr && !includeTechnical && !includeSalary) {
      showToast('Pick at least one question type', 'error'); return;
    }
    setGenerating(true);
    try {
      const res = await apiPost('/generate-interview-questions', {
        candidate_id: candidate.id,
        num_questions: numQuestions,
        include_hr: includeHr,
        include_technical: includeTechnical,
        include_salary: includeSalary,
        extra_context: extraContext,
      });
      const data = res.data;
      if (!data?.success) {
        showToast(data?.error || 'Failed to generate questions', 'error');
        return;
      }
      const qs = Array.isArray(data.questions) ? data.questions : [];
      if (!qs.length) { showToast('No questions returned. Try again.', 'error'); return; }
      const sorted = sortQuestionsByCategory(qs, qs.map(() => ''));
      setQuestions(sorted.questions);
      setNotes(sorted.notes);
      showToast(`${sorted.questions.length} questions generated`, 'success');
    } catch (err) {
      showToast('Failed to reach question generator', 'error');
    } finally {
      setGenerating(false);
    }
  }

  function updateNote(i, value) {
    setNotes(prev => { const next = [...prev]; next[i] = value; return next; });
  }

  function saveAll() {
    saveCandidateNotes(candidate.id, { questions, notes, generalNotes, meeting });
    setSavedTimestamp(new Date().toISOString());
    showToast('Notes saved locally', 'success');
  }

  function updateMeeting(field, value) {
    setMeeting(prev => ({ ...prev, [field]: value }));
  }

  function sendPackToHM() {
    const jobTitle = job?.job_title || job?.title || 'the position';
    const department = job?.department || '';
    const reportingTo = job?.reporting_to || '';
    // Per request: leave the To: field empty by default. HR types the HM address
    // each time. The stored hr_hiring_manager_emails cache is no longer consulted
    // for prefill (still written on send so we can re-enable later).
    const initialEmail = '';
    const tmpl = getInterviewPackTemplate({
      candidateName: candidate.candidate_name,
      candidateEmail: candidate.email,
      jobTitle,
      department,
      meeting,
      questions,
      generalNotes,
      evaluation: candidate,
    });
    openEmailComposer({
      title: 'Send Interview Pack to Hiring Manager',
      description: `Send interview meeting details and suggested questions for ${candidate.candidate_name}.`,
      candidate: { id: candidate.id, name: candidate.candidate_name, email: candidate.email },
      job: { id: job?.id, title: jobTitle },
      emailType: 'recommendation',
      recipientLabel: 'Hiring manager',
      recipientName: reportingTo || 'Hiring manager',
      recipientEmail: initialEmail,
      editableRecipient: true,
      defaultSubject: tmpl.subject,
      defaultBody: tmpl.body,
      sendLabel: 'Send Interview Pack',
      sendClass: 'btn-primary',
      // Closing the composer reveals this modal underneath — no extra action needed.
      onBack: () => {},
      backLabel: 'Back to Interview Pack',
      onSend: async ({ subject, body, recipientEmail }) => {
        if (!looksLikeEmail(recipientEmail)) { showToast('Please enter a valid hiring manager email', 'error'); throw new Error('invalid recipient'); }
        const res = await sendEmailRequest({
          candidateId: candidate.id, jobId: job?.id, emailType: 'recommendation',
          recipientEmail, candidateName: candidate.candidate_name, jobTitle,
          subject, body,
        });
        if (job?.id) saveHMEmail(job.id, recipientEmail);
        const status = getEmailStatus(res);
        showToast(status.message, status.type);
        if (typeof onPackSent === 'function') {
          const newEntry = {
            email_type: 'recommendation',
            status: res.data?.status || 'failed',
            sent_at: new Date().toISOString(),
            subject, body,
            recipient_email: recipientEmail,
            error_message: res.data?.error || null,
            direction: 'outbound',
          };
          onPackSent(candidate.id, newEntry);
        }
      },
    });
  }

  function exportWord() {
    if (!questions.length) { showToast('Generate questions first', 'error'); return; }
    const blob = buildWordBlob({
      candidateName: candidate.candidate_name,
      jobTitle: job?.job_title || job?.title || '',
      department: job?.department || '',
      meeting,
      questions, notes, generalNotes,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Interview - ${candidate.candidate_name || 'candidate'}.doc`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function copyAll() {
    if (!questions.length) { showToast('Generate questions first', 'error'); return; }
    const text = questions.map((q, i) => {
      const note = (notes[i] || '').trim();
      return `Q${i + 1} [${q.category}]: ${q.question}${q.hints ? '\n  Hint: ' + q.hints : ''}${note ? '\n  Notes: ' + note : ''}`;
    }).join('\n\n') + (generalNotes ? '\n\nGeneral notes:\n' + generalNotes : '');
    navigator.clipboard.writeText(text).then(
      () => showToast('Copied to clipboard', 'success'),
      () => showToast('Copy failed', 'error')
    );
  }

  return (
    <div className="modal-overlay active" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: '780px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <h3>Interview Questions — {candidate.candidate_name}</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body" style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
          <div style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', padding: '14px', marginBottom: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--gray-700)', marginBottom: '4px' }}>Number of questions: {numQuestions}</label>
                <input type="range" min="3" max="20" value={numQuestions} onChange={e => setNumQuestions(parseInt(e.target.value))} style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--gray-700)', marginBottom: '8px' }}>Question types</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {[
                    { key: 'hr',        label: 'Behavioural',      icon: '🤝', checked: includeHr,        set: setIncludeHr },
                    { key: 'technical', label: 'Technical',         icon: '⚙️', checked: includeTechnical, set: setIncludeTechnical },
                    { key: 'salary',    label: 'Compensation',      icon: '💰', checked: includeSalary,    set: setIncludeSalary },
                  ].map(({ key, label, icon, checked, set }) => (
                    <button key={key} type="button" onClick={() => set(v => !v)} style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
                      padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', border: '1.5px solid',
                      borderColor: checked ? '#2563eb' : 'var(--gray-200)',
                      background: checked ? '#eff6ff' : '#fff',
                      transition: 'all 0.15s',
                    }}>
                      <span style={{ fontSize: '18px', lineHeight: 1 }}>{icon}</span>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: checked ? '#1e40af' : 'var(--gray-500)' }}>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--gray-700)', marginBottom: '4px' }}>Extra context (optional)</label>
            <textarea value={extraContext} onChange={e => setExtraContext(e.target.value)}
              placeholder="e.g. focus on system design, ask about team leadership"
              style={{ width: '100%', minHeight: '50px', fontSize: '13px' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px', gap: '8px' }}>
              <button className="btn btn-primary" onClick={generate} disabled={generating}>
                {generating ? 'Generating...' : (questions.length ? 'Regenerate Questions' : 'Generate Questions')}
              </button>
            </div>
          </div>

          <div style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', padding: '14px', marginBottom: '16px' }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', color: 'var(--gray-800)' }}>Meeting details</h4>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)', marginBottom: '6px' }}>Platform</label>
              <div role="radiogroup" aria-label="Meeting platform" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {PLATFORMS.map(p => {
                  const selected = meeting.platform === p.value;
                  return (
                    <button
                      type="button"
                      key={p.value}
                      role="radio"
                      aria-checked={selected}
                      onClick={() => updateMeeting('platform', selected ? '' : p.value)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                        padding: '6px 12px',
                        borderRadius: '999px',
                        border: `1px solid ${selected ? 'var(--primary, #2563eb)' : 'var(--gray-300, #d1d5db)'}`,
                        background: selected ? 'var(--primary, #2563eb)' : '#fff',
                        color: selected ? '#fff' : 'var(--gray-700, #374151)',
                        fontSize: '13px', fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'background-color 160ms ease, color 160ms ease, border-color 160ms ease, transform 120ms ease, box-shadow 160ms ease',
                        boxShadow: selected ? '0 1px 3px rgba(37,99,235,0.25)' : 'none',
                      }}
                      onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.97)'; }}
                      onMouseUp={e => { e.currentTarget.style.transform = ''; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
                      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--gray-100, #f3f4f6)'; }}
                      onMouseOut={e => { if (!selected) e.currentTarget.style.background = '#fff'; }}
                    >
                      <span aria-hidden="true">{p.icon}</span>{p.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)', marginBottom: '4px' }}>Date &amp; time</label>
              <input type="datetime-local" value={meeting.datetime} onChange={e => updateMeeting('datetime', e.target.value)} style={{ width: '100%', padding: '6px', fontSize: '13px' }} />
            </div>
            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)', marginBottom: '4px' }}>
                {meeting.platform === 'In person' ? 'Location' : meeting.platform === 'Phone' ? 'Phone number' : 'Meeting link'}
              </label>
              <input type="text" value={meeting.link} onChange={e => updateMeeting('link', e.target.value)}
                placeholder={meeting.platform === 'In person' ? 'Office room, address…' : meeting.platform === 'Phone' ? '+1 555 555 5555' : 'https://zoom.us/j/...'}
                style={{ width: '100%', padding: '6px', fontSize: '13px' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)', marginBottom: '4px' }}>Interviewer(s)</label>
              <input type="text" value={meeting.interviewers} onChange={e => updateMeeting('interviewers', e.target.value)}
                placeholder="e.g. Jane Doe (Engineering Manager), John Smith (Tech Lead)"
                style={{ width: '100%', padding: '6px', fontSize: '13px' }} />
            </div>
          </div>

          {questions.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '6px' }}>
                <h4 style={{ margin: 0, color: 'var(--gray-800)' }}>{questions.length} questions</h4>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button className="btn btn-sm btn-secondary" onClick={copyAll}>{'\u2398'} Copy</button>
                  <button className="btn btn-sm btn-secondary" onClick={exportWord}>{'\u2B07'} Export to Word</button>
                  <button className="btn btn-sm btn-primary" onClick={sendPackToHM}>{'\u2709'} Send Pack to Hiring Manager</button>
                  <button className="btn btn-sm btn-success" onClick={saveAll}>{'\u2713'} Save Notes</button>
                </div>
              </div>
              {savedTimestamp && (
                <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginBottom: '10px' }}>
                  Last saved: {new Date(savedTimestamp).toLocaleString()}
                </div>
              )}
              {questions.map((q, i) => {
                const c = CATEGORY_COLORS[q.category] || CATEGORY_COLORS.hr;
                return (
                  <div key={i} style={{ marginBottom: '14px', borderLeft: `3px solid ${c.border}`, paddingLeft: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: '12px', padding: '2px 10px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>{q.category}</span>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--gray-700)' }}>Q{i + 1}</span>
                    </div>
                    <p style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 600 }}>{q.question}</p>
                    {q.hints && <p style={{ margin: '0 0 6px 0', fontSize: '12px', color: 'var(--gray-500)', fontStyle: 'italic' }}>Hint: {q.hints}</p>}
                    <textarea value={notes[i] || ''} onChange={e => updateNote(i, e.target.value)}
                      placeholder="Notes from the interview..."
                      style={{ width: '100%', minHeight: '60px', fontSize: '13px', marginTop: '4px' }} />
                  </div>
                );
              })}

              <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--gray-200)' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--gray-800)', marginBottom: '6px' }}>General interview notes</label>
                <textarea value={generalNotes} onChange={e => setGeneralNotes(e.target.value)}
                  placeholder="Overall impressions, follow-up items, recommendation..."
                  style={{ width: '100%', minHeight: '100px', fontSize: '13px' }} />
              </div>
            </>
          )}
        </div>
        <div className="modal-footer" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
