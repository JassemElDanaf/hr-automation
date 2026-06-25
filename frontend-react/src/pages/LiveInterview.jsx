import { useState, useEffect, useRef, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../services/api';
import { useEvalStatus } from '../state/evalStatus';
import { useUI } from '../state/uiState';
import { useSelectedJob } from '../state/selectedJob';
import { scoreColor } from '../utils/helpers';
import EmptyState from '../components/common/EmptyState';
import StickyContinue from '../components/common/StickyContinue';
import PdfPreview from '../components/common/PdfPreview';
import AIInterviews from './AIInterviews';

// Phones can't render a PDF in an <iframe> — use the canvas preview there.
const IS_MOBILE = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;

const CAT_LABELS = { hr: 'Behavioural', technical: 'Technical', salary: 'Salary', iqama: 'Iqama / Visa', notice: 'Notice Period', location: 'Location' };
const CAT_COLOR  = { hr: '#2563eb', technical: '#16a34a', salary: '#d97706', iqama: '#7c3aed', notice: '#dc2626', location: '#0891b2' };
const CAT_BG     = { hr: '#eff6ff', technical: '#f0fdf4', salary: '#fffbeb', iqama: '#f5f3ff', notice: '#fef2f2', location: '#ecfeff' };

// Source of each question in the combined interview set (where the user picked it).
const SRC_LABEL = { bank: '📚 Bank', ai: '✨ AI', custom: '✏️ Custom' };
const SRC_BG    = { bank: '#eff6ff', ai: '#f5f3ff', custom: '#fff7ed' };
const SRC_COLOR = { bank: '#2563eb', ai: '#7c3aed', custom: '#c2410c' };

const API_BASE  = import.meta.env.VITE_API_URL || '/webhook';
const QBANK_URL = `${API_BASE}/interview/question-bank`;

// URL-safe base64: plain btoa() output contains '/' which splits the URL path,
// so the /interview/:token route silently stops matching. '-' and '_' replace
// '+' and '/', padding is dropped (decodeToken restores all three).
function encodeInterviewToken(payload) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let _nextId = 1;
function emptyQ() { return { id: _nextId++, text: '', category: 'hr', selected: true }; }

export default function LiveInterview() {
  const navigate = useNavigate();
  const { showToast } = useUI();
  const { selectedJob } = useSelectedJob();
  const { runAiTask } = useEvalStatus();

  // ── Main steps ── ('candidate' | 'questions' | 'results'; 'bank' is an
  // off-stepper management view reached from the Interview Questions step)
  // ?tab=results deep-links to Results (used by the old /ai-interviews redirect)
  const [mainTab, setMainTab] = useState(() =>
    new URLSearchParams(window.location.search).get('tab') === 'results' ? 'results' : 'candidate'
  );

  // ── Setup state ──
  const [jobs, setJobs]                   = useState([]);
  const [jobId, setJobId]                 = useState('');
  const [jobTitle, setJobTitle]           = useState('');
  const [candidates, setCandidates]       = useState([]);
  const [interviewedIds, setInterviewedIds] = useState(new Set()); // CandidateIds with a completed session
  const [evaluationId, setEvaluationId]   = useState('');
  const [candidateId, setCandidateId]     = useState('');
  const [cvPanel, setCvPanel]             = useState({ open: false, url: '', loading: false }); // inline CV viewer
  const [candidateName, setCandidateName] = useState('');
  const [loadingJobs, setLoadingJobs]     = useState(true);
  const [loadingCands, setLoadingCands]   = useState(false);
  const continueAnchorRef                 = useRef(null); // floating Continue hides when this inline one is in view

  const [qMode, setQMode]                 = useState('from-bank');
  const [customQs, setCustomQs]           = useState([]);
  const [generatedQs, setGeneratedQs]     = useState([]);
  const [bankSelectedQs, setBankSelectedQs] = useState([]);
  const [aiTopic, setAiTopic] = useState('');
  const [customDraft, setCustomDraft]     = useState('');   // "Write My Own" type-and-add box
  const [customCat, setCustomCat]         = useState('hr');
  const [numQ, setNumQ]                   = useState(5);
  const [types, setTypes]                 = useState({ hr: true, technical: true, salary: false });
  const [generating, setGenerating]       = useState(false);
  const [savedQsLoaded, setSavedQsLoaded] = useState(false);
  const [savingToBank, setSavingToBank]   = useState(false);
  const [pendingPrep, setPendingPrep]     = useState(null); // { candidateId, questions }

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

  // Deep-link from the Shortlist "Set Up Interview" button:
  // /live-interview?setupCandidate=<id>&setupJob=<id> — open Setup, load the
  // job, then queue the candidate so the pendingPrep effect below auto-selects
  // them once candidates load. Applied once; the URL is then cleaned.
  const setupAppliedRef = useRef(false);
  useEffect(() => {
    if (setupAppliedRef.current || jobs.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const setupCand = params.get('setupCandidate');
    const setupJob = params.get('setupJob');
    if (!setupCand) return;
    setupAppliedRef.current = true;
    // "Set Up Interview" jumps straight to step 2 (Interview Questions) — the
    // candidate is auto-selected below via pendingPrep.
    setMainTab('questions');
    if (setupJob) handleJobChange(String(setupJob));
    setPendingPrep({ candidateId: setupCand, questions: [] });
    window.history.replaceState({}, '', '/live-interview');
  }, [jobs]);

  // When candidates load and there's a pending prep auto-select, apply it
  useEffect(() => {
    if (!pendingPrep || candidates.length === 0) return;
    const c = candidates.find(c => String(c.CandidateId) === String(pendingPrep.candidateId));
    if (!c) return;
    setCandidateId(String(c.CandidateId));
    setCandidateName(c.FullName);
    setEvaluationId(c.EvaluationId || '');
    if (pendingPrep.questions?.length) {
      setGeneratedQs(pendingPrep.questions.map(q => ({ id: _nextId++, text: q.question || q.text || '', category: q.category || 'hr', selected: true })));
      setQMode('ai-generate');
      setSavedQsLoaded(true);
      showToast(`${pendingPrep.questions.length} prepared questions loaded`, 'success');
    } else {
      // No questions passed in (e.g. returning via the indicator after AI
      // generation) — restore whatever was last built for this candidate.
      try {
        const snap = JSON.parse(localStorage.getItem(`hr_live_qs_${c.CandidateId}`) || 'null');
        if (snap && (snap.generatedQs?.length || snap.customQs?.length || snap.bankSelectedQs?.length)) {
          if (snap.qMode)          setQMode(snap.qMode);
          if (snap.generatedQs)    setGeneratedQs(snap.generatedQs);
          if (snap.customQs)       setCustomQs(snap.customQs);
          if (snap.bankSelectedQs) setBankSelectedQs(snap.bankSelectedQs);
          setSavedQsLoaded(true);
          showToast('Questions restored from your last session', 'success');
        }
      } catch {}
    }
    setPendingPrep(null);
  }, [candidates, pendingPrep]);

  // Follow the global job picked in the header (applies universally across tabs).
  useEffect(() => {
    if (!selectedJob || jobs.length === 0 || String(selectedJob.id) === String(jobId)) return;
    const match = jobs.find(j => String(j.JobId) === String(selectedJob.id));
    if (match) handleJobChange(String(match.JobId));
  }, [selectedJob, jobs]);

  // Restore the last-worked candidate when returning to this tab (navigating
  // away and back). Skips if a candidate is already selected or a deep-link
  // (pendingPrep) is about to pick one.
  useEffect(() => {
    if (candidateId || pendingPrep || candidates.length === 0 || !jobId) return;
    let last;
    try { last = localStorage.getItem(`hr_live_last_cand_${jobId}`); } catch {}
    if (last && candidates.some(c => String(c.CandidateId) === String(last))) {
      handleCandidateChange(String(last), { silent: true });
    }
  }, [candidates, jobId]);

  async function loadJobs() {
    setLoadingJobs(true);
    try { const r = await apiGet('/interview/jobs'); setJobs(r.data || r || []); }
    catch { showToast('Failed to load jobs', 'error'); }
    finally { setLoadingJobs(false); }
  }

  async function handleJobChange(val) {
    setJobId(val); setJobTitle(''); setCandidates([]); setInterviewedIds(new Set());
    setEvaluationId(''); setCandidateId(''); setCandidateName('');
    setLink(''); setCopied(false); setSavedQsLoaded(false);
    if (!val) return;
    const j = jobs.find(j => String(j.JobId) === val);
    if (j) setJobTitle(j.job_title);
    setLoadingCands(true);
    try {
      // Load candidates + which of them already completed the AI interview, so
      // the picker can flag/sort them (still selectable for a deliberate redo).
      const [r, sess] = await Promise.all([
        apiGet(`/interview/candidates?jobId=${val}`),
        apiGet(`/interview/sessions?jobId=${val}`).catch(() => []),
      ]);
      setCandidates(r.data || r || []);
      const sessList = Array.isArray(sess) ? sess : (sess.data || []);
      setInterviewedIds(new Set(sessList.map(s => String(s.candidateId))));
    }
    catch { showToast('Failed to load candidates', 'error'); }
    finally { setLoadingCands(false); }
  }

  // Toggle the inline CV viewer (expands the PDF on this page, no new tab).
  async function toggleCv() {
    if (cvPanel.open) { setCvPanel(p => ({ ...p, open: false })); return; }
    if (cvPanel.url) { setCvPanel(p => ({ ...p, open: true })); return; }
    setCvPanel({ open: false, url: '', loading: true });
    try {
      const res = await apiGet(`/cv-file?candidate_id=${candidateId}`);
      const d = res?.data?.data || res?.data || {};
      if (!d.cv_file_data) { showToast('No CV file available', 'error'); setCvPanel({ open: false, url: '', loading: false }); return; }
      const b64 = d.cv_file_data.includes(',') ? d.cv_file_data.split(',')[1] : d.cv_file_data;
      const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: d.cv_file_mime || 'application/pdf' }));
      setCvPanel({ open: true, url, loading: false });
    } catch { showToast('Failed to load CV', 'error'); setCvPanel({ open: false, url: '', loading: false }); }
  }

  async function handleCandidateChange(val, { silent = false } = {}) {
    setLink(''); setCopied(false);
    setCvPanel({ open: false, url: '', loading: false });
    const c = candidates.find(c => String(c.CandidateId) === val);
    if (!c) {
      setCandidateId(''); setEvaluationId(''); setCandidateName('');
      setSavedQsLoaded(false);
      return;
    }

    setCandidateId(c.CandidateId);
    setEvaluationId(c.EvaluationId || '');
    setCandidateName(c.FullName);
    // Remember the last candidate per job so returning to this tab keeps them.
    try { localStorage.setItem(`hr_live_last_cand_${jobId}`, String(c.CandidateId)); } catch {}

    // 1️⃣ Restore from localStorage first (instant — survives refresh)
    try {
      const raw = localStorage.getItem(`hr_live_qs_${c.CandidateId}`);
      if (raw) {
        const snap = JSON.parse(raw);
        if (snap.generatedQs?.length || snap.customQs?.length || snap.bankSelectedQs?.length) {
          if (snap.qMode)           setQMode(snap.qMode);
          if (snap.generatedQs)     setGeneratedQs(snap.generatedQs);
          if (snap.customQs)        setCustomQs(snap.customQs);
          if (snap.bankSelectedQs)  setBankSelectedQs(snap.bankSelectedQs);
          setSavedQsLoaded(true);
          if (!silent) showToast('Questions restored from your last session', 'success');
          return; // skip server fetch — local copy is fresher
        }
      }
    } catch {}

    // 2️⃣ Fallback: fetch saved prep from candidate_prepared_questions (written
    // by "Save to Profile" in the interview-prep modal). The old source —
    // /interview/saved-questions over the interview_questions table — was never
    // written to by any workflow, so it always returned [].
    setSavedQsLoaded(false);
    if (jobId) {
      try {
        const r = await apiGet(`/candidate-questions?candidate_id=${c.CandidateId}&job_id=${jobId}`);
        const row = r?.data || r || {};
        const list = Array.isArray(row.questions) ? row.questions : [];
        if (list.length > 0) {
          const mapped = list.map(q => ({ id: _nextId++, text: q.question || q.text || '', category: (q.category || 'hr').toLowerCase(), selected: true, modelAnswer: q.modelAnswer || '' }));
          setGeneratedQs(mapped);
          setQMode('ai-generate');
          setSavedQsLoaded(true);
          if (!silent) showToast(`${list.length} saved questions loaded from candidate profile`, 'success');
        }
      } catch {}
    }
  }

  async function handleAIGenerate() {
    if (!candidateId) { showToast('Select a candidate first', 'error'); return; }
    if (!Object.values(types).some(Boolean)) { showToast('Pick at least one question type', 'error'); return; }
    setGenerating(true);
    try {
      const res = await runAiTask('Generating interview questions…', () => apiPost('/generate-interview-questions', {
        candidate_id: parseInt(candidateId),
        job_id: parseInt(jobId),
        num_questions: numQ,
        include_hr: types.hr,
        include_technical: types.technical,
        include_salary: types.salary,
      }), { to: `/live-interview?setupCandidate=${candidateId}&setupJob=${jobId}`, hint: candidateName ? `Back to ${candidateName}` : 'Back to Interview Setup' });
      const data = res.data || res;
      const qs = Array.isArray(data) ? data : (data.questions || []);
      if (!qs.length) { showToast('No questions returned — is Ollama running?', 'error'); return; }
      const mapped = qs.map(q => ({ id: _nextId++, text: q.question || q.text || '', category: q.category || 'hr', selected: true }));
      setGeneratedQs(mapped);
      // Persist directly (not only via the mount-time effect) so the questions
      // survive even if the user navigated away during generation.
      try {
        localStorage.setItem(`hr_live_qs_${candidateId}`, JSON.stringify({
          qMode: 'ai-generate', generatedQs: mapped, customQs, bankSelectedQs, savedAt: Date.now(),
        }));
      } catch {}
      showToast(`${qs.length} questions generated`, 'success');
    } catch { showToast('Failed to generate questions', 'error'); }
    finally { setGenerating(false); }
  }

  // Tailored single-question generation: type a topic, the local model writes the
  // question. Calls Ollama directly (CORS allowed for the app origin in start.sh).
  async function generateFromTopic() {
    const topic = aiTopic.trim();
    if (!topic) { showToast('Type a topic first — e.g. "AWS experience"', 'error'); return; }
    try {
      const text = await runAiTask('Generating a tailored question…', async () => {
        const r = await fetch('http://localhost:11434/api/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'qwen3:4b', stream: false, think: false,
            prompt: `You are a job interviewer. Write exactly ONE clear, professional interview question that asks the candidate about: "${topic}". Return ONLY the question text — no preamble, no quotes, no explanation.`,
          }),
        });
        const j = await r.json();
        let out = (j.response || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        out = (out.split('\n').map(s => s.trim()).filter(Boolean).pop() || '').replace(/^["'“”]+|["'“”]+$/g, '').trim();
        return out;
      }, { to: `/live-interview?setupCandidate=${candidateId}&setupJob=${jobId}`, hint: candidateName ? `Back to ${candidateName}` : 'Back to Interview Setup' });
      if (!text) { showToast('No question returned — is Ollama running?', 'error'); return; }
      setGeneratedQs(p => [...p, { id: _nextId++, text, category: 'technical', selected: true }]);
      setAiTopic('');
      showToast('Tailored question added', 'success');
    } catch { showToast('Failed to generate — is Ollama running?', 'error'); }
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
    // modelAnswer must travel with each question — the IntEval node scores
    // against it (rubric) and extracts requirements from it. Dropping it here
    // silently disables both features.
    const toPayloadQ = q => ({ question: q.text.trim(), category: q.category, modelAnswer: (q.modelAnswer || '').trim() });
    // The interview set mixes bank + AI + custom; dedup by text here (the live list
    // stays un-deduped so editing is stable). No questions at all = the AI
    // generates them live during the interview.
    const seen = new Set();
    const filled = combinedQuestions().filter(q => {
      const k = q.text.trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k); return true;
    });
    if (filled.length) payload.customQuestions = filled.map(toPayloadQ);
    // The link origin must be reachable by the candidate. Default to wherever
    // HR opened the app (generate from the tunnel URL for remote candidates);
    // VITE_PUBLIC_URL in .env overrides it for a stable public address.
    const origin = (import.meta.env.VITE_PUBLIC_URL || window.location.origin).replace(/\/$/, '');
    const url = `${origin}/interview/${encodeInterviewToken(payload)}`;
    setLink(url);
    setCopied(false);
    // Stash the link per-candidate so the Shortlist "Interview Invite" email can
    // auto-fill it — HR generates here, then sends the invite from Shortlist.
    try { localStorage.setItem(`hr_interview_link_${candidateId}`, url); } catch {}
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { showToast('Failed to copy', 'error'); }
  }

  // ── Interview-set helpers ──
  // Each source owns its own state array; the interview set is simply their concat,
  // every item tagged with where it came from. We DON'T dedup here so inline editing
  // stays stable — dedup happens once in generateLink against the final text.
  function combinedQuestions() {
    const out = [];
    for (const [source, list] of [['bank', bankSelectedQs], ['ai', generatedQs], ['custom', customQs]]) {
      for (const q of list) out.push({ ...q, source });   // keep empties so inline editing is stable
    }
    return out;
  }
  const setterFor = src => src === 'bank' ? setBankSelectedQs : src === 'ai' ? setGeneratedQs : setCustomQs;
  // Edit / remove one question in whichever source array owns it — so the single
  // "Interview set" list below is the one place questions are managed.
  const updateCombined = (q, field, value) => setterFor(q.source)(p => p.map(x => x.id === q.id ? { ...x, [field]: value } : x));
  const removeCombined = q => setterFor(q.source)(p => p.filter(x => x.id !== q.id));
  // "Write My Own" is now a type-and-add box that appends straight to the set.
  function addCustomQuestion() {
    const t = customDraft.trim();
    if (!t) return;
    setCustomQs(p => [...p, { id: _nextId++, text: t, category: customCat, selected: true }]);
    setCustomDraft('');
  }
  const combined    = combinedQuestions();
  const bankCount   = combined.filter(q => q.source === 'bank').length;
  const genCount    = combined.filter(q => q.source === 'ai').length;
  const customCount = combined.filter(q => q.source === 'custom').length;
  const filledCount = combined.length;

  return (
    <div className="container tab-fade-in">
      {/* Numbered stepper (CV-Evaluation style) */}
      <div className="wizard-steps">
        {[{ key: 'candidate', label: 'Select Candidate' }, { key: 'questions', label: 'Interview Questions' }, { key: 'results', label: 'Results' }].map((t, i) => {
          const active = mainTab === t.key || (mainTab === 'bank' && t.key === 'questions');
          return (
            <div key={t.key} style={{ display: 'contents' }}>
              <div className={`wizard-step ${active ? 'active' : ''}`} onClick={() => setMainTab(t.key)}>
                <span className="step-num">{i + 1}</span> {t.label}
              </div>
              {i < 2 && <div className="wizard-connector"></div>}
            </div>
          );
        })}
      </div>

      {mainTab === 'candidate' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Select Candidate — card grid, mirroring CV Evaluation's Select Job */}
          <div style={cardStyle}>
            {!jobId ? (
              <EmptyState>Pick a job from the “Current Job” selector at the top.</EmptyState>
            ) : loadingCands ? (
              <EmptyState>Loading candidates…</EmptyState>
            ) : candidates.length === 0 ? (
              <EmptyState>No shortlisted candidates for this job yet.</EmptyState>
            ) : (
              <div className="job-card-grid">
                {[...candidates]
                  .sort((a, b) => (interviewedIds.has(String(a.CandidateId)) ? 1 : 0) - (interviewedIds.has(String(b.CandidateId)) ? 1 : 0))
                  .map(c => {
                    const done = interviewedIds.has(String(c.CandidateId));
                    const sel = String(candidateId) === String(c.CandidateId);
                    return (
                      <Fragment key={c.CandidateId}>
                        <div className={`job-card ${sel ? 'selected' : ''}`} onClick={() => handleCandidateChange(String(c.CandidateId))}>
                          <div className="job-card-title">{c.FullName}</div>
                          <div className="job-card-meta">
                            {c.OverallScore != null && <span style={{ fontWeight: 700, color: scoreColor(c.OverallScore) }}>CV {parseFloat(c.OverallScore).toFixed(1)}</span>}
                            {done && <span className="dot" style={{ color: '#166534', fontWeight: 600 }}>✓ Interviewed</span>}
                          </div>
                          {(c.Email || c.email) && <div className="job-card-stats"><span>{c.Email || c.email}</span></div>}
                        </div>
                        {/* Selected-candidate context appears RIGHT UNDER its card (spans
                            the full grid width), above the remaining candidates. */}
                        {sel && candidateName && (
                          <div style={{ gridColumn: '1 / -1' }}>
                            {interviewedIds.has(String(candidateId)) && (
                              <div style={{ marginBottom: 10, padding: '9px 14px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, fontSize: 12.5, color: '#92400e' }}>
                                ⚠️ <strong>{candidateName}</strong> already completed an interview — see the <strong>Results</strong> step. Generating a new link will let them interview again.
                              </div>
                            )}
                            <div style={{ padding: '9px 14px', background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 6, fontSize: 13, color: '#1e40af', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                              <span>Interviewing <strong>{candidateName}</strong>{jobTitle && <> for <strong>{jobTitle}</strong></>}</span>
                              <button onClick={toggleCv}
                                style={{ fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 6, border: '1px solid #bfdbfe', background: 'var(--surface)', color: '#2563eb', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                                📄 {cvPanel.open ? 'Hide CV' : cvPanel.loading ? 'Loading…' : 'View CV'}
                              </button>
                            </div>
                            {cvPanel.open && cvPanel.url && (
                              <div style={{ marginTop: 10, border: '1px solid var(--gray-200)', borderRadius: 8, overflow: 'hidden' }}>
                                <div style={{ display: 'flex', gap: 14, justifyContent: 'flex-end', padding: '6px 10px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-200)' }}>
                                  <a href={cvPanel.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 600, color: '#2563eb', textDecoration: 'none' }}>Open ↗</a>
                                  <a href={cvPanel.url} download={`${candidateName || 'candidate'}-CV.pdf`} style={{ fontSize: 12, fontWeight: 600, color: '#2563eb', textDecoration: 'none' }}>⤓ Download</a>
                                </div>
                                {IS_MOBILE
                                  ? <PdfPreview url={cvPanel.url} />
                                  : <iframe title="Candidate CV" src={cvPanel.url} style={{ width: '100%', height: 600, border: 'none', display: 'block' }} />}
                              </div>
                            )}
                          </div>
                        )}
                      </Fragment>
                    );
                  })}
              </div>
            )}
          </div>

          {candidateName && (
            <div className="wizard-footer">
              <span className="step-info">Step 1 of 3</span>
              <button ref={continueAnchorRef} className="btn btn-primary" onClick={() => setMainTab('questions')}>Continue to Interview Questions →</button>
            </div>
          )}
          <StickyContinue
            show={!!candidateName}
            anchorRef={continueAnchorRef}
            label="Continue to Interview Questions"
            onClick={() => setMainTab('questions')}
          />
        </div>
      )}

      {mainTab === 'questions' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Interview Questions */}
          <div style={cardStyle}>
            {candidateName ? (
              <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--gray-500)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span>Questions for <strong style={{ color: 'var(--gray-900)' }}>{candidateName}</strong>{jobTitle && <> · {jobTitle}</>}</span>
                {savedQsLoaded && (
                  <span style={{ padding: '3px 10px', background: '#dcfce7', border: '1px solid #86efac', borderRadius: 12, fontSize: 11, fontWeight: 600, color: '#166534', whiteSpace: 'nowrap' }}>↩ Saved questions loaded</span>
                )}
                <button className="btn btn-secondary btn-sm" onClick={() => setMainTab('bank')} title="Add, edit or remove saved questions" style={{ marginLeft: 'auto' }}>⚙ Manage bank</button>
              </div>
            ) : (
              <div style={{ marginBottom: 14, padding: '9px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, fontSize: 12.5, color: '#92400e', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>No candidate selected yet — the link is personalised to one candidate.</span>
                <button className="btn btn-sm btn-secondary" onClick={() => setMainTab('candidate')}>← Select candidate</button>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
              {[
                { key: 'from-bank',    icon: '📚', label: 'From Question Bank' },
                { key: 'ai-generate',  icon: '✨', label: 'AI Generate'         },
                { key: 'custom',       icon: '✏️',  label: 'Write My Own'        },
              ].map(m => {
                const active = qMode === m.key;
                return (
                  <button
                    key={m.key}
                    onClick={() => { setQMode(m.key); setLink(''); setCopied(false); }}
                    style={{
                      flex: 1, padding: '16px 12px', cursor: 'pointer', textAlign: 'center',
                      background: 'var(--surface)',
                      border: `1.5px solid ${active ? '#2563eb' : 'var(--gray-200)'}`,
                      borderRadius: 10, transition: 'border-color 0.15s', outline: 'none',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    }}
                  >
                    <span style={{ fontSize: 22, lineHeight: 1 }}>{m.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: active ? '#2563eb' : 'var(--gray-700)' }}>{m.label}</span>
                  </button>
                );
              })}
            </div>

            {/* All three source panels stay MOUNTED — we just toggle visibility with
                `display`. Switching tabs is then a pure CSS flip (instant, smooth)
                instead of unmounting/remounting: the Bank panel no longer refetches
                the question bank on every switch, and checkbox state is preserved. */}

            {/* From Question Bank — checkbox catalog only (controlled by the set) */}
            <div style={{ display: qMode === 'from-bank' ? 'block' : 'none' }}>
              <BankPicker onSelect={setBankSelectedQs} selected={bankSelectedQs} />
            </div>

            {/* AI Generate — controls only; results land in the set below */}
            <div style={{ display: qMode === 'ai-generate' ? 'block' : 'none' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr auto auto', gap: 14, alignItems: 'end', marginBottom: 14 }}>
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
                {genCount > 0 && (
                  <button
                    onClick={saveGeneratedToBank}
                    disabled={savingToBank}
                    style={{ whiteSpace: 'nowrap', padding: '9px 16px', fontSize: 13, fontWeight: 600, color: '#16a34a', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    {savingToBank ? 'Saving…' : '💾 Save to Bank'}
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input value={aiTopic} onChange={e => setAiTopic(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') generateFromTopic(); }}
                  placeholder={'Tailor a question — type a topic, e.g. "AWS experience"'}
                  style={{ flex: 1, padding: '9px 12px', fontSize: 13.5, border: '1px solid var(--gray-300)', borderRadius: 8, outline: 'none', background: 'var(--surface)', color: 'var(--gray-800)', fontFamily: 'inherit' }} />
                <button className="btn btn-secondary btn-sm" onClick={generateFromTopic} disabled={!aiTopic.trim()} style={{ whiteSpace: 'nowrap' }}>✨ Generate from topic</button>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--gray-400)' }}>
                Generated questions are added to the interview set below — edit or remove them there.
              </div>
            </div>

            {/* Write My Own — type-and-add box; questions append to the set below */}
            <div style={{ display: qMode === 'custom' ? 'block' : 'none' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                <input
                  value={customDraft}
                  onChange={e => setCustomDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addCustomQuestion(); }}
                  placeholder="Type your question and press Enter…"
                  style={{ flex: 1, padding: '10px 12px', fontSize: 13.5, border: '1px solid var(--gray-300)', borderRadius: 8, outline: 'none', background: 'var(--surface)', color: 'var(--gray-800)', fontFamily: 'inherit' }} />
                <select value={customCat} onChange={e => setCustomCat(e.target.value)}
                  style={{ width: 150, padding: '0 10px', fontSize: 13, border: '1px solid var(--gray-300)', borderRadius: 8, background: 'var(--surface)', color: 'var(--gray-800)', fontFamily: 'inherit', cursor: 'pointer' }}>
                  {Object.keys(CAT_LABELS).map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
                </select>
                <button className="btn btn-primary" onClick={addCustomQuestion} disabled={!customDraft.trim()} style={{ whiteSpace: 'nowrap' }}>+ Add</button>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--gray-400)' }}>
                Each question you add appears in the interview set below — edit or remove it there.
              </div>
            </div>

            {/* THE single place selected questions live: one editable list mixing all
                three sources. Edit text/category, add an expected answer (📝), remove (×). */}
            {filledCount > 0 ? (
              <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--gray-200)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-800)' }}>
                    Interview set — {filledCount} question{filledCount !== 1 ? 's' : ''}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>
                    {[bankCount && `${bankCount} from bank`, genCount && `${genCount} AI`, customCount && `${customCount} custom`].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <div style={{ border: '1px solid var(--gray-200)', borderRadius: 8, overflow: 'hidden' }}>
                  {combined.map((q, i) => (
                    <div key={`${q.source}-${q.id}`} style={{ borderBottom: i < combined.length - 1 ? '1px solid var(--gray-100)' : 'none', background: 'var(--surface)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '34px 1fr 120px 60px 34px 34px', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-400)', textAlign: 'center' }}>{i + 1}</span>
                        <input
                          value={q.text}
                          onChange={e => updateCombined(q, 'text', e.target.value)}
                          placeholder={`Question ${i + 1}…`}
                          style={{ padding: '11px 12px', border: 'none', borderLeft: '1px solid var(--gray-100)', borderRight: '1px solid var(--gray-100)', fontSize: 13, color: 'var(--gray-900)', outline: 'none', fontFamily: 'inherit', background: 'transparent', width: '100%' }} />
                        <select
                          value={q.category}
                          onChange={e => updateCombined(q, 'category', e.target.value)}
                          style={{ padding: '11px 10px', border: 'none', borderRight: '1px solid var(--gray-100)', fontSize: 11, fontWeight: 700, cursor: 'pointer', outline: 'none', background: CAT_BG[q.category], color: CAT_COLOR[q.category], width: '100%', height: '100%' }}>
                          {Object.keys(CAT_LABELS).map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
                        </select>
                        <span
                          title={`From ${q.source === 'bank' ? 'Question Bank' : q.source === 'ai' ? 'AI Generate' : 'Write My Own'}`}
                          style={{ fontSize: 10, fontWeight: 700, color: SRC_COLOR[q.source], textAlign: 'center', whiteSpace: 'nowrap', borderRight: '1px solid var(--gray-100)' }}>
                          {SRC_LABEL[q.source]}
                        </span>
                        <button onClick={() => updateCombined(q, 'showRubric', !q.showRubric)} title={q.showRubric ? 'Hide expected answer' : 'Add expected answer'}
                          style={{ width: '100%', height: '100%', border: 'none', borderRight: '1px solid var(--gray-100)', background: q.showRubric ? '#eff6ff' : 'transparent', color: q.showRubric ? '#2563eb' : 'var(--gray-300)', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', height: 44 }}>📝</button>
                        <button onClick={() => removeCombined(q)} title="Remove from set"
                          style={{ width: '100%', height: '100%', border: 'none', background: 'transparent', color: 'var(--gray-400)', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', height: 44 }}>×</button>
                      </div>
                      {q.showRubric && (
                        <div style={{ padding: '8px 12px 10px 46px', borderTop: '1px solid #dbeafe', background: 'var(--tint-info)' }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>Expected answer / rubric</div>
                          <textarea
                            value={q.modelAnswer || ''}
                            onChange={e => updateCombined(q, 'modelAnswer', e.target.value)}
                            rows={2}
                            placeholder="Describe what a good answer looks like. The AI will score the candidate against this."
                            style={{ width: '100%', fontSize: 12, color: '#374151', padding: '7px 10px', border: '1px solid #dbeafe', borderRadius: 6, outline: 'none', fontFamily: 'inherit', resize: 'vertical', background: 'var(--surface)', lineHeight: 1.6 }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--gray-400)' }}>
                  Everything you pick collects here in order — this is exactly what the candidate will be asked.
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 20, padding: '16px', background: 'var(--gray-50)', border: '1px dashed var(--gray-300)', borderRadius: 8, fontSize: 13, color: 'var(--gray-500)', textAlign: 'center' }}>
                No questions yet — pick from the bank, generate with AI, or write your own above. They collect into one interview set here.
              </div>
            )}
          </div>

          {/* Section 3 */}
          <div style={cardStyle}>
            <SectionTitle title="Generate & Send" />
            {/* Explain why the button is disabled so a built question set isn't a dead end. */}
            {(!jobId || !candidateId) ? (
              <div style={{ marginBottom: 14, padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 13, color: '#92400e', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 15 }}>⚠</span>
                <span>
                  {!jobId
                    ? 'Pick a job opening in step 1 to generate the link.'
                    : 'Pick a candidate in step 1 — the interview link is personalised to them.'}
                  {filledCount > 0 && <> Your <strong>{filledCount}</strong> selected question{filledCount !== 1 ? 's are' : ' is'} saved and ready.</>}
                </span>
              </div>
            ) : filledCount === 0 ? (
              <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--tint-info)', border: '1px solid #bfdbfe', borderRadius: 8, fontSize: 13, color: '#1e40af' }}>
                No questions picked — the AI will ask its own questions live. Or select some in step 2 to control the interview.
              </div>
            ) : (
              <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--gray-600)' }}>
                Ready — <strong style={{ color: 'var(--gray-800)' }}>{filledCount}</strong> question{filledCount !== 1 ? 's' : ''} for <strong style={{ color: 'var(--gray-800)' }}>{candidateName}</strong>.
              </div>
            )}
            {/* Everything on one row: Generate button + (once generated) a compact
                link field, Copy and Back to Shortlist — the link is purposely
                narrow (you don't need to read the whole token) to save space. */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary"
                onClick={generateLink}
                disabled={!jobId || !candidateId}
                style={{ padding: '10px 24px', fontSize: 14, flexShrink: 0 }}
              >
                Generate Interview Link
              </button>

              {link && (
                <>
                  <input
                    type="text" readOnly value={link} onClick={e => e.target.select()}
                    title={link}
                    style={{ flex: '1 1 160px', minWidth: 100, maxWidth: 320, fontSize: 12, padding: '9px 12px', border: '1px solid var(--gray-300)', borderRadius: 6, background: 'var(--gray-50)', color: 'var(--gray-800)', fontFamily: 'monospace', outline: 'none', cursor: 'text', textOverflow: 'ellipsis' }}
                  />
                  <button className={`btn ${copied ? 'btn-secondary' : 'btn-primary'}`} onClick={copyLink} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {copied ? '✓ Copied!' : 'Copy Link'}
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => navigate(`/shortlist?focus=${candidateId}&job=${jobId}`)}
                    title="Go back to Shortlist and open the invitation email with this link filled in"
                    style={{ flexShrink: 0 }}
                  >
                    ← Back to Shortlist
                  </button>
                </>
              )}
            </div>

            {link && (
              <div style={{ marginTop: 10, padding: '10px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 13, color: '#1e40af', lineHeight: 1.6 }}>
                <strong>Send this link to {candidateName}.</strong>
                {filledCount > 0 && <> The AI will ask your <strong>{filledCount} question{filledCount !== 1 ? 's' : ''}</strong> in order.</>}
                {' '}Results save automatically once they submit.
              </div>
            )}
          </div>
        </div>
      )}

      {mainTab === 'results' && <AIInterviews embedded />}
      {mainTab === 'bank' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setMainTab('questions')}>← Back to Interview Questions</button>
          <QuestionBankTab showToast={showToast} />
        </div>
      )}
      {mainTab === 'prep' && (
        <CandidatePrepTab
          showToast={showToast}
          jobs={jobs}
          selectedJob={selectedJob}
          onUseForInterview={(cand, prepData) => {
            setMainTab('candidate');
            // Queue the candidate + questions to be applied once candidates load
            setPendingPrep({ candidateId: cand.candidate_id, questions: prepData?.questions || [] });
            handleJobChange(String(cand.job_opening_id));
          }}
        />
      )}
    </div>
  );
}

// ── BankPicker ────────────────────────────────────────────────────────────────

function BankPicker({ onSelect, selected }) {
  const [bank, setBank]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [catFilter, setCatFilter] = useState('all');

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
  const CAT_ORDER = Object.keys(CAT_LABELS);
  const catRank = c => { const i = CAT_ORDER.indexOf(c); return i === -1 ? 99 : i; };
  const visible = bank
    .filter(b => {
      const matchCat = catFilter === 'all' || b.category === catFilter;
      const matchSearch = !search || b.question.toLowerCase().includes(search.toLowerCase());
      return matchCat && matchSearch;
    })
    // Group by category (Behavioural together, then Technical, Salary, …) so the
    // list reads in tidy blocks instead of interleaved categories, especially on "All".
    .sort((a, b) => catRank(a.category) - catRank(b.category));

  // Fully controlled by the parent's interview set: a row is "checked" iff it's
  // already in the set (matched by bankId). No internal selection state — so
  // removing a question from the single "Interview set" list also unchecks it here.
  const checkedIds = new Set(selected.filter(s => s.bankId != null).map(s => s.bankId));
  const mk = b => ({ id: _nextId++, bankId: b.id, text: b.question, category: b.category, selected: true, modelAnswer: b.modelAnswer || '' });

  function toggle(b) {
    if (checkedIds.has(b.id)) onSelect(selected.filter(s => s.bankId !== b.id));
    else onSelect([...selected, mk(b)]);
  }

  const allVis = visible.length > 0 && visible.every(b => checkedIds.has(b.id));

  function toggleAll() {
    if (allVis) {
      const visIds = new Set(visible.map(b => b.id));
      onSelect(selected.filter(s => !visIds.has(s.bankId)));
    } else {
      const additions = visible.filter(b => !checkedIds.has(b.id)).map(mk);
      onSelect([...selected, ...additions]);
    }
  }

  const selectedCount = checkedIds.size;

  return (
    <div>
      {/* Filter bar */}
      <div className="qbank-filterbar" style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text" placeholder="Search questions…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 180, padding: '8px 12px', fontSize: 13, border: '1px solid var(--gray-300)', borderRadius: 6, outline: 'none', fontFamily: 'inherit' }}
        />
        <div className="qbank-cats" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {cats.map(c => (
            <button
              key={c}
              onClick={() => setCatFilter(c)}
              style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                border: `1px solid ${catFilter === c ? (CAT_COLOR[c] || '#2563eb') : 'var(--gray-200)'}`,
                background: catFilter === c ? (CAT_BG[c] || 'var(--tint-info)') : 'var(--surface)',
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
                className="qbank-row"
                style={{
                  display: 'grid', gridTemplateColumns: '40px 1fr 110px',
                  borderBottom: i < visible.length - 1 ? '1px solid var(--gray-100)' : 'none',
                  background: checkedIds.has(b.id) ? 'var(--tint-info)' : 'var(--surface)',
                  cursor: 'pointer',
                }}
                onClick={() => toggle(b)}
              >
                <div className="qbank-chk" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <input type="checkbox" checked={checkedIds.has(b.id)} onChange={() => toggle(b)} onClick={e => e.stopPropagation()} style={{ cursor: 'pointer' }} />
                </div>
                <div className="qbank-q" style={{ padding: '10px 12px', fontSize: 13, color: 'var(--gray-900)', lineHeight: 1.5 }}>{b.question}</div>
                <div className="qbank-cat" style={{ display: 'flex', alignItems: 'center', padding: '10px 8px' }}>
                  <span style={{ padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: CAT_BG[b.category] || '#f1f5f9', color: CAT_COLOR[b.category] || '#475569' }}>
                    {CAT_LABELS[b.category] || b.category}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {selectedCount > 0 && (
            <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>
              {selectedCount} added to the interview set below.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── CandidatePrepTab ─────────────────────────────────────────────────────────

function CandidatePrepTab({ showToast, jobs, selectedJob, onUseForInterview }) {
  const [filterJobId, setFilterJobId] = useState(() => {
    return selectedJob ? String(selectedJob.id) : '';
  });
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    if (selectedJob && !filterJobId) setFilterJobId(String(selectedJob.id));
  }, [selectedJob]);

  useEffect(() => {
    if (!filterJobId) { setRows([]); return; }
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`${API_BASE}/candidate-questions-list?job_id=${filterJobId}`);
        const json = await r.json();
        setRows(Array.isArray(json) ? json : (json.data || json.rows || []));
      } catch { showToast('Failed to load candidate prep data', 'error'); }
      finally { setLoading(false); }
    })();
  }, [filterJobId]);

  const jobTitle = jobs.find(j => String(j.JobId) === filterJobId)?.job_title || '';

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--gray-900)', margin: '0 0 4px' }}>Candidate Prep</h3>
        <p style={{ fontSize: 13, color: 'var(--gray-500)', margin: 0 }}>
          Candidates with prepared interview questions saved from the Shortlist tab.
        </p>
      </div>

      <div className="form-group" style={{ marginBottom: 16, maxWidth: 320 }}>
        <label>Filter by job</label>
        <select value={filterJobId} onChange={e => { setFilterJobId(e.target.value); setExpanded(null); }}>
          <option value="">— Select a job —</option>
          {jobs.map(j => (
            <option key={j.JobId} value={j.JobId}>{j.job_title}{j.department ? ` — ${j.department}` : ''}</option>
          ))}
        </select>
      </div>

      {loading && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--gray-400)', fontSize: 13 }}>Loading…</div>
      )}

      {!loading && rows.length === 0 && (
        <div style={{ padding: '32px 20px', textAlign: 'center', background: 'var(--gray-50)', border: '1px dashed var(--gray-300)', borderRadius: 10 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--gray-700)', marginBottom: 6 }}>
            {filterJobId ? 'No prepared questions for this job yet' : 'Select a job to see prepared candidates'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--gray-400)' }}>
            Use "Hand Off to HM" on shortlisted candidates and save questions from the Interview Questions modal.
          </div>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(row => {
            const isExpanded = expanded === row.candidate_id;
            const qs = Array.isArray(row.questions) ? row.questions : [];
            const hasMeeting = row.meeting && (row.meeting.platform || row.meeting.datetime);
            return (
              <div key={row.candidate_id} style={{ border: '1px solid var(--gray-200)', borderRadius: 10, overflow: 'hidden' }}>
                <div
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
                    background: isExpanded ? 'var(--tint-info)' : 'var(--surface)', cursor: 'pointer',
                    borderBottom: isExpanded ? '1px solid var(--gray-200)' : 'none',
                  }}
                  onClick={() => setExpanded(isExpanded ? null : row.candidate_id)}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--gray-900)' }}>
                      {row.candidate_name || row.full_name || `Candidate #${row.candidate_id}`}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {row.job_title && <span>📌 {row.job_title}</span>}
                      <span>❓ {qs.length} question{qs.length !== 1 ? 's' : ''}</span>
                      {hasMeeting && <span>📅 Meeting: {row.meeting.platform}{row.meeting.datetime ? ` · ${new Date(row.meeting.datetime).toLocaleString()}` : ''}</span>}
                      {row.updated_at && <span>🕐 Saved {new Date(row.updated_at).toLocaleDateString()}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onUseForInterview(row, { questions: qs, meeting: row.meeting }); }}
                    style={{
                      padding: '7px 16px', fontSize: 13, fontWeight: 600,
                      color: '#fff', background: '#2563eb',
                      border: 'none', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Use for Interview
                  </button>
                  <span style={{ fontSize: 16, color: 'var(--gray-400)', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', marginLeft: 4 }}>›</span>
                </div>

                {isExpanded && (
                  <div style={{ padding: '14px 18px', background: 'var(--surface)' }}>
                    {qs.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {qs.map((q, i) => (
                          <div key={i} style={{
                            padding: '8px 10px', border: '1px solid var(--gray-200)', borderRadius: 7,
                            borderLeft: `3px solid ${CAT_COLOR[q.category] || '#2563eb'}`,
                            fontSize: 13, color: 'var(--gray-800)',
                          }}>
                            <span style={{
                              display: 'inline-block', marginRight: 6,
                              padding: '2px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                              background: CAT_BG[q.category] || '#eff6ff',
                              color: CAT_COLOR[q.category] || '#1e40af',
                              textTransform: 'uppercase',
                            }}>
                              {q.category}
                            </span>
                            {q.question}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, color: 'var(--gray-400)' }}>No questions saved.</div>
                    )}
                    {row.general_notes && (
                      <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--gray-50)', borderRadius: 6, fontSize: 12, color: 'var(--gray-600)' }}>
                        <strong>Notes:</strong> {row.general_notes}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── QuestionBankTab ───────────────────────────────────────────────────────────

function QuestionBankTab({ showToast }) {
  const { showConfirm } = useUI();
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
    if (!(await showConfirm({ title: 'Delete question?', message: 'Delete this question from the bank? This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
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
        <div style={{ marginBottom: 16, padding: '16px 20px', background: 'var(--tint-info)', border: '1.5px solid #bfdbfe', borderRadius: 10 }}>
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
      <div className="qbank-filterbar" style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 160, padding: '8px 12px', fontSize: 13, border: '1px solid var(--gray-300)', borderRadius: 6, outline: 'none', fontFamily: 'inherit' }}
        />
        <div className="qbank-cats" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {cats.map(c => (
            <button
              key={c}
              onClick={() => setCatFilter(c)}
              style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                border: `1px solid ${catFilter === c ? (CAT_COLOR[c] || '#2563eb') : 'var(--gray-200)'}`,
                background: catFilter === c ? (CAT_BG[c] || 'var(--tint-info)') : 'var(--surface)',
                color: catFilter === c ? (CAT_COLOR[c] || '#2563eb') : 'var(--gray-500)',
              }}
            >
              {c === 'all' ? `All (${rows.length})` : CAT_LABELS[c]}
            </button>
          ))}
        </div>
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
          <div className="qbank-mgr-head" style={{ display: 'grid', gridTemplateColumns: '1fr 120px 180px 80px 80px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-200)', padding: '9px 14px', fontSize: 11, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
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
              className="qbank-mgr-row"
              style={{
                display: 'grid', gridTemplateColumns: '1fr 120px 180px 80px 80px',
                borderBottom: i < visible.length - 1 ? '1px solid var(--gray-100)' : 'none',
                padding: '11px 14px', alignItems: 'center',
                background: editing === r.id ? 'var(--tint-info)' : 'var(--surface)',
              }}
            >
              <div className="qbank-mgr-q" style={{ fontSize: 13, color: 'var(--gray-900)', lineHeight: 1.4, paddingRight: 12 }}>{r.question}</div>
              <div className="qbank-mgr-cat">
                <span style={{ padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: CAT_BG[r.category] || '#f1f5f9', color: CAT_COLOR[r.category] || '#475569' }}>
                  {CAT_LABELS[r.category] || r.category}
                </span>
              </div>
              <div className="qbank-mgr-job" style={{ fontSize: 12, color: 'var(--gray-500)' }}>{r.jobType || '—'}</div>
              <div className="qbank-mgr-used" style={{ textAlign: 'center', fontSize: 12, color: 'var(--gray-400)' }}>{r.timesUsed || 0}</div>
              <div className="qbank-mgr-actions" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
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
  background: 'var(--surface)',
  border: '1px solid var(--gray-200)',
  borderRadius: 'var(--radius)',
  padding: '24px 28px',
};

function SectionTitle({ number, title, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
      {number != null && (
        <span style={{ width: 24, height: 24, borderRadius: '50%', background: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {number}
        </span>
      )}
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
              background: q.selected ? 'var(--surface)' : 'var(--gray-50)',
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
              <div style={{ padding: '8px 12px 10px 108px', borderTop: '1px solid #dbeafe', background: 'var(--tint-info)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>Expected answer / rubric</div>
                <textarea
                  placeholder="Describe what a good answer looks like. The AI will score the candidate against this."
                  value={q.modelAnswer || ''}
                  onChange={e => onUpdate(q.id, 'modelAnswer', e.target.value)}
                  rows={2}
                  style={{
                    width: '100%', fontSize: 12, color: '#374151', padding: '7px 10px',
                    border: '1px solid #dbeafe', borderRadius: 6, outline: 'none',
                    fontFamily: 'inherit', resize: 'vertical', background: 'var(--surface)', lineHeight: 1.6,
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={onAdd}
        style={{ width: '100%', padding: '8px', fontSize: 13, color: '#2563eb', background: 'var(--surface)', border: '1px dashed #bfdbfe', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}
      >
        + Add question
      </button>
    </div>
  );
}
