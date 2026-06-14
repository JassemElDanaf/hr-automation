import { useEffect, useState } from 'react';
import { apiPost, apiGet } from '../../services/api';
import { useUI } from '../../state/uiState';
import { getInterviewPackTemplate, sendEmailRequest, getEmailStatus } from '../../services/email';

const NOTES_LS_KEY = 'hr_interview_notes';
const HM_LS_KEY    = 'hr_hiring_manager_emails';
const API_BASE     = import.meta.env.VITE_API_URL || '/webhook';
const QBANK_URL    = `${API_BASE}/interview/question-bank`;

const PLATFORMS = [
  { value: 'Zoom',             label: 'Zoom',      icon: '📹' },
  { value: 'Microsoft Teams',  label: 'Teams',     icon: '💼' },
  { value: 'Google Meet',      label: 'Meet',      icon: '🎥' },
  { value: 'In person',        label: 'In person', icon: '🏢' },
  { value: 'Phone',            label: 'Phone',     icon: '📞' },
];

const CAT_LABELS = { hr: 'Behavioural', technical: 'Technical', salary: 'Compensation', iqama: 'Iqama / Visa', notice: 'Notice Period', location: 'Location' };
const CAT_COLOR  = { hr: '#2563eb',     technical: '#16a34a',   salary: '#d97706',        iqama: '#7c3aed',      notice: '#dc2626',         location: '#0891b2' };
const CAT_BG     = { hr: '#eff6ff',     technical: '#f0fdf4',   salary: '#fffbeb',        iqama: '#f5f3ff',      notice: '#fef2f2',         location: '#ecfeff' };
const CAT_BORDER = { hr: '#bfdbfe',     technical: '#bbf7d0',   salary: '#fde68a',        iqama: '#ddd6fe',      notice: '#fecaca',         location: '#a5f3fc' };
const CAT_TEXT   = { hr: '#1e40af',     technical: '#166534',   salary: '#92400e',        iqama: '#5b21b6',      notice: '#991b1b',         location: '#155e75' };

// salary/iqama/notice/location questions become requirement checks in the AI
// evaluation when given an expected answer — see IntEval REQ_CATEGORIES.
const REQUIREMENT_CATS = ['salary', 'iqama', 'notice', 'location'];
const CATEGORY_ORDER = { hr: 0, technical: 1, salary: 2, iqama: 3, notice: 4, location: 5 };
function sortQuestionsByCategory(qs, notesArr) {
  const list = (qs || []).map((q, i) => ({ q, note: (notesArr || [])[i] || '' }));
  list.sort((a, b) => (CATEGORY_ORDER[a.q.category] ?? 99) - (CATEGORY_ORDER[b.q.category] ?? 99));
  return { questions: list.map(x => x.q), notes: list.map(x => x.note) };
}

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
function looksLikeEmail(s) {
  return typeof s === 'string' && /@/.test(s) && /\./.test(s.split('@').pop() || '');
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function buildWordBlob({ candidateName, jobTitle, department, meeting, questions, notes, generalNotes }) {
  const m = meeting || {};
  const when = m.datetime ? new Date(m.datetime).toLocaleString() : '';
  const meetingHtml = (m.platform || when || m.link || m.interviewers) ? `
    <h2>Meeting</h2>
    <table style="border-collapse:collapse;margin-bottom:14px;">
      ${m.platform   ? `<tr><td style="padding:2px 12px 2px 0;font-weight:bold;">Platform</td><td>${escapeHtml(m.platform)}</td></tr>` : ''}
      ${when         ? `<tr><td style="padding:2px 12px 2px 0;font-weight:bold;">Date / time</td><td>${escapeHtml(when)}</td></tr>` : ''}
      ${m.link       ? `<tr><td style="padding:2px 12px 2px 0;font-weight:bold;">Link / room</td><td>${escapeHtml(m.link)}</td></tr>` : ''}
      ${m.interviewers ? `<tr><td style="padding:2px 12px 2px 0;font-weight:bold;">Interviewer(s)</td><td>${escapeHtml(m.interviewers)}</td></tr>` : ''}
    </table>` : '';
  const rows = questions.map((q, i) => {
    const note = (notes[i] || '').trim();
    return `
      <h3 style="margin-bottom:4px;">Q${i + 1}. <span style="font-weight:normal;color:#555;">[${escapeHtml(q.category)}]</span></h3>
      <p style="margin:4px 0 6px 0;">${escapeHtml(q.question)}</p>
      ${(q.modelAnswer || q.hints) ? `<p style="margin:0 0 8px 0;color:#666;font-style:italic;font-size:11pt;">Expected answer: ${escapeHtml(q.modelAnswer || q.hints)}</p>` : ''}
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

// ── Mini BankPicker for use inside the modal ─────────────────────────────────

function ModalBankPicker({ onAdd }) {
  const [bank, setBank]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [checked, setChecked]   = useState({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(QBANK_URL);
        const json = await r.json();
        setBank(Array.isArray(json) ? json : (json.data || json.rows || []));
      } catch {}
      finally { setLoading(false); }
    })();
  }, []);

  const visible = bank.filter(b => {
    const matchCat = catFilter === 'all' || b.category === catFilter;
    const matchSearch = !search || b.question.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });
  const checkedCount = Object.values(checked).filter(Boolean).length;

  function toggle(id) { setChecked(p => ({ ...p, [id]: !p[id] })); }

  function handleAdd() {
    const selected = bank.filter(b => checked[b.id]);
    if (!selected.length) return;
    onAdd(selected.map(b => ({ question: b.question, category: b.category || 'hr', modelAnswer: b.modelAnswer || '' })));
    setChecked({});
  }

  const cats = ['all', ...Object.keys(CAT_LABELS)];

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text" placeholder="Search bank…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 160, padding: '7px 10px', fontSize: 13, border: '1px solid var(--gray-300)', borderRadius: 6, outline: 'none', fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {cats.map(c => (
            <button key={c} type="button" onClick={() => setCatFilter(c)} style={{
              padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              border: `1px solid ${catFilter === c ? (CAT_COLOR[c] || '#2563eb') : 'var(--gray-200)'}`,
              background: catFilter === c ? (CAT_BG[c] || '#eff6ff') : '#fff',
              color: catFilter === c ? (CAT_COLOR[c] || '#2563eb') : 'var(--gray-500)',
            }}>
              {c === 'all' ? 'All' : CAT_LABELS[c]}
            </button>
          ))}
        </div>
      </div>

      {loading && <div style={{ padding: 16, textAlign: 'center', color: 'var(--gray-400)', fontSize: 13 }}>Loading bank…</div>}

      {!loading && bank.length === 0 && (
        <div style={{ padding: '16px', background: 'var(--gray-50)', border: '1px dashed var(--gray-300)', borderRadius: 8, fontSize: 13, color: 'var(--gray-400)', textAlign: 'center' }}>
          No questions in the bank yet. Use <strong>Question Bank</strong> tab in Live Interview to add some.
        </div>
      )}

      {!loading && bank.length > 0 && (
        <div style={{ border: '1px solid var(--gray-200)', borderRadius: 8, overflow: 'hidden', marginBottom: 10, maxHeight: 240, overflowY: 'auto' }}>
          {visible.length === 0
            ? <div style={{ padding: 14, textAlign: 'center', fontSize: 13, color: 'var(--gray-400)' }}>No matches.</div>
            : visible.map((b, i) => (
              <div
                key={b.id}
                onClick={() => toggle(b.id)}
                style={{
                  display: 'grid', gridTemplateColumns: '36px 1fr 110px',
                  borderBottom: i < visible.length - 1 ? '1px solid var(--gray-100)' : 'none',
                  background: checked[b.id] ? '#f8faff' : '#fff',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <input type="checkbox" checked={!!checked[b.id]} onChange={() => toggle(b.id)} onClick={e => e.stopPropagation()} style={{ cursor: 'pointer' }} />
                </div>
                <div style={{ padding: '9px 10px', fontSize: 13, color: 'var(--gray-900)', lineHeight: 1.45 }}>{b.question}</div>
                <div style={{ display: 'flex', alignItems: 'center', padding: '9px 8px' }}>
                  <span style={{ padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: CAT_BG[b.category] || '#f1f5f9', color: CAT_COLOR[b.category] || '#475569' }}>
                    {CAT_LABELS[b.category] || b.category}
                  </span>
                </div>
              </div>
            ))
          }
        </div>
      )}

      {!loading && bank.length > 0 && (
        <button
          type="button"
          onClick={handleAdd}
          disabled={checkedCount === 0}
          className="btn btn-primary btn-sm"
        >
          + Add {checkedCount > 0 ? checkedCount : ''} Selected to Interview
        </button>
      )}
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export default function InterviewQuestionsModal({ candidate, job, isOpen, onClose, onPackSent }) {
  const { showToast, openEmailComposer } = useUI();

  // Source tab
  const [qSource, setQSource] = useState('bank');

  // Unified question list
  const [questions, setQuestions] = useState([]);
  const [notes, setNotes]         = useState([]);
  const [generalNotes, setGeneralNotes] = useState('');
  const [savedTimestamp, setSavedTimestamp] = useState(null);

  // Meeting
  const [meeting, setMeeting] = useState({ platform: '', datetime: '', link: '', interviewers: '' });

  // AI Generate source state
  const [numQuestions, setNumQuestions] = useState(8);
  const [includeHr,        setIncludeHr]        = useState(true);
  const [includeTechnical, setIncludeTechnical] = useState(true);
  const [includeSalary,    setIncludeSalary]    = useState(false);
  const [extraContext,     setExtraContext]     = useState('');
  const [generating,       setGenerating]      = useState(false);

  // Write My Own source state
  const [ownText, setOwnText] = useState('');
  const [ownCat,  setOwnCat]  = useState('hr');

  // Actions
  const [savingToBank, setSavingToBank]   = useState({});
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (!isOpen || !candidate?.id) return;
    // Reset source panel state on open
    setQSource('bank');
    setOwnText('');
    setOwnCat('hr');

    // Load from localStorage; fall back to the candidate_prepared_questions
    // table so prep saved on another browser/machine still shows up.
    const all = loadAllNotes();
    const prev = all[candidate.id];
    if (prev && Array.isArray(prev.questions)) {
      const sorted = sortQuestionsByCategory(prev.questions, prev.notes);
      setQuestions(sorted.questions);
      setNotes(sorted.notes);
      setGeneralNotes(prev.generalNotes || '');
      setSavedTimestamp(prev.savedAt || null);
      setMeeting(prev.meeting || { platform: '', datetime: '', link: '', interviewers: '' });
      return;
    }
    setQuestions([]); setNotes([]); setGeneralNotes(''); setSavedTimestamp(null);
    setMeeting({ platform: '', datetime: '', link: '', interviewers: '' });
    if (!job?.id) return;
    (async () => {
      try {
        const r = await apiGet(`/candidate-questions?candidate_id=${candidate.id}&job_id=${job.id}`);
        const row = r?.data || r || {};
        if (!Array.isArray(row.questions) || row.questions.length === 0) return;
        const dbNotes = Array.isArray(row.notes) ? row.notes : [];
        const sorted = sortQuestionsByCategory(row.questions, dbNotes);
        setQuestions(sorted.questions);
        setNotes(sorted.notes);
        setGeneralNotes(row.general_notes || '');
        setMeeting(row.meeting || { platform: '', datetime: '', link: '', interviewers: '' });
        setSavedTimestamp(row.updated_at || null);
      } catch { /* no server copy — start fresh */ }
    })();
  }, [isOpen, candidate?.id]);

  if (!isOpen || !candidate) return null;

  // ── Question list helpers ──
  function addQuestions(newQs) {
    const unique = newQs.filter(nq =>
      !questions.some(eq => eq.question.trim().toLowerCase() === (nq.question || '').trim().toLowerCase())
    );
    if (!unique.length) { showToast('All selected questions are already added', 'info'); return; }
    setQuestions(prev => {
      const combined = [...prev, ...unique];
      const sorted = sortQuestionsByCategory(combined, [...notes, ...unique.map(() => '')]);
      setNotes(sorted.notes);
      return sorted.questions;
    });
    showToast(`${unique.length} question${unique.length !== 1 ? 's' : ''} added`, 'success');
  }

  function removeQuestion(index) {
    setQuestions(prev => prev.filter((_, i) => i !== index));
    setNotes(prev => prev.filter((_, i) => i !== index));
  }

  function updateNote(i, value) {
    setNotes(prev => { const next = [...prev]; next[i] = value; return next; });
  }

  // Edit a field on a question in place (used for the per-question model answer).
  function updateQuestionField(i, field, value) {
    setQuestions(prev => prev.map((q, idx) => idx === i ? { ...q, [field]: value } : q));
  }

  // ── AI Generate ──
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
      if (!data?.success) { showToast(data?.error || 'Failed to generate questions', 'error'); return; }
      const qs = Array.isArray(data.questions) ? data.questions : [];
      if (!qs.length) { showToast('No questions returned. Try again.', 'error'); return; }
      addQuestions(qs);
    } catch {
      showToast('Failed to reach question generator', 'error');
    } finally {
      setGenerating(false);
    }
  }

  // ── Write My Own ──
  function addOwn() {
    const text = ownText.trim();
    if (!text) { showToast('Enter a question first', 'error'); return; }
    addQuestions([{ question: text, category: ownCat, hints: '' }]);
    setOwnText('');
  }

  // ── Save to Bank (per-question) ──
  async function saveToBank(q, index) {
    setSavingToBank(prev => ({ ...prev, [index]: true }));
    try {
      await fetch(QBANK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q.question, category: q.category, jobType: job?.job_title || '' }),
      });
      showToast('Added to question bank', 'success');
    } catch { showToast('Failed to save to bank', 'error'); }
    finally { setSavingToBank(prev => ({ ...prev, [index]: false })); }
  }

  // ── Save to Profile (localStorage + DB) ──
  async function saveProfile() {
    saveCandidateNotes(candidate.id, { questions, notes, generalNotes, meeting });
    setSavedTimestamp(new Date().toISOString());

    if (job?.id) {
      setSavingProfile(true);
      try {
        await apiPost('/candidate-questions', {
          candidate_id: candidate.id,
          job_opening_id: job.id,
          questions,
          notes,
          general_notes: generalNotes,
          meeting,
        });
        showToast('Saved to candidate profile', 'success');
      } catch {
        showToast('Saved locally (server save failed)', 'info');
      } finally {
        setSavingProfile(false);
      }
    } else {
      showToast('Notes saved locally', 'success');
    }
  }

  // ── Meeting ──
  function updateMeeting(field, value) {
    setMeeting(prev => ({ ...prev, [field]: value }));
  }

  // ── Send Pack to HM ──
  function sendPackToHM() {
    const jobTitle   = job?.job_title || job?.title || 'the position';
    const department = job?.department || '';
    const tmpl = getInterviewPackTemplate({
      candidateName: candidate.candidate_name,
      candidateEmail: candidate.email,
      jobTitle, department, meeting, questions, generalNotes,
      evaluation: candidate,
    });
    openEmailComposer({
      title: 'Send Interview Pack to Hiring Manager',
      description: `Send interview meeting details and suggested questions for ${candidate.candidate_name}.`,
      candidate: { id: candidate.id, name: candidate.candidate_name, email: candidate.email },
      job: { id: job?.id, title: jobTitle },
      emailType: 'recommendation',
      recipientLabel: 'Hiring manager',
      recipientName: job?.reporting_to || 'Hiring manager',
      recipientEmail: '',
      editableRecipient: true,
      defaultSubject: tmpl.subject,
      defaultBody: tmpl.body,
      sendLabel: 'Send Interview Pack',
      sendClass: 'btn-primary',
      onBack: () => {},
      backLabel: 'Back to Interview Pack',
      onSend: async ({ subject, body, recipientEmail }) => {
        if (!looksLikeEmail(recipientEmail)) {
          showToast('Please enter a valid hiring manager email', 'error');
          throw new Error('invalid recipient');
        }
        const res = await sendEmailRequest({
          candidateId: candidate.id, jobId: job?.id, emailType: 'recommendation',
          recipientEmail, candidateName: candidate.candidate_name, jobTitle,
          subject, body,
        });
        if (job?.id) saveHMEmail(job.id, recipientEmail);
        const status = getEmailStatus(res);
        showToast(status.message, status.type);
        if (typeof onPackSent === 'function') {
          onPackSent(candidate.id, {
            email_type: 'recommendation',
            status: res.data?.status || 'failed',
            sent_at: new Date().toISOString(),
            subject, body,
            recipient_email: recipientEmail,
            error_message: res.data?.error || null,
            direction: 'outbound',
          });
        }
      },
    });
  }

  // ── Export ──
  function exportWord() {
    if (!questions.length) { showToast('Add questions first', 'error'); return; }
    const blob = buildWordBlob({
      candidateName: candidate.candidate_name,
      jobTitle: job?.job_title || job?.title || '',
      department: job?.department || '',
      meeting, questions, notes, generalNotes,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `Interview - ${candidate.candidate_name || 'candidate'}.doc`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function copyAll() {
    if (!questions.length) { showToast('Add questions first', 'error'); return; }
    const text = questions.map((q, i) => {
      const note = (notes[i] || '').trim();
      return `Q${i + 1} [${q.category}]: ${q.question}${(q.modelAnswer || q.hints) ? '\n  Expected answer: ' + (q.modelAnswer || q.hints) : ''}${note ? '\n  Notes: ' + note : ''}`;
    }).join('\n\n') + (generalNotes ? '\n\nGeneral notes:\n' + generalNotes : '');
    navigator.clipboard.writeText(text).then(
      () => showToast('Copied to clipboard', 'success'),
      () => showToast('Copy failed', 'error')
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────

  const sourceItems = [
    { key: 'bank', icon: '📚', label: 'From Question Bank', desc: 'Pick from saved questions' },
    { key: 'ai',   icon: '✨', label: 'AI Generate',         desc: 'Preview, then add' },
    { key: 'own',  icon: '✏️', label: 'Write My Own',        desc: 'Type your own question' },
  ];

  return (
    <div className="modal-overlay active" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 800, maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div className="modal-header">
          <h3>Interview Questions — {candidate.candidate_name}</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body" style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>

          {/* ── Source selector ── */}
          <div style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', padding: '14px', marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
              Add Questions
            </div>

            {/* Source tabs */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              {sourceItems.map(s => {
                const active = qSource === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setQSource(s.key)}
                    style={{
                      flex: 1, padding: '12px 10px', cursor: 'pointer', textAlign: 'center',
                      background: active ? '#eff6ff' : '#fff',
                      border: `1.5px solid ${active ? '#2563eb' : 'var(--gray-200)'}`,
                      borderRadius: 10, transition: 'border-color 0.13s, background 0.13s',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                    }}
                  >
                    <span style={{ fontSize: 20, lineHeight: 1 }}>{s.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: active ? '#2563eb' : 'var(--gray-700)' }}>{s.label}</span>
                    <span style={{ fontSize: 11, color: active ? '#3b82f6' : 'var(--gray-400)', lineHeight: 1.3 }}>{s.desc}</span>
                  </button>
                );
              })}
            </div>

            {/* From Question Bank */}
            {qSource === 'bank' && (
              <ModalBankPicker onAdd={addQuestions} />
            )}

            {/* AI Generate */}
            {qSource === 'ai' && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '10px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--gray-700)', marginBottom: '4px' }}>
                      Number of questions: {numQuestions}
                    </label>
                    <input
                      type="range" min="3" max="20" value={numQuestions}
                      onChange={e => setNumQuestions(parseInt(e.target.value))}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--gray-700)', marginBottom: '6px' }}>
                      Question types
                    </label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {[
                        { key: 'hr',        label: 'Behavioural', icon: '🤝', checked: includeHr,        set: setIncludeHr },
                        { key: 'technical', label: 'Technical',   icon: '⚙️', checked: includeTechnical, set: setIncludeTechnical },
                        { key: 'salary',    label: 'Compensation',icon: '💰', checked: includeSalary,    set: setIncludeSalary },
                      ].map(({ key, label, icon, checked, set }) => (
                        <button key={key} type="button" onClick={() => set(v => !v)} style={{
                          flex: 1, padding: '7px 6px', borderRadius: '8px', cursor: 'pointer',
                          border: `1.5px solid ${checked ? '#2563eb' : 'var(--gray-200)'}`,
                          background: checked ? '#eff6ff' : '#fff',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                          transition: 'all 0.13s',
                        }}>
                          <span style={{ fontSize: '16px', lineHeight: 1 }}>{icon}</span>
                          <span style={{ fontSize: '10px', fontWeight: 600, color: checked ? '#1e40af' : 'var(--gray-500)' }}>{label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <textarea
                  value={extraContext} onChange={e => setExtraContext(e.target.value)}
                  placeholder="Extra context — e.g. focus on system design, ask about team leadership (optional)"
                  style={{ width: '100%', minHeight: '44px', fontSize: '13px', marginBottom: '8px' }}
                />
                <button className="btn btn-primary btn-sm" onClick={generate} disabled={generating}>
                  {generating ? 'Generating…' : 'Generate & Add Questions'}
                </button>
                <p style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 6, marginBottom: 0 }}>
                  Generated questions are added directly to the list below — remove any you don't want with ×.
                </p>
              </div>
            )}

            {/* Write My Own */}
            {qSource === 'own' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <select
                  value={ownCat} onChange={e => setOwnCat(e.target.value)}
                  style={{ flexShrink: 0, width: 140, padding: '8px 10px', fontSize: 13, border: '1px solid var(--gray-300)', borderRadius: 6, outline: 'none', fontFamily: 'inherit' }}
                >
                  {Object.entries(CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <textarea
                  value={ownText} onChange={e => setOwnText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addOwn(); }}
                  placeholder="Type your question here… (Ctrl+Enter to add)"
                  style={{ flex: 1, minHeight: '70px', fontSize: '13px', resize: 'vertical' }}
                />
                <button type="button" onClick={addOwn} className="btn btn-primary" style={{ flexShrink: 0, alignSelf: 'flex-end' }}>
                  + Add
                </button>
              </div>
            )}
          </div>

          {/* ── Question list ── */}
          {questions.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '6px' }}>
                <h4 style={{ margin: 0, fontSize: 14, color: 'var(--gray-800)' }}>
                  {questions.length} question{questions.length !== 1 ? 's' : ''} prepared
                </h4>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button className="btn btn-sm btn-secondary" onClick={copyAll}>⌘ Copy</button>
                  <button className="btn btn-sm btn-secondary" onClick={exportWord}>⬇ Export to Word</button>
                  <button className="btn btn-sm btn-primary" onClick={sendPackToHM}>✉ Send Pack to HM</button>
                </div>
              </div>

              {savedTimestamp && (
                <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginBottom: '10px' }}>
                  Last saved: {new Date(savedTimestamp).toLocaleString()}
                </div>
              )}

              {questions.map((q, i) => (
                <div key={i} style={{
                  marginBottom: '10px', padding: '12px',
                  border: '1px solid var(--gray-200)', borderRadius: 8,
                  borderLeft: `3px solid ${CAT_COLOR[q.category] || '#2563eb'}`,
                  background: '#fff',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                    <span style={{
                      flexShrink: 0,
                      background: CAT_BG[q.category] || '#eff6ff',
                      color: CAT_TEXT[q.category] || '#1e40af',
                      border: `1px solid ${CAT_BORDER[q.category] || '#bfdbfe'}`,
                      borderRadius: '12px', padding: '2px 9px',
                      fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                    }}>
                      {q.category}
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-800)', flex: 1 }}>
                      Q{i + 1}: {q.question}
                    </span>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={() => saveToBank(q, i)}
                        disabled={!!savingToBank[i]}
                        title="Add to Question Bank for reuse"
                        style={{
                          padding: '3px 9px', fontSize: 11, fontWeight: 600,
                          color: '#16a34a', background: '#f0fdf4',
                          border: '1px solid #86efac', borderRadius: 5,
                          cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
                        }}
                      >
                        {savingToBank[i] ? '…' : '→ Bank'}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeQuestion(i)}
                        style={{
                          padding: '3px 8px', fontSize: 13, fontWeight: 700,
                          color: 'var(--gray-400)', background: 'transparent',
                          border: 'none', cursor: 'pointer', lineHeight: 1,
                        }}
                      >×</button>
                    </div>
                  </div>
                  {/* Expected answer / model answer — scored against the candidate's
                      answer by the AI. For salary/iqama/notice/location questions it
                      also drives the requirements check. Persisted with the question
                      so it follows the candidate into the Interview Setup tab. */}
                  <div style={{ marginBottom: '6px' }}>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#6b7280', marginBottom: '3px' }}>
                      Expected answer {REQUIREMENT_CATS.includes(q.category) ? '/ requirement' : ''} <span style={{ color: 'var(--gray-400)', fontWeight: 400 }}>(AI scores the candidate against this — optional)</span>
                    </label>
                    <input
                      type="text"
                      value={q.modelAnswer || q.hints || ''}
                      onChange={e => updateQuestionField(i, 'modelAnswer', e.target.value)}
                      placeholder={REQUIREMENT_CATS.includes(q.category) ? 'e.g. Salary ≤ 5000 USD / Iqama transferable / 1-month notice' : 'What a strong answer looks like…'}
                      style={{ width: '100%', fontSize: '12px', padding: '6px 8px', border: '1px solid #dbeafe', borderRadius: 6, outline: 'none', fontFamily: 'inherit', background: '#f8faff' }}
                    />
                  </div>
                  <textarea
                    value={notes[i] || ''}
                    onChange={e => updateNote(i, e.target.value)}
                    placeholder="Interview notes…"
                    style={{ width: '100%', minHeight: '52px', fontSize: '13px' }}
                  />
                </div>
              ))}

              <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--gray-200)' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--gray-800)', marginBottom: '6px' }}>
                  General interview notes
                </label>
                <textarea
                  value={generalNotes}
                  onChange={e => setGeneralNotes(e.target.value)}
                  placeholder="Overall impressions, follow-up items, recommendation…"
                  style={{ width: '100%', minHeight: '90px', fontSize: '13px' }}
                />
              </div>
            </div>
          )}

          {questions.length === 0 && (
            <div style={{
              padding: '20px 16px', background: 'var(--gray-50)',
              border: '1px dashed var(--gray-300)', borderRadius: 8,
              fontSize: '13px', color: 'var(--gray-400)', textAlign: 'center',
              marginBottom: 16,
            }}>
              Use the panel above to add questions from the bank, generate with AI, or write your own.
            </div>
          )}

          {/* ── Meeting details ── */}
          <div style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', padding: '14px' }}>
            <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', color: 'var(--gray-800)' }}>Meeting details</h4>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)', marginBottom: '6px' }}>Platform</label>
              <div role="radiogroup" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {PLATFORMS.map(p => {
                  const sel = meeting.platform === p.value;
                  return (
                    <button
                      type="button" key={p.value} role="radio" aria-checked={sel}
                      onClick={() => updateMeeting('platform', sel ? '' : p.value)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '5px',
                        padding: '5px 11px', borderRadius: 999,
                        border: `1px solid ${sel ? '#2563eb' : 'var(--gray-300)'}`,
                        background: sel ? '#2563eb' : '#fff',
                        color: sel ? '#fff' : 'var(--gray-700)',
                        fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                        transition: 'background-color 140ms, border-color 140ms',
                      }}
                      onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.97)'; }}
                      onMouseUp={e => { e.currentTarget.style.transform = ''; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = ''; if (!sel) e.currentTarget.style.background = '#fff'; }}
                      onMouseEnter={e => { if (!sel) e.currentTarget.style.background = 'var(--gray-100)'; }}
                    >
                      <span aria-hidden="true">{p.icon}</span>{p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)', marginBottom: '4px' }}>Date &amp; time</label>
                <input type="datetime-local" value={meeting.datetime} onChange={e => updateMeeting('datetime', e.target.value)} style={{ width: '100%', padding: '6px', fontSize: '13px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)', marginBottom: '4px' }}>
                  {meeting.platform === 'In person' ? 'Location' : meeting.platform === 'Phone' ? 'Phone number' : 'Meeting link'}
                </label>
                <input type="text" value={meeting.link} onChange={e => updateMeeting('link', e.target.value)}
                  placeholder={meeting.platform === 'In person' ? 'Office room, address…' : meeting.platform === 'Phone' ? '+1 555 555 5555' : 'https://zoom.us/j/…'}
                  style={{ width: '100%', padding: '6px', fontSize: '13px' }} />
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)', marginBottom: '4px' }}>Interviewer(s)</label>
              <input type="text" value={meeting.interviewers} onChange={e => updateMeeting('interviewers', e.target.value)}
                placeholder="e.g. Jane Doe (Engineering Manager), John Smith (Tech Lead)"
                style={{ width: '100%', padding: '6px', fontSize: '13px' }} />
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="modal-footer" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          <button className="btn btn-success" onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? 'Saving…' : '✓ Save to Profile'}
          </button>
          <button className="btn btn-primary" onClick={sendPackToHM}>
            ✉ Send Pack to HM
          </button>
        </div>
      </div>
    </div>
  );
}
