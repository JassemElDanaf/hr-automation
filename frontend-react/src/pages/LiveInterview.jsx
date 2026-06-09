import { useState, useEffect } from 'react';
import { apiGet, apiPost } from '../services/api';
import { useUI } from '../state/uiState';
import { useSelectedJob } from '../state/selectedJob';

const CAT_LABELS = { hr: 'Behavioural', technical: 'Technical', salary: 'Salary', iqama: 'Iqama / Visa', notice: 'Notice Period', location: 'Location' };
const CAT_COLOR  = { hr: '#2563eb', technical: '#16a34a', salary: '#d97706', iqama: '#7c3aed', notice: '#dc2626', location: '#0891b2' };
const CAT_BG     = { hr: '#eff6ff', technical: '#f0fdf4', salary: '#fffbeb', iqama: '#f5f3ff', notice: '#fef2f2', location: '#ecfeff' };

const QBANK_URL = 'http://localhost:5678/webhook/interview/question-bank';

let _nextId = 1;
function emptyQ() { return { id: _nextId++, text: '', category: 'hr', selected: true }; }

export default function LiveInterview() {
  const { showToast } = useUI();
  const { selectedJob } = useSelectedJob();

  // ── Main sub-tab ──
  const [mainTab, setMainTab] = useState('setup'); // 'setup' | 'bank'

  // ── Setup state ──
  const [jobs, setJobs]                   = useState([]);
  const [jobId, setJobId]                 = useState('');
  const [jobTitle, setJobTitle]           = useState('');
  const [candidates, setCandidates]       = useState([]);
  const [evaluationId, setEvaluationId]   = useState('');
  const [candidateId, setCandidateId]     = useState('');
  const [candidateName, setCandidateName] = useState('');
  const [loadingJobs, setLoadingJobs]     = useState(true);
  const [loadingCands, setLoadingCands]   = useState(false);

  const [qMode, setQMode]                 = useState('from-bank');
  const [customQs, setCustomQs]           = useState([emptyQ()]);
  const [generatedQs, setGeneratedQs]     = useState([]);
  const [bankSelectedQs, setBankSelectedQs] = useState([]);
  const [numQ, setNumQ]                   = useState(5);
  const [types, setTypes]                 = useState({ hr: true, technical: true, salary: false });
  const [generating, setGenerating]       = useState(false);
  const [savedQsLoaded, setSavedQsLoaded] = useState(false);
  const [savingToBank, setSavingToBank]   = useState(false);

  const [link, setLink]                   = useState('');
  const [copied, setCopied]               = useState(false);

  // Persist questions to localStorage whenever they change for the current candidate
  useEffect(() => {
    if (!candidateId) return;
    const key = `hr_live_qs_${candidateId}`;
    const snapshot = { qMode, generatedQs, customQs, bankSelectedQs, savedAt: Date.now() };
    try { localStorage.setItem(key, JSON.stringify(snapshot)); } catch {}
  }, [candidateId, qMode, generatedQs, customQs, bankSelectedQs]);

  useEffect(() => { loadJobs(); }, []);

  useEffect(() => {
    if (!selectedJob || jobId || jobs.length === 0) return;
    const match = jobs.find(j => String(j.JobId) === String(selectedJob.id));
    if (match) handleJobChange(String(match.JobId));
  }, [selectedJob, jobs]);

  async function loadJobs() {
    setLoadingJobs(true);
    try { const r = await apiGet('/interview/jobs'); setJobs(r.data || r || []); }
    catch { showToast('Failed to load jobs', 'error'); }
    finally { setLoadingJobs(false); }
  }

  async function handleJobChange(val) {
    setJobId(val); setJobTitle(''); setCandidates([]);
    setEvaluationId(''); setCandidateId(''); setCandidateName('');
    setLink(''); setCopied(false); setSavedQsLoaded(false);
    if (!val) return;
    const j = jobs.find(j => String(j.JobId) === val);
    if (j) setJobTitle(j.job_title);
    setLoadingCands(true);
    try { const r = await apiGet(`/interview/candidates?jobId=${val}`); setCandidates(r.data || r || []); }
    catch { showToast('Failed to load candidates', 'error'); }
    finally { setLoadingCands(false); }
  }

  async function handleCandidateChange(val) {
    setLink(''); setCopied(false);
    const c = candidates.find(c => String(c.CandidateId) === val);
    if (!c) {
      setCandidateId(''); setEvaluationId(''); setCandidateName('');
      setSavedQsLoaded(false);
      return;
    }

    setCandidateId(c.CandidateId);
    setEvaluationId(c.EvaluationId || '');
    setCandidateName(c.FullName);

    // 1️⃣ Restore from localStorage first (instant — survives refresh)
    try {
      const raw = localStorage.getItem(`hr_live_qs_${c.CandidateId}`);
      if (raw) {
        const snap = JSON.parse(raw);
        if (snap.generatedQs?.length || snap.customQs?.length > 1 || snap.bankSelectedQs?.length) {
          if (snap.qMode)           setQMode(snap.qMode);
          if (snap.generatedQs)     setGeneratedQs(snap.generatedQs);
          if (snap.customQs)        setCustomQs(snap.customQs);
          if (snap.bankSelectedQs)  setBankSelectedQs(snap.bankSelectedQs);
          setSavedQsLoaded(true);
          showToast('Questions restored from your last session', 'success');
          return; // skip server fetch — local copy is fresher
        }
      }
    } catch {}

    // 2️⃣ Fallback: fetch saved questions from backend
    setSavedQsLoaded(false);
    if (c.EvaluationId) {
      try {
        const r = await apiGet(`/interview/saved-questions?evaluationId=${c.EvaluationId}`);
        const list = Array.isArray(r) ? r : (r.data || r || []);
        if (list.length > 0) {
          const mapped = list.map(q => ({ id: _nextId++, text: q.Question || q.question || '', category: (q.Category || q.category || 'hr').toLowerCase(), selected: true }));
          setGeneratedQs(mapped);
          setSavedQsLoaded(true);
          showToast(`${list.length} saved questions loaded from previous session`, 'success');
        }
      } catch {}
    }
  }

  async function handleAIGenerate() {
    if (!candidateId) { showToast('Select a candidate first', 'error'); return; }
    if (!Object.values(types).some(Boolean)) { showToast('Pick at least one question type', 'error'); return; }
    setGenerating(true);
    try {
      const res = await apiPost('/generate-interview-questions', {
        candidate_id: parseInt(candidateId),
        job_id: parseInt(jobId),
        num_questions: numQ,
        include_hr: types.hr,
        include_technical: types.technical,
        include_salary: types.salary,
      });
      const data = res.data || res;
      const qs = Array.isArray(data) ? data : (data.questions || []);
      if (!qs.length) { showToast('No questions returned — is Ollama running?', 'error'); return; }
      setGeneratedQs(qs.map(q => ({ id: _nextId++, text: q.question || q.text || '', category: q.category || 'hr', selected: true })));
      showToast(`${qs.length} questions generated`, 'success');
    } catch { showToast('Failed to generate questions', 'error'); }
    finally { setGenerating(false); }
  }

  async function saveGeneratedToBank() {
    const filled = generatedQs.filter(q => q.selected && q.text.trim());
    if (!filled.length) { showToast('No questions selected to save', 'error'); return; }
    setSavingToBank(true);
    try {
      let saved = 0;
      for (const q of filled) {
        await fetch(QBANK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q.text.trim(), category: q.category, jobType: jobTitle || '' }),
        });
        saved++;
      }
      showToast(`${saved} question${saved !== 1 ? 's' : ''} saved to bank`, 'success');
    } catch { showToast('Failed to save to bank', 'error'); }
    finally { setSavingToBank(false); }
  }

  function generateLink() {
    if (!jobId || !candidateId) { showToast('Select a job and candidate first', 'error'); return; }
    const payload = {
      jobId: parseInt(jobId), evaluationId: parseInt(evaluationId),
      candidateId: parseInt(candidateId), candidateName, jobTitle,
    };
    if (qMode === 'from-bank') {
      const filled = bankSelectedQs.filter(q => q.selected && q.text.trim());
      if (filled.length) payload.customQuestions = filled.map(q => ({ question: q.text.trim(), category: q.category }));
      // no questions selected = AI generates live during interview (same as no custom questions)
    } else if (qMode === 'ai-generate') {
      const filled = generatedQs.filter(q => q.selected && q.text.trim());
      if (filled.length) payload.customQuestions = filled.map(q => ({ question: q.text.trim(), category: q.category }));
    } else {
      const filled = customQs.filter(q => q.selected && q.text.trim());
      if (filled.length) payload.customQuestions = filled.map(q => ({ question: q.text.trim(), category: q.category }));
    }
    setLink(`${window.location.origin}/interview/${btoa(unescape(encodeURIComponent(JSON.stringify(payload))))}`);
    setCopied(false);
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { showToast('Failed to copy', 'error'); }
  }

  const isCustom   = qMode === 'custom';
  const isAIGen    = qMode === 'ai-generate';
  const isFromBank = qMode === 'from-bank';
  const activeQs   = isCustom ? customQs : isAIGen ? generatedQs : bankSelectedQs;
  const setActiveQs = isCustom ? setCustomQs : isAIGen ? setGeneratedQs : setBankSelectedQs;
  const addQ       = ()         => setActiveQs(p => [...p, emptyQ()]);
  const removeQ    = id         => setActiveQs(p => p.filter(q => q.id !== id));
  const updateQ    = (id, f, v) => setActiveQs(p => p.map(q => q.id === id ? { ...q, [f]: v } : q));
  const filledCount = activeQs.filter(q => q.selected && q.text.trim()).length;

  return (
    <div className="container">
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--gray-900)' }}>Live Interview</h2>
        <p style={{ fontSize: 14, color: 'var(--gray-500)', marginTop: 4 }}>
          Generate a private interview link for a shortlisted candidate.
        </p>
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid var(--gray-200)' }}>
        {[{ key: 'setup', label: 'Setup' }, { key: 'bank', label: 'Question Bank' }].map(t => (
          <button
            key={t.key}
            onClick={() => setMainTab(t.key)}
            style={{
              padding: '10px 22px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
              color: mainTab === t.key ? '#2563eb' : 'var(--gray-500)',
              borderBottom: mainTab === t.key ? '2px solid #2563eb' : '2px solid transparent',
              marginBottom: -2, transition: 'color 0.15s',
            }}
          >{t.label}</button>
        ))}
      </div>

      {mainTab === 'setup' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Section 1 */}
          <div style={cardStyle}>
            <SectionTitle number={1} title="Select Candidate" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Job Opening</label>
                <select value={jobId} onChange={e => handleJobChange(e.target.value)} disabled={loadingJobs}>
                  <option value="">{loadingJobs ? 'Loading…' : '— Select a job opening —'}</option>
                  {jobs.map(j => (
                    <option key={j.JobId} value={j.JobId}>{j.job_title}{j.department ? ` — ${j.department}` : ''}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Candidate</label>
                <select value={candidateId} onChange={e => handleCandidateChange(e.target.value)} disabled={!jobId || loadingCands}>
                  <option value="">
                    {loadingCands ? 'Loading…' : !jobId ? 'Select a job first' : candidates.length === 0 ? 'No shortlisted candidates' : '— Select a candidate —'}
                  </option>
                  {candidates.map(c => (
                    <option key={c.CandidateId} value={c.CandidateId}>{c.FullName}{c.OverallScore ? ` — Score: ${c.OverallScore}` : ''}</option>
                  ))}
                </select>
              </div>
            </div>
            {candidateName && (
              <div style={{ marginTop: 12, padding: '9px 14px', background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 6, fontSize: 13, color: '#1e40af', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Interviewing <strong>{candidateName}</strong>{jobTitle && <> for <strong>{jobTitle}</strong></>}</span>
                <button
                  onClick={async () => {
                    const win = window.open('about:blank', '_blank');
                    try {
                      const res = await apiGet(`/cv-file?candidate_id=${candidateId}`);
                      const d = res?.data?.data || res?.data || {};
                      if (!d.cv_file_data) { win.close(); showToast('No CV file available', 'error'); return; }
                      const b64 = d.cv_file_data.includes(',') ? d.cv_file_data.split(',')[1] : d.cv_file_data;
                      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
                      const blob = new Blob([bytes], { type: d.cv_file_mime || 'application/pdf' });
                      win.location.href = URL.createObjectURL(blob);
                    } catch { win.close(); showToast('Failed to load CV', 'error'); }
                  }}
                  style={{ fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 6, border: '1px solid #bfdbfe', background: '#fff', color: '#2563eb', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                >
                  📄 View CV
                </button>
              </div>
            )}
          </div>

          {/* Section 2 */}
          <div style={cardStyle}>
            <SectionTitle number={2} title="Interview Questions">
              {savedQsLoaded && (
                <span style={{ marginLeft: 10, padding: '3px 10px', background: '#dcfce7', border: '1px solid #86efac', borderRadius: 12, fontSize: 11, fontWeight: 600, color: '#166534', whiteSpace: 'nowrap' }}>
                  ↩ Saved questions loaded
                </span>
              )}
            </SectionTitle>

            <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
              {[
                { key: 'from-bank',    icon: '📚', label: 'From Question Bank', desc: 'Pick from your saved questions' },
                { key: 'ai-generate',  icon: '✨', label: 'AI Generate',         desc: 'Preview & edit before sending' },
                { key: 'custom',       icon: '✏️',  label: 'Write My Own',        desc: 'Type your own questions'       },
              ].map(m => {
                const active = qMode === m.key;
                return (
                  <button
                    key={m.key}
                    onClick={() => { setQMode(m.key); setLink(''); setCopied(false); }}
                    style={{
                      flex: 1, padding: '16px 12px', cursor: 'pointer', textAlign: 'center',
                      background: '#fff',
                      border: `1.5px solid ${active ? '#2563eb' : 'var(--gray-200)'}`,
                      borderRadius: 10, transition: 'border-color 0.15s', outline: 'none',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    }}
                  >
                    <span style={{ fontSize: 22, lineHeight: 1 }}>{m.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: active ? '#2563eb' : 'var(--gray-700)' }}>{m.label}</span>
                    <span style={{ fontSize: 11, color: 'var(--gray-400)', lineHeight: 1.4 }}>{m.desc}</span>
                  </button>
                );
              })}
            </div>

            {/* From Question Bank */}
            {qMode === 'from-bank' && (
              <BankPicker
                onSelect={qs => setBankSelectedQs(qs)}
                selected={bankSelectedQs}
                onUpdate={updateQ}
                onRemove={removeQ}
                onReorder={setBankSelectedQs}
                onAdd={addQ}
              />
            )}

            {/* AI Generate */}
            {qMode === 'ai-generate' && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr auto auto', gap: 14, alignItems: 'end', marginBottom: 16 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>No. of questions</label>
                    <select value={numQ} onChange={e => setNumQ(Number(e.target.value))}>
                      {[3,4,5,6,7,8,10].map(n => <option key={n} value={n}>{n} questions</option>)}
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>Include types</label>
                    <div style={{ display: 'flex', gap: 20, paddingTop: 9 }}>
                      {['hr','technical','salary'].map(k => (
                        <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: 'var(--gray-700)', userSelect: 'none' }}>
                          <input type="checkbox" checked={!!types[k]} onChange={e => setTypes(p => ({ ...p, [k]: e.target.checked }))} />
                          {CAT_LABELS[k]}
                        </label>
                      ))}
                    </div>
                  </div>
                  <button className="btn btn-primary" onClick={handleAIGenerate} disabled={generating || !candidateId} style={{ whiteSpace: 'nowrap' }}>
                    {generating ? 'Generating…' : 'Generate'}
                  </button>
                  {generatedQs.length > 0 && (
                    <button
                      onClick={saveGeneratedToBank}
                      disabled={savingToBank}
                      style={{ whiteSpace: 'nowrap', padding: '9px 16px', fontSize: 13, fontWeight: 600, color: '#16a34a', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      {savingToBank ? 'Saving…' : '💾 Save to Bank'}
                    </button>
                  )}
                </div>
                {generatedQs.length > 0 && (
                  <QuestionList qs={generatedQs} onAdd={addQ} onRemove={removeQ} onUpdate={updateQ} onReorder={setGeneratedQs} />
                )}
                {generatedQs.length === 0 && (
                  <div style={{ padding: '14px 16px', background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 8, fontSize: 13, color: 'var(--gray-400)', textAlign: 'center' }}>
                    Select a candidate above and click Generate to create questions
                  </div>
                )}
              </div>
            )}

            {/* Write my own */}
            {qMode === 'custom' && (
              <QuestionList qs={customQs} onAdd={addQ} onRemove={removeQ} onUpdate={updateQ} onReorder={setCustomQs} />
            )}
          </div>

          {/* Section 3 */}
          <div style={cardStyle}>
            <SectionTitle number={3} title="Generate & Send" />
            <button
              className="btn btn-primary"
              onClick={generateLink}
              disabled={!jobId || !candidateId}
              style={{ padding: '10px 28px', fontSize: 14 }}
            >
              Generate Interview Link
            </button>

            {link && (
              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text" readOnly value={link} onClick={e => e.target.select()}
                    style={{ flex: 1, fontSize: 12, padding: '9px 12px', border: '1px solid var(--gray-300)', borderRadius: 6, background: 'var(--gray-50)', color: 'var(--gray-800)', fontFamily: 'monospace', outline: 'none', cursor: 'text' }}
                  />
                  <button className={`btn ${copied ? 'btn-secondary' : 'btn-primary'}`} onClick={copyLink} style={{ whiteSpace: 'nowrap', minWidth: 96 }}>
                    {copied ? '✓ Copied!' : 'Copy Link'}
                  </button>
                </div>
                <div style={{ marginTop: 10, padding: '10px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 13, color: '#1e40af', lineHeight: 1.6 }}>
                  <strong>Send this link to {candidateName}.</strong>
                  {filledCount > 0 && <> The AI will ask your <strong>{filledCount} question{filledCount !== 1 ? 's' : ''}</strong> in order.</>}
                  {' '}Results save automatically once they submit.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {mainTab === 'bank' && <QuestionBankTab showToast={showToast} />}
    </div>
  );
}

// ── BankPicker ────────────────────────────────────────────────────────────────

function BankPicker({ onSelect, selected, onUpdate, onRemove, onReorder, onAdd }) {
  const [bank, setBank]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [checked, setChecked]   = useState({});

  useEffect(() => { loadBank(); }, []);

  async function loadBank() {
    setLoading(true);
    try {
      const r = await fetch(QBANK_URL);
      const json = await r.json();
      setBank(Array.isArray(json) ? json : (json.data || json.rows || []));
    } catch { /* silent */ }
    finally { setLoading(false); }
  }

  const cats = ['all', ...Object.keys(CAT_LABELS)];
  const visible = bank.filter(b => {
    const matchCat = catFilter === 'all' || b.category === catFilter;
    const matchSearch = !search || b.question.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  function toggle(id, bankRow) {
    const next = { ...checked, [id]: !checked[id] };
    setChecked(next);
    const newSel = bank
      .filter(b => next[b.id])
      .map(b => ({ id: _nextId++, text: b.question, category: b.category, selected: true, modelAnswer: b.modelAnswer || '' }));
    onSelect(newSel);
  }

  const allVis = visible.length > 0 && visible.every(b => checked[b.id]);

  function toggleAll() {
    const next = { ...checked };
    const val = !allVis;
    visible.forEach(b => { next[b.id] = val; });
    setChecked(next);
    const newSel = bank
      .filter(b => next[b.id])
      .map(b => ({ id: _nextId++, text: b.question, category: b.category, selected: true, modelAnswer: b.modelAnswer || '' }));
    onSelect(newSel);
  }

  const selectedCount = Object.values(checked).filter(Boolean).length;

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text" placeholder="Search questions…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 180, padding: '8px 12px', fontSize: 13, border: '1px solid var(--gray-300)', borderRadius: 6, outline: 'none', fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {cats.map(c => (
            <button
              key={c}
              onClick={() => setCatFilter(c)}
              style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                border: `1px solid ${catFilter === c ? (CAT_COLOR[c] || '#2563eb') : 'var(--gray-200)'}`,
                background: catFilter === c ? (CAT_BG[c] || '#eff6ff') : '#fff',
                color: catFilter === c ? (CAT_COLOR[c] || '#2563eb') : 'var(--gray-500)',
              }}
            >
              {c === 'all' ? 'All' : CAT_LABELS[c]}
            </button>
          ))}
        </div>
      </div>

      {loading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--gray-400)', fontSize: 13 }}>Loading bank…</div>}

      {!loading && bank.length === 0 && (
        <div style={{ padding: '20px', background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 8, fontSize: 13, color: 'var(--gray-400)', textAlign: 'center' }}>
          Your question bank is empty. Go to the <strong>Question Bank</strong> tab to add questions.
        </div>
      )}

      {!loading && bank.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, paddingLeft: 2 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--gray-600)', cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={allVis} onChange={toggleAll} />
              {allVis ? 'Deselect all visible' : 'Select all visible'}
            </label>
            <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>{selectedCount} selected</span>
          </div>
          <div style={{ border: '1px solid var(--gray-200)', borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
            {visible.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 13, color: 'var(--gray-400)' }}>No questions match your filter.</div>
            )}
            {visible.map((b, i) => (
              <div
                key={b.id}
                style={{
                  display: 'grid', gridTemplateColumns: '40px 1fr 110px',
                  borderBottom: i < visible.length - 1 ? '1px solid var(--gray-100)' : 'none',
                  background: checked[b.id] ? '#f8faff' : '#fff',
                  cursor: 'pointer',
                }}
                onClick={() => toggle(b.id, b)}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <input type="checkbox" checked={!!checked[b.id]} onChange={() => toggle(b.id, b)} onClick={e => e.stopPropagation()} style={{ cursor: 'pointer' }} />
                </div>
                <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--gray-900)', lineHeight: 1.5 }}>{b.question}</div>
                <div style={{ display: 'flex', alignItems: 'center', padding: '10px 8px' }}>
                  <span style={{ padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: CAT_BG[b.category] || '#f1f5f9', color: CAT_COLOR[b.category] || '#475569' }}>
                    {CAT_LABELS[b.category] || b.category}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Selected questions edit list */}
      {selected.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-500)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Selected — drag to reorder or edit before sending
          </div>
          <QuestionList qs={selected} onAdd={onAdd} onRemove={onRemove} onUpdate={onUpdate} onReorder={onReorder} />
        </div>
      )}
    </div>
  );
}

// ── QuestionBankTab ───────────────────────────────────────────────────────────

function QuestionBankTab({ showToast }) {
  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [editing, setEditing]   = useState(null);
  const [adding, setAdding]     = useState(false);
  const [form, setForm]         = useState({ question: '', category: 'hr', job_type: '', model_answer: '' });
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => { loadBank(); }, []);

  async function loadBank() {
    setLoading(true);
    try {
      const r = await fetch(QBANK_URL);
      const json = await r.json();
      setRows(Array.isArray(json) ? json : (json.data || json.rows || []));
    } catch { showToast('Failed to load question bank', 'error'); }
    finally { setLoading(false); }
  }

  function startAdd() {
    setForm({ question: '', category: 'hr', job_type: '', model_answer: '' });
    setAdding(true); setEditing(null);
  }

  function startEdit(row) {
    setForm({ question: row.question, category: row.category, job_type: row.jobType || '', model_answer: row.modelAnswer || '' });
    setEditing(row.id); setAdding(false);
  }

  function cancelForm() { setAdding(false); setEditing(null); }

  async function saveForm() {
    if (!form.question.trim()) { showToast('Question text is required', 'error'); return; }
    setSaving(true);
    try {
      if (adding) {
        await fetch(QBANK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: form.question, category: form.category, jobType: form.job_type, modelAnswer: form.model_answer }),
        });
        showToast('Question added', 'success');
      } else {
        await fetch(QBANK_URL, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editing, question: form.question, category: form.category, jobType: form.job_type, modelAnswer: form.model_answer }),
        });
        showToast('Question updated', 'success');
      }
      cancelForm();
      await loadBank();
    } catch { showToast('Failed to save', 'error'); }
    finally { setSaving(false); }
  }

  async function deleteRow(id) {
    if (!window.confirm('Delete this question from the bank?')) return;
    setDeleting(id);
    try {
      await fetch(`${QBANK_URL}?id=${id}`, {
        method: 'DELETE',
      });
      showToast('Question deleted', 'success');
      await loadBank();
    } catch { showToast('Failed to delete', 'error'); }
    finally { setDeleting(null); }
  }

  const cats = ['all', ...Object.keys(CAT_LABELS)];
  const visible = rows.filter(r => {
    const matchCat = catFilter === 'all' || r.category === catFilter;
    const matchSearch = !search || r.question.toLowerCase().includes(search.toLowerCase()) || (r.jobType || '').toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--gray-900)', margin: 0 }}>Question Bank</h3>
          <p style={{ fontSize: 13, color: 'var(--gray-500)', margin: '4px 0 0' }}>Reusable questions you can pick from when setting up an interview.</p>
        </div>
        <button
          onClick={startAdd}
          className="btn btn-primary"
          style={{ whiteSpace: 'nowrap' }}
        >
          + Add Question
        </button>
      </div>

      {/* Add / Edit form */}
      {(adding || editing !== null) && (
        <div style={{ marginBottom: 16, padding: '16px 20px', background: '#f8faff', border: '1.5px solid #bfdbfe', borderRadius: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1e40af', marginBottom: 12 }}>{adding ? 'Add New Question' : 'Edit Question'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 200px', gap: 12, marginBottom: 12 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Question text</label>
              <input
                type="text" value={form.question} onChange={e => setForm(p => ({ ...p, question: e.target.value }))}
                placeholder="Enter your question…"
                style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid var(--gray-300)', borderRadius: 6, outline: 'none', fontFamily: 'inherit' }}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Category</label>
              <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} style={{ width: '100%' }}>
                {Object.keys(CAT_LABELS).map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Job type (optional)</label>
              <input
                type="text" value={form.job_type} onChange={e => setForm(p => ({ ...p, job_type: e.target.value }))}
                placeholder="e.g. Software Engineer"
                style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid var(--gray-300)', borderRadius: 6, outline: 'none', fontFamily: 'inherit' }}
              />
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>Model answer (optional)</label>
            <textarea
              value={form.model_answer} onChange={e => setForm(p => ({ ...p, model_answer: e.target.value }))}
              placeholder="Describe what a good answer looks like…"
              rows={2}
              style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid var(--gray-300)', borderRadius: 6, outline: 'none', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={saveForm} disabled={saving} className="btn btn-primary" style={{ minWidth: 90 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={cancelForm} className="btn btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 160, padding: '8px 12px', fontSize: 13, border: '1px solid var(--gray-300)', borderRadius: 6, outline: 'none', fontFamily: 'inherit' }}
        />
        {cats.map(c => (
          <button
            key={c}
            onClick={() => setCatFilter(c)}
            style={{
              padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              border: `1px solid ${catFilter === c ? (CAT_COLOR[c] || '#2563eb') : 'var(--gray-200)'}`,
              background: catFilter === c ? (CAT_BG[c] || '#eff6ff') : '#fff',
              color: catFilter === c ? (CAT_COLOR[c] || '#2563eb') : 'var(--gray-500)',
            }}
          >
            {c === 'all' ? `All (${rows.length})` : CAT_LABELS[c]}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading && <div style={{ padding: 24, textAlign: 'center', color: 'var(--gray-400)', fontSize: 13 }}>Loading…</div>}

      {!loading && rows.length === 0 && (
        <div style={{ padding: '32px 20px', textAlign: 'center', background: 'var(--gray-50)', border: '1px dashed var(--gray-300)', borderRadius: 10 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📚</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--gray-700)', marginBottom: 6 }}>No questions yet</div>
          <div style={{ fontSize: 13, color: 'var(--gray-400)' }}>Add questions to reuse them across interviews.</div>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div style={{ border: '1px solid var(--gray-200)', borderRadius: 8, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 180px 80px 80px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-200)', padding: '9px 14px', fontSize: 11, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <div>Question</div>
            <div>Category</div>
            <div>Job Type</div>
            <div style={{ textAlign: 'center' }}>Used</div>
            <div style={{ textAlign: 'right' }}>Actions</div>
          </div>
          {visible.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', fontSize: 13, color: 'var(--gray-400)' }}>No questions match your filter.</div>
          )}
          {visible.map((r, i) => (
            <div
              key={r.id}
              style={{
                display: 'grid', gridTemplateColumns: '1fr 120px 180px 80px 80px',
                borderBottom: i < visible.length - 1 ? '1px solid var(--gray-100)' : 'none',
                padding: '11px 14px', alignItems: 'center',
                background: editing === r.id ? '#f8faff' : '#fff',
              }}
            >
              <div style={{ fontSize: 13, color: 'var(--gray-900)', lineHeight: 1.4, paddingRight: 12 }}>{r.question}</div>
              <div>
                <span style={{ padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: CAT_BG[r.category] || '#f1f5f9', color: CAT_COLOR[r.category] || '#475569' }}>
                  {CAT_LABELS[r.category] || r.category}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>{r.jobType || '—'}</div>
              <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--gray-400)' }}>{r.timesUsed || 0}</div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => startEdit(r)}
                  style={{ padding: '4px 10px', fontSize: 12, fontWeight: 600, color: '#2563eb', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' }}
                >Edit</button>
                <button
                  onClick={() => deleteRow(r.id)}
                  disabled={deleting === r.id}
                  style={{ padding: '4px 10px', fontSize: 12, fontWeight: 600, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' }}
                >{deleting === r.id ? '…' : 'Delete'}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shared components ─────────────────────────────────────────────────────────

const cardStyle = {
  background: '#fff',
  border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius)',
  padding: '24px 28px',
};

function SectionTitle({ number, title, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
      <span style={{ width: 24, height: 24, borderRadius: '50%', background: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {number}
      </span>
      <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--gray-800)' }}>{title}</span>
      {children}
    </div>
  );
}

function QuestionList({ qs, onAdd, onRemove, onUpdate, onReorder }) {
  const allSelected = qs.every(q => q.selected);
  const someSelected = qs.some(q => q.selected);
  function toggleAll() { qs.forEach(q => onUpdate(q.id, 'selected', !allSelected)); }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, paddingLeft: 2 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--gray-600)', cursor: 'pointer', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={allSelected}
            ref={el => { if (el) el.indeterminate = !allSelected && someSelected; }}
            onChange={toggleAll}
          />
          {allSelected ? 'Deselect all' : 'Select all'}
        </label>
        <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>
          {qs.filter(q => q.selected).length} of {qs.length} selected
        </span>
      </div>

      <div style={{ border: '1px solid var(--gray-200)', borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
        {qs.map((q, i) => (
          <div
            key={q.id}
            style={{
              borderBottom: i < qs.length - 1 ? '1px solid var(--gray-100)' : 'none',
              background: q.selected ? '#fff' : 'var(--gray-50)',
              opacity: q.selected ? 1 : 0.55,
              transition: 'opacity 0.15s, background 0.15s',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '36px 36px 1fr 110px 32px 24px 24px 36px', alignItems: 'center', gap: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <input type="checkbox" checked={!!q.selected} onChange={e => onUpdate(q.id, 'selected', e.target.checked)} style={{ cursor: 'pointer' }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-400)', textAlign: 'center' }}>{i + 1}</span>
              <input
                type="text"
                placeholder={`Question ${i + 1}…`}
                value={q.text}
                onChange={e => onUpdate(q.id, 'text', e.target.value)}
                style={{
                  padding: '11px 12px', border: 'none', borderLeft: '1px solid var(--gray-100)',
                  borderRight: '1px solid var(--gray-100)',
                  fontSize: 13, color: 'var(--gray-900)', outline: 'none',
                  fontFamily: 'inherit', background: 'transparent', width: '100%',
                }}
              />
              <select
                value={q.category}
                onChange={e => onUpdate(q.id, 'category', e.target.value)}
                style={{
                  padding: '11px 10px', border: 'none', borderRight: '1px solid var(--gray-100)',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', outline: 'none',
                  background: CAT_BG[q.category], color: CAT_COLOR[q.category],
                  width: '100%', height: '100%',
                }}
              >
                {Object.keys(CAT_LABELS).map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
              </select>
              <button
                onClick={() => onUpdate(q.id, 'showRubric', !q.showRubric)}
                title={q.showRubric ? 'Hide expected answer' : 'Add expected answer'}
                style={{
                  width: '100%', height: '100%', border: 'none', borderRight: '1px solid var(--gray-100)',
                  background: q.showRubric ? '#eff6ff' : 'transparent',
                  color: q.showRubric ? '#2563eb' : 'var(--gray-300)',
                  cursor: 'pointer', fontSize: 13,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >📝</button>
              <button
                onClick={() => {
                  if (i === 0) return;
                  const arr = [...qs];
                  [arr[i-1], arr[i]] = [arr[i], arr[i-1]];
                  onReorder(arr);
                }}
                disabled={i === 0}
                title="Move up"
                style={{ border: 'none', background: 'transparent', color: i === 0 ? 'var(--gray-200)' : 'var(--gray-400)', cursor: i === 0 ? 'default' : 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}
              >▲</button>
              <button
                onClick={() => {
                  if (i === qs.length - 1) return;
                  const arr = [...qs];
                  [arr[i+1], arr[i]] = [arr[i], arr[i+1]];
                  onReorder(arr);
                }}
                disabled={i === qs.length - 1}
                title="Move down"
                style={{ border: 'none', background: 'transparent', color: i === qs.length - 1 ? 'var(--gray-200)' : 'var(--gray-400)', cursor: i === qs.length - 1 ? 'default' : 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', borderRight: '1px solid var(--gray-100)' }}
              >▼</button>
              <button
                onClick={() => onRemove(q.id)}
                disabled={qs.length === 1}
                style={{
                  width: '100%', height: '100%', border: 'none', background: 'transparent',
                  color: qs.length === 1 ? 'var(--gray-200)' : 'var(--gray-400)',
                  cursor: qs.length === 1 ? 'not-allowed' : 'pointer', fontSize: 18,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >×</button>
            </div>
            {q.showRubric && (
              <div style={{ padding: '8px 12px 10px 108px', borderTop: '1px solid #dbeafe', background: '#f8faff' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>Expected answer / rubric</div>
                <textarea
                  placeholder="Describe what a good answer looks like. The AI will score the candidate against this."
                  value={q.modelAnswer || ''}
                  onChange={e => onUpdate(q.id, 'modelAnswer', e.target.value)}
                  rows={2}
                  style={{
                    width: '100%', fontSize: 12, color: '#374151', padding: '7px 10px',
                    border: '1px solid #dbeafe', borderRadius: 6, outline: 'none',
                    fontFamily: 'inherit', resize: 'vertical', background: '#fff', lineHeight: 1.6,
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={onAdd}
        style={{ width: '100%', padding: '8px', fontSize: 13, color: '#2563eb', background: '#fff', border: '1px dashed #bfdbfe', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}
      >
        + Add question
      </button>
    </div>
  );
}
