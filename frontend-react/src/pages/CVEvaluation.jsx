import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../services/api';
import { useSelectedJob } from '../state/selectedJob';
import { useUI } from '../state/uiState';
import { useEvalStatus } from '../state/evalStatus';
import ScoreBadge from '../components/common/ScoreBadge';
import Loading from '../components/common/Loading';
import EmptyState from '../components/common/EmptyState';
import EvalDetailModal from '../components/modals/EvalDetailModal';
import ScoreStrip from '../components/common/ScoreStrip';
import StickyContinue from '../components/common/StickyContinue';
import { formatDate, nameFromFilename, extractNameFromCV, extractEmail, scoreColor, shortDept } from '../utils/helpers';
import { extractTextFromFile, base64ToBlobUrl } from '../utils/pdf';

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || '';
      const comma = String(result).indexOf(',');
      resolve(comma >= 0 ? String(result).slice(comma + 1) : String(result));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
import { sendEmailRequest, getRejectionTemplate } from '../services/email';

const CVCHIP = (bg, color) => ({ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '3px 9px', borderRadius: 10, background: bg, color });

// Pull the "Required items met / NOT met" lines the n8n parser appends to
// reasoning, and return the cleaned prose separately.
function extractReq(reasoning) {
  if (!reasoning) return { missing: [], met: [], clean: '' };
  const split = s => s.split(/[;,]/).map(x => x.trim()).filter(Boolean);
  const mMiss = reasoning.match(/Required items NOT met:\s*([^\n]+)/i);
  const mMet = reasoning.match(/Required items met:\s*([^\n]+)/i);
  const clean = reasoning
    .replace(/Required items NOT met:\s*[^\n]+/i, '')
    .replace(/Required items met:\s*[^\n]+/i, '')
    .trim();
  return { missing: mMiss ? split(mMiss[1]) : [], met: mMet ? split(mMet[1]) : [], clean };
}

// Compact score chip used inside the expanded result detail (Decision-style).
function CvChip({ value, label }) {
  const v = value != null ? parseFloat(value) : null;
  return (
    <div style={{ flex: 1, textAlign: 'center', background: 'var(--gray-50)', borderRadius: 8, padding: '8px 6px' }}>
      <div style={{ fontSize: 17, fontWeight: 800, color: scoreColor(v), lineHeight: 1 }}>{v != null ? v.toFixed(1) : '—'}</div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--gray-400)', marginTop: 4 }}>{label}</div>
    </div>
  );
}

export default function CVEvaluation() {
  const { selectedJob, setSelectedJob } = useSelectedJob();
  const { showToast, openEmailComposer, showConfirm } = useUI();

  const [step, setStep] = useState(1);
  const [jobsCache, setJobsCache] = useState([]);
  const [evalSelectedJob, setEvalSelectedJob] = useState(null);
  const [evalJobId, setEvalJobId] = useState(null);
  const [jobSearch, setJobSearch] = useState('');

  // Step 2 state
  const [criteriaText, setCriteriaText] = useState('');
  const [criteriaSource, setCriteriaSource] = useState('manual');
  const [weights, setWeights] = useState({ skills: 40, experience: 35, education: 25 });
  const [criteriaSets, setCriteriaSets] = useState([]);
  const [selectedSetId, setSelectedSetId] = useState('');
  const [saveCriteria, setSaveCriteria] = useState(false);
  const [saveCriteriaName, setSaveCriteriaName] = useState('');
  const [aiContext, setAiContext] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState('Select a job to enable generation.');
  const [criteriaItems, setCriteriaItems] = useState([]); // [{id, text, required}]
  const [criteriaNameError, setCriteriaNameError] = useState(false);
  const criteriaNameRef = useRef(null);
  // Anchor for the floating Continue — when the real inline Continue scrolls into
  // view, the floating one hides (only one step is mounted at a time, so one ref).
  const continueAnchorRef = useRef(null);
  // "Update criteria" nice-to-have: track the currently-loaded set + whether the
  // user has edited weights / draft / items since it was loaded.
  const [appliedSet, setAppliedSet] = useState(null); // { id, name } of loaded set
  const [criteriaDirty, setCriteriaDirty] = useState(false);
  const [updatingCriteria, setUpdatingCriteria] = useState(false);
  const autoAppliedJobRef = useRef(null); // only auto-load last criteria once per job

  // Step 3 state
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  // Step 4 state
  const [candidates, setCandidates] = useState([]);
  const [evaluations, setEvaluations] = useState([]);
  const { evalState, startEvaluation, runAiTask } = useEvalStatus();
  const navigate = useNavigate();
  // Eval status is global (it survives leaving this tab) — derive the per-page
  // view from it so returning mid-run still shows live progress.
  const ev = evalState && evalState.jobId === evalJobId ? evalState : null;
  const evaluating = !!ev && !ev.candidateId && ev.phase === 'running';
  const evaluatingOneId = (ev && ev.candidateId && ev.phase === 'running') ? ev.candidateId : null;
  const evalBusy = evaluating || evaluatingOneId != null;

  // Tick a timer while evaluating so the progress bar advances. The backend
  // scores the whole batch and writes rows at the end (so the real done-count
  // stays 0 until then) — we estimate progress from elapsed time instead, and
  // blend in the real count if/when it moves.
  useEffect(() => {
    if (!evalBusy) { evalStartRef.current = 0; return; }
    if (!evalStartRef.current) evalStartRef.current = Date.now();
    const id = setInterval(() => setEvalTick(t => t + 1), 400);
    return () => clearInterval(id);
  }, [evalBusy]);

  function evalProgressPct() {
    const total = Math.max(1, ev?.total || 1);
    const realPct = ((ev?.done || 0) / total) * 100;
    const estMs = Math.max(8000, total * 12000); // ~12s per candidate
    const elapsed = evalStartRef.current ? Date.now() - evalStartRef.current : 0;
    const timePct = Math.min(95, (elapsed / estMs) * 100); // cap at 95% until truly done
    return Math.round(Math.max(realPct, timePct));
  }

  // When the global evaluation finishes for this job, reload the results table.
  // This is navigation-proof: the eval runs/polls in the provider even if the
  // user left this tab, so we refresh here whenever it completes (not only from
  // the inline call in runEvaluation, which can race or be missed).
  useEffect(() => {
    if (evalState && evalState.jobId === evalJobId && evalState.phase === 'done') {
      loadEvalResults();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evalState?.phase, evalState?.jobId]);
  const [detailCandidate, setDetailCandidate] = useState(null);
  const [shortlistMap, setShortlistMap] = useState({}); // candidateId -> status string
  const [recentlyChanged, setRecentlyChanged] = useState({}); // candidateId -> true (for animation)
  const [resultsFilter, setResultsFilter] = useState('all'); // 'all' | 'active' | 'shortlisted' | 'rejected' | 'archived'
  const [expandedRow, setExpandedRow] = useState(null); // candidate id of expanded result row (Decision-style)
  const [resultsSort, setResultsSort] = useState('recent'); // recent | score | name
  const [dupBannerDismissed, setDupBannerDismissed] = useState(false);
  const [archivedMap, setArchivedMap] = useState(() => { // candidateId -> previousStatus
    try { return JSON.parse(localStorage.getItem('hr_archived_candidates_v2') || '{}'); } catch { return {}; }
  });
  const [fadingOut, setFadingOut] = useState({}); // candidateId -> true (for fade-out animation)
  const [pendingArchive, setPendingArchive] = useState(null); // { candidateId, previousStatus, timeoutId }
  const archiveTimeoutRef = useRef(null);
  const selectJobReqRef = useRef(0); // guards against stale selectJob fetch races
  const evalStartRef = useRef(0);
  const [, setEvalTick] = useState(0); // forces a re-render so the progress bar advances
  const [retainedInView, setRetainedInView] = useState(new Set()); // candidates kept visible after status change until filter switches
  function switchFilter(f) { setResultsFilter(f); setRetainedInView(new Set()); }

  // Job state per selected job
  const [jobState, setJobState] = useState(null);

  useEffect(() => { loadJobs(); }, []);

  async function loadJobs() {
    try {
      const res = await apiGet('/job-openings?is_active=true');
      setJobsCache(res.data || []);
    } catch {}
  }

  // Follow the global job picked in the header. This wizard is the exception to
  // "apply everywhere instantly": we adopt the global job when nothing's chosen
  // yet or while still on Step 1, but never yank the user onto a different job
  // mid-wizard (Steps 2-4) — that would lose their criteria/upload progress.
  useEffect(() => {
    if (!selectedJob || jobsCache.length === 0) return;
    if (evalSelectedJob && evalSelectedJob.id === selectedJob.id) return;
    if (evalSelectedJob && step !== 1) return;
    const match = jobsCache.find(j => j.id === selectedJob.id);
    if (match) selectJob(match);
  }, [selectedJob, jobsCache, step]);

  async function fetchJobState(jobId) {
    try {
      const [cr, ca, ev] = await Promise.all([
        apiGet(`/criteria-sets?job_id=${jobId}`).catch(() => ({ data: [] })),
        apiGet(`/candidates?job_id=${jobId}`).catch(() => ({ data: [] })),
        apiGet(`/evaluations?job_id=${jobId}`).catch(() => ({ data: [] })),
      ]);
      const criteria = (cr.data || []).filter(c => c?.id);
      const cvs = (ca.data || []).filter(c => c?.id);
      const evals = (ev.data || []).filter(e => e?.id);
      return { has_criteria: criteria.length > 0, has_cvs: cvs.length > 0, has_evaluations: evals.length > 0, criteria_count: criteria.length, cv_count: cvs.length, eval_count: evals.length };
    } catch { return { has_criteria: false, has_cvs: false, has_evaluations: false }; }
  }

  async function selectJob(job) {
    // Track the latest requested job so a slow fetch from a previously-clicked
    // card can't resolve late and clobber the current selection (the glitch
    // where clicking one job sometimes lands on another).
    const reqId = ++selectJobReqRef.current;
    setEvalSelectedJob(job);
    setEvalJobId(job.id);
    setSelectedJob(job);
    setJobState(null);
    // New job → forget the previous job's loaded-criteria tracking.
    setAppliedSet(null);
    setCriteriaDirty(false);
    const [full, state] = await Promise.all([
      apiGet(`/job-opening?id=${job.id}`).catch(() => null),
      fetchJobState(job.id),
    ]);
    if (selectJobReqRef.current !== reqId) return; // superseded by a newer click
    if (full?.data) setEvalSelectedJob(prev => (prev && prev.id === job.id ? { ...prev, ...full.data } : prev));
    setJobState(state);
  }

  function goStep(target) {
    if (target > 1 && !evalSelectedJob) { showToast('Select a job first', 'error'); return; }
    if (target === 3) {
      const total = weights.skills + weights.experience + weights.education;
      if (total !== 100) { showToast(`Weights must sum to 100% (currently ${total}%)`, 'error'); return; }
      if (saveCriteria) {
        const name = saveCriteriaName.trim();
        if (!name) {
          setCriteriaNameError(true);
          showToast('Enter a name for this criteria set first', 'error');
          setTimeout(() => criteriaNameRef.current?.focus(), 0);
          return;
        }
        setCriteriaNameError(false);
        apiPost('/criteria-sets', {
          name, job_opening_id: evalJobId, criteria_text: criteriaText,
          skills_weight: weights.skills, experience_weight: weights.experience, education_weight: weights.education,
          criteria_items: criteriaItems.filter(it => it.text.trim()).map(({ text, required, importance }) => ({ text: text.trim(), required, importance: clampImportance(importance) })),
        }).then(() => {
          showToast('Criteria set saved!', 'success');
          loadCriteriaSets(); // refresh the saved sets list
        }).catch(() => showToast('Failed to save criteria set', 'error'));
      }
    }
    if (target === 2 && evalSelectedJob) {
      // Show the last criteria set for this job (if any); otherwise fall back to
      // pre-filling the job description into an empty draft.
      loadCriteriaSets({ autoApplyLast: true }).then(sets => {
        if ((!sets || !sets.length) && !criteriaText) setCriteriaText(evalSelectedJob.job_description || '');
      });
    }
    if (target === 4) loadEvalResults();
    setStep(target);
  }

  async function loadCriteriaSets({ autoApplyLast = false } = {}) {
    if (!evalJobId) return [];
    try {
      const res = await apiGet(`/criteria-sets?job_id=${evalJobId}`);
      const sets = res.data || [];
      setCriteriaSets(sets);
      // Show the criteria last set for this job when entering the tab — apply the
      // most recently saved set once (don't clobber an in-progress edit).
      if (autoApplyLast && sets.length && autoAppliedJobRef.current !== evalJobId
          && !criteriaText.trim() && !selectedSetId) {
        autoAppliedJobRef.current = evalJobId;
        const latest = [...sets].sort((a, b) => (b.id || 0) - (a.id || 0))[0];
        if (latest) applyCriteriaSetObj(latest);
      }
      return sets;
    } catch { return []; }
  }

  function applyCriteriaSetObj(cs) {
    if (!cs) return;
    setCriteriaText(cs.criteria_text || '');
    setWeights({ skills: cs.skills_weight || 40, experience: cs.experience_weight || 35, education: cs.education_weight || 25 });
    const items = Array.isArray(cs.criteria_items) ? cs.criteria_items : [];
    setCriteriaItems(items.map((it, idx) => ({ id: Date.now() + idx, text: it.text || '', required: !!it.required, importance: clampImportance(it.importance) })));
    setSelectedSetId(String(cs.id));
    setAppliedSet({ id: cs.id, name: cs.name });
    setCriteriaDirty(false);
  }

  function applyCriteriaSet(setId) {
    const cs = criteriaSets.find(s => s.id === parseInt(setId));
    if (cs) applyCriteriaSetObj(cs);
  }

  // Mark the criteria as edited so the "Update criteria" button surfaces.
  function markCriteriaDirty() { if (appliedSet) setCriteriaDirty(true); }

  // Persist the current criteria back onto the loaded set's name (re-save), so the
  // edits are remembered and shown next time the tab is opened.
  async function updateCriteria() {
    if (!appliedSet) return;
    const total = weights.skills + weights.experience + weights.education;
    if (total !== 100) { showToast(`Weights must sum to 100% (currently ${total}%)`, 'error'); return; }
    setUpdatingCriteria(true);
    try {
      await apiPost('/criteria-sets', {
        name: appliedSet.name, job_opening_id: evalJobId, criteria_text: criteriaText,
        skills_weight: weights.skills, experience_weight: weights.experience, education_weight: weights.education,
        criteria_items: criteriaItems.filter(it => it.text.trim()).map(({ text, required, importance }) => ({ text: text.trim(), required, importance: clampImportance(importance) })),
      });
      const sets = await loadCriteriaSets();
      // Re-select the freshly-saved row (newest with this name).
      const saved = [...sets].filter(s => s.name === appliedSet.name).sort((a, b) => (b.id || 0) - (a.id || 0))[0];
      if (saved) { setSelectedSetId(String(saved.id)); setAppliedSet({ id: saved.id, name: saved.name }); }
      setCriteriaDirty(false);
      showToast(`Criteria "${appliedSet.name}" updated`, 'success');
    } catch { showToast('Failed to update criteria', 'error'); }
    finally { setUpdatingCriteria(false); }
  }

  function clampImportance(v) {
    const n = parseInt(v, 10);
    if (isNaN(n)) return 5;
    return Math.max(1, Math.min(10, n));
  }

  function addCriteriaItem() {
    setCriteriaItems(prev => [...prev, { id: Date.now() + Math.random(), text: '', required: false, importance: 5 }]);
    markCriteriaDirty();
  }
  function updateCriteriaItem(id, patch) {
    setCriteriaItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it));
    markCriteriaDirty();
  }
  function removeCriteriaItem(id) {
    setCriteriaItems(prev => prev.filter(it => it.id !== id));
    markCriteriaDirty();
  }

  async function generateAICriteria() {
    if (!evalSelectedJob || generating) return;
    if (criteriaText && !(await showConfirm({ title: 'Replace current draft?', message: 'This will replace the current criteria draft with newly generated criteria. Continue?', confirmLabel: 'Replace', cancelLabel: 'Keep current' }))) return;
    setGenerating(true);
    setGenStatus('Calling Ollama (qwen3:4b)\u2026 30-90 seconds');
    const previous = criteriaText;
    try {
      const res = await runAiTask('Generating evaluation criteria…', () => apiPost('/generate-criteria', {
        job_title: evalSelectedJob.job_title, department: evalSelectedJob.department,
        seniority_level: evalSelectedJob.seniority_level, employment_type: evalSelectedJob.employment_type,
        job_description: [evalSelectedJob.job_description || '', aiContext ? '\n\nAdditional context:\n' + aiContext : ''].join('').trim(),
        extra_context: aiContext, skills_weight: weights.skills, experience_weight: weights.experience, education_weight: weights.education,
      }), { to: '/cv-eval', hint: evalSelectedJob.job_title ? `Back to criteria · ${evalSelectedJob.job_title}` : 'Back to CV Evaluation' });
      if (res.data.success && res.data.criteria_text) {
        setCriteriaText(res.data.criteria_text);
        setSelectedSetId('');
        setGenStatus(`Generated (${weights.skills}/${weights.experience}/${weights.education} weights). Edit if needed.`);
        showToast('Criteria generated', 'success');
      } else {
        setCriteriaText(previous);
        setGenStatus(res.data.error || 'Generation failed');
        showToast(res.data.error || 'Generation failed', 'error');
      }
    } catch (err) {
      setCriteriaText(previous);
      setGenStatus('Network error: ' + err.message);
      showToast('Network error', 'error');
    } finally { setGenerating(false); }
  }

  // Step 3: File processing
  async function processFiles(fileList) {
    const files = Array.from(fileList);
    const newFiles = [];
    for (const file of files) {
      if (uploadedFiles.some(f => f.fileName === file.name)) { showToast(`Duplicate: ${file.name}`, 'error'); continue; }
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (!['pdf', 'txt'].includes(ext)) { newFiles.push({ fileName: file.name, name: file.name, email: '', text: '', error: 'Not a PDF/TXT file' }); continue; }
      if (file.size > 10 * 1024 * 1024) { newFiles.push({ fileName: file.name, name: file.name, email: '', text: '', error: 'File too large' }); continue; }
      try {
        const text = await extractTextFromFile(file);
        const fileData = await readFileAsBase64(file);
        const mime = ext === 'pdf' ? 'application/pdf' : 'text/plain';
        const extractedName = extractNameFromCV(text) || nameFromFilename(file.name);
        newFiles.push({ fileName: file.name, name: extractedName, email: extractEmail(text), text, fileData, mime, error: text.length < 10 ? 'Very little text' : '' });
      } catch (err) { newFiles.push({ fileName: file.name, name: file.name, email: '', text: '', error: 'Read failed' }); }
    }
    setUploadedFiles(prev => [...prev, ...newFiles]);
  }

  async function submitCVs() {
    const valid = uploadedFiles.filter(f => !f.error && f.text);
    if (!valid.length) { showToast('No valid CVs', 'error'); return; }
    setUploading(true);
    let submitted = 0;
    for (const f of valid) {
      try {
        const res = await apiPost('/cv-submit', { job_opening_id: evalJobId, candidate_name: f.name, email: f.email, cv_text: f.text, cv_file_name: f.fileName, cv_file_data: f.fileData || null, cv_file_mime: f.mime || null });
        if (res.data.success) submitted++;
      } catch {}
    }
    showToast(`${submitted} CV(s) uploaded`, 'success');
    setUploading(false);
    setUploadedFiles([]);
    goStep(4);
  }

  // Step 4: Results
  async function loadEvalResults() {
    if (!evalJobId) return;
    try {
      const [candRes, evalRes, slRes] = await Promise.all([
        apiGet(`/candidates?job_id=${evalJobId}`),
        apiGet(`/evaluations?job_id=${evalJobId}`),
        apiGet(`/shortlist?job_id=${evalJobId}`).catch(() => ({ data: [] })),
      ]);
      setCandidates((candRes.data || []).filter(c => c.id));
      setEvaluations((evalRes.data || []).filter(e => e.id));
      const slMap = {};
      for (const s of (slRes.data || [])) {
        if (s.candidate_id && s.status) slMap[s.candidate_id] = s.status;
      }
      setShortlistMap(slMap);
    } catch (err) { showToast('Failed to load results', 'error'); }
  }

  // (Progress is driven by the global EvalStatusProvider — no local timer here.)

  async function runEvaluation() {
    if (!evalJobId) return;
    // Pre-check: are there unevaluated candidates?
    const unevaluated = candidates.filter(c => !evalMap[c.id]);
    if (candidates.length === 0) {
      showToast('No candidates uploaded yet — upload CVs first', 'error');
      return;
    }
    if (unevaluated.length === 0) {
      showToast('All candidates are already evaluated — upload new CVs to evaluate more', 'error');
      return;
    }
    const payload = { job_opening_id: evalJobId, skills_weight: weights.skills, experience_weight: weights.experience, education_weight: weights.education };
    if (criteriaText) payload.criteria_text = criteriaText;
    const cleanItems = criteriaItems.filter(it => it.text.trim()).map(({ text, required, importance }) => ({ text: text.trim(), required, importance: clampImportance(importance) }));
    if (cleanItems.length > 0) payload.criteria_items = cleanItems;
    // Hand off to the global eval provider: it keeps running and polling even if
    // the user navigates away, and owns the indicator + completion toast.
    await startEvaluation({
      jobId: evalJobId, jobTitle: evalSelectedJob?.job_title,
      total: unevaluated.length, baselineCount: Object.keys(evalMap).length, payload,
    });
    loadEvalResults();
  }

  async function evaluateOne(candidateId) {
    if (evaluating || evaluatingOneId != null) return;
    const payload = { job_opening_id: evalJobId, candidate_id: candidateId, skills_weight: weights.skills, experience_weight: weights.experience, education_weight: weights.education };
    if (criteriaText) payload.criteria_text = criteriaText;
    const cleanItems = criteriaItems.filter(it => it.text.trim()).map(({ text, required, importance }) => ({ text: text.trim(), required, importance: clampImportance(importance) }));
    if (cleanItems.length > 0) payload.criteria_items = cleanItems;
    await startEvaluation({
      jobId: evalJobId, jobTitle: evalSelectedJob?.job_title,
      total: 1, baselineCount: Object.keys(evalMap).length, candidateId, payload,
    });
    loadEvalResults();
  }

  async function viewCV(candidateId, candidateName) {
    // Open the tab synchronously inside the click handler so the popup blocker
    // treats it as a user-initiated navigation. We then redirect it once the
    // base64 data arrives.
    const win = window.open('about:blank', '_blank');
    try {
      const res = await apiGet(`/cv-file?candidate_id=${candidateId}`);
      const d = res?.data?.data || res?.data || {};
      if (!d.cv_file_data) {
        if (win) win.close();
        showToast('Original PDF not stored for this candidate (uploaded before PDF storage was added)', 'error');
        return;
      }
      const url = base64ToBlobUrl(d.cv_file_data, d.cv_file_mime || 'application/pdf');
      if (win) {
        win.location.href = url;
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = d.cv_file_name || (candidateName + '.pdf');
        document.body.appendChild(a); a.click(); a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      if (win) win.close();
      showToast('Failed to load CV file', 'error');
    }
  }

  async function addToShortlist(candidateId) {
    try {
      const res = await apiPost('/add-to-shortlist', { candidate_id: candidateId, job_opening_id: evalJobId });
      if (res.data.success) {
        setShortlistMap(prev => ({ ...prev, [candidateId]: 'shortlisted' }));
        setRetainedInView(prev => new Set(prev).add(candidateId));
        setRecentlyChanged(prev => ({ ...prev, [candidateId]: true }));
        setTimeout(() => setRecentlyChanged(prev => { const n = { ...prev }; delete n[candidateId]; return n; }), 600);
        showToast('Shortlisted!', 'success');
      } else showToast(res.data.error || 'Failed', 'error');
    } catch (err) { showToast('Failed', 'error'); }
  }

  async function revertDecision(candidateId, kind /* 'shortlist' | 'reject' */) {
    const isReject = kind === 'reject';
    const confirmMsg = isReject
      ? 'Revert the rejection? The candidate will return to pending and can be re-evaluated, shortlisted, or rejected again.'
      : 'Remove this candidate from the shortlist? They will return to pending.';
    if (!(await showConfirm({
      title: isReject ? 'Revert rejection?' : 'Remove from shortlist?',
      message: confirmMsg,
      confirmLabel: isReject ? 'Revert rejection' : 'Remove',
    }))) return;
    try {
      const res = await apiPost('/remove-from-shortlist', { candidate_id: candidateId, job_opening_id: evalJobId });
      if (res.data.success) {
        setShortlistMap(prev => { const n = { ...prev }; delete n[candidateId]; return n; });
        setRetainedInView(prev => new Set(prev).add(candidateId));
        setRecentlyChanged(prev => ({ ...prev, [candidateId]: true }));
        setTimeout(() => setRecentlyChanged(prev => { const n = { ...prev }; delete n[candidateId]; return n; }), 600);
        showToast(isReject ? 'Rejection reverted — candidate is pending' : 'Candidate unshortlisted', 'info');
      } else showToast(res.data.error || 'Failed', 'error');
    } catch (err) { showToast('Failed', 'error'); }
  }

  function rejectCandidate(candidateId, candidateName, email) {
    const jobTitle = evalSelectedJob?.job_title || 'the position';
    const tmpl = getRejectionTemplate(candidateName, jobTitle);
    openEmailComposer({
      title: 'Reject Candidate', description: `Reject ${candidateName}?`,
      candidate: { id: candidateId, name: candidateName, email },
      job: { id: evalJobId, title: jobTitle }, emailType: 'rejection',
      defaultSubject: tmpl.subject, defaultBody: tmpl.body,
      sendLabel: 'Reject Candidate', sendClass: 'btn-danger', showSendToggle: true,
      onSend: async ({ subject, body, sendEmail, recipientEmail: resolvedEmail, attachmentFiles }) => {
        const slRes = await apiPost('/add-to-shortlist', { candidate_id: candidateId, job_opening_id: evalJobId, notes: 'Rejected from evaluation results' });
        if (slRes.data.success) {
          const entry = slRes.data.data;
          const entryId = entry.id || (Array.isArray(entry) && entry[0]?.id);
          if (entryId) await apiPost('/update-shortlist-status', { id: entryId, status: 'rejected' });
        }
        setShortlistMap(prev => ({ ...prev, [candidateId]: 'rejected' }));
        setRetainedInView(prev => new Set(prev).add(candidateId));
        setRecentlyChanged(prev => ({ ...prev, [candidateId]: true }));
        setTimeout(() => setRecentlyChanged(prev => { const n = { ...prev }; delete n[candidateId]; return n; }), 600);
        // Use the address resolved by the composer (HR may have typed one for a
        // candidate with no email on file) — not the empty closure variable.
        const to = resolvedEmail || email;
        if (sendEmail && to) {
          const res = await sendEmailRequest({ candidateId, jobId: evalJobId, emailType: 'rejection', recipientEmail: to, candidateName, jobTitle, subject, body, attachments: attachmentFiles });
          const status = res.data?.status;
          if (status === 'sent') showToast(`Candidate rejected — email sent to ${to}`, 'info');
          else if (status === 'logged') showToast('Candidate rejected — SMTP not configured, email saved to log only', 'error');
          else showToast(`Candidate rejected — email failed: ${res.data?.error || 'unknown error'}`, 'error');
        } else {
          showToast('Candidate rejected', 'error');
        }
      },
    });
  }

  // Build eval map
  const evalMap = {};
  for (const e of evaluations) evalMap[e.candidate_id] = e;

  // isArchived must be defined before duplicate detection so archived candidates are excluded from groups
  const isArchived = (id) => !!archivedMap[id] || (pendingArchive && pendingArchive.candidateId === id);

  // Duplicate detection: group non-archived candidates by normalized email, mark non-primary as duplicates
  const duplicateMap = {}; // candidateId -> { isPrimary: bool, groupKey: string, groupSize: number, primaryId: number }
  const dupGroups = {};
  for (const c of candidates) {
    if (isArchived(c.id)) continue; // skip archived — they're resolved
    const key = (c.email || '').trim().toLowerCase();
    if (!key) continue;
    if (!dupGroups[key]) dupGroups[key] = [];
    dupGroups[key].push(c);
  }
  for (const [key, group] of Object.entries(dupGroups)) {
    if (group.length < 2) continue;
    // Sort: evaluated first, then newest
    const ranked = [...group].sort((a, b) => {
      const ea = evalMap[a.id] ? 1 : 0, eb = evalMap[b.id] ? 1 : 0;
      if (ea !== eb) return eb - ea;
      return new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0);
    });
    const primaryId = ranked[0].id;
    for (let i = 0; i < ranked.length; i++) {
      duplicateMap[ranked[i].id] = { isPrimary: i === 0, groupKey: key, groupSize: group.length, primaryId };
    }
  }
  const isDuplicate = (id) => duplicateMap[id] && !duplicateMap[id].isPrimary;
  const activeDuplicateCount = candidates.filter(c => isDuplicate(c.id) && !isArchived(c.id)).length;
  const uniqueCount = candidates.length - candidates.filter(c => isDuplicate(c.id)).length;

  // Sort: honors the Sort-by dropdown. Default = most recently submitted first.
  const sorted = [...candidates].sort((a, b) => {
    if (resultsSort === 'score') return (parseFloat(evalMap[b.id]?.overall_score) || -1) - (parseFloat(evalMap[a.id]?.overall_score) || -1);
    if (resultsSort === 'name') return (a.candidate_name || '').localeCompare(b.candidate_name || '');
    return new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0); // recent
  });

  // Filter candidates based on resultsFilter; retained candidates stay visible until filter switches
  const filtered = sorted.filter(c => {
    if (retainedInView.has(c.id)) return true; // keep visible until filter changes
    const status = shortlistMap[c.id];
    const archived = isArchived(c.id);
    if (resultsFilter === 'all') return true;
    if (resultsFilter === 'archived') return archived;
    if (resultsFilter === 'duplicates') return isDuplicate(c.id) && !archived;
    if (resultsFilter === 'active') return !status && !archived && !isDuplicate(c.id);
    if (resultsFilter === 'shortlisted') return !archived && (status === 'shortlisted' || status === 'interviewed' || status === 'hired');
    if (resultsFilter === 'rejected') return !archived && status === 'rejected';
    return true;
  });

  function commitArchive(candidateId, previousStatus) {
    setArchivedMap(prev => {
      const next = { ...prev, [candidateId]: previousStatus };
      localStorage.setItem('hr_archived_candidates_v2', JSON.stringify(next));
      return next;
    });
  }

  function archiveCandidate(candidateId) {
    const previousStatus = shortlistMap[candidateId] || 'pending';
    // Cancel any existing pending archive
    if (archiveTimeoutRef.current) clearTimeout(archiveTimeoutRef.current);
    if (pendingArchive) commitArchive(pendingArchive.candidateId, pendingArchive.previousStatus);

    // Start fade-out animation
    setFadingOut(prev => ({ ...prev, [candidateId]: true }));
    setTimeout(() => {
      setFadingOut(prev => { const n = { ...prev }; delete n[candidateId]; return n; });
      // Set as pending archive (not committed yet — undo window)
      setPendingArchive({ candidateId, previousStatus });
      showToast(
        <span>Candidate archived &mdash; <button className="toast-undo-btn" onClick={() => undoArchive()}>Undo</button></span>,
        'info', 5500
      );
      // Auto-commit after 5s
      archiveTimeoutRef.current = setTimeout(() => {
        commitArchive(candidateId, previousStatus);
        setPendingArchive(null);
        archiveTimeoutRef.current = null;
      }, 5000);
    }, 350); // matches fade-out animation duration
  }

  function undoArchive() {
    if (!pendingArchive) return;
    if (archiveTimeoutRef.current) { clearTimeout(archiveTimeoutRef.current); archiveTimeoutRef.current = null; }
    setPendingArchive(null);
    showToast('Candidate restored', 'success');
  }

  function restoreCandidate(candidateId) {
    setArchivedMap(prev => {
      const next = { ...prev };
      delete next[candidateId];
      localStorage.setItem('hr_archived_candidates_v2', JSON.stringify(next));
      return next;
    });
    showToast('Candidate restored', 'success');
  }

  // Step stats
  const evalCount = evaluations.length;
  const scores = evaluations.map(r => parseFloat(r.overall_score));
  const avgScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '-';
  const topScore = scores.length ? Math.max(...scores).toFixed(1) : '-';

  // Filtered jobs for Step 1
  const filteredJobs = jobSearch ? jobsCache.filter(j => (j.job_title || '').toLowerCase().includes(jobSearch.toLowerCase()) || (j.department || '').toLowerCase().includes(jobSearch.toLowerCase())) : jobsCache;

  const weightTotal = weights.skills + weights.experience + weights.education;

  return (
    <div className="container">
      {/* Wizard steps */}
      <div className="wizard-steps">
        {[1, 2, 3, 4].map(n => (
          <div key={n} style={{ display: 'contents' }}>
            <div className={`wizard-step ${step === n ? 'active' : step > n ? 'completed' : ''}`} onClick={() => { if (n === 1 || evalSelectedJob) goStep(n); }}>
              <span className="step-num">{n}</span> {['Select Job', 'Set Criteria', 'Upload CVs', 'Results'][n - 1]}
            </div>
            {n < 4 && <div className={`wizard-connector ${step > n ? 'completed' : ''}`}></div>}
          </div>
        ))}
      </div>

      {/* STEP 1 */}
      {step === 1 && (
        <div className="wizard-panel active">
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <input type="text" className="search-bar" placeholder="Search jobs..." value={jobSearch} onChange={e => setJobSearch(e.target.value)} style={{ flex: 1 }} />
            <button className="btn btn-secondary btn-sm" onClick={loadJobs}>Refresh</button>
          </div>
          <div className="job-card-grid">
            {filteredJobs.length === 0 ? <EmptyState>No active job openings found.</EmptyState> :
              filteredJobs.map(job => (
                <div key={job.id} className={`job-card ${evalSelectedJob?.id === job.id ? 'selected' : ''}`} onClick={() => selectJob(job)}>
                  <div className="job-card-title">{job.job_title}</div>
                  <div className="job-card-meta" title={[job.department, job.seniority_level, job.employment_type].filter(Boolean).join(' · ')}>
                    <span>{shortDept(job.department)}</span>
                    <span className="dot">{job.seniority_level}</span>
                    <span className="dot">{job.employment_type}</span>
                  </div>
                  <div className="job-card-stats">
                    <span>{job.location_type}</span>
                    <span>Posted {new Date(job.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))
            }
          </div>
          {evalSelectedJob && jobState && (
            <div className="job-status-panel">
              <span className="label">Selected job:</span>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                <span className={`status-pill ${jobState.has_criteria ? 'done' : 'empty'}`}>{jobState.has_criteria ? `\u2713 ${jobState.criteria_count} criteria set(s)` : 'No criteria yet'}</span>
                <span className={`status-pill ${jobState.has_cvs ? 'done' : 'empty'}`}>{jobState.has_cvs ? `\u2713 ${jobState.cv_count} CV(s)` : 'No CVs'}</span>
                <span className={`status-pill ${jobState.has_evaluations ? 'done' : 'empty'}`}>{jobState.has_evaluations ? `\u2713 ${jobState.eval_count} evaluated` : 'Not evaluated'}</span>
              </span>
            </div>
          )}
          <div className="wizard-footer">
            <div className="step-info">Step 1 of 4</div>
            <button ref={continueAnchorRef} className="btn btn-primary" disabled={!evalSelectedJob} onClick={() => {
              if (jobState?.has_evaluations || jobState?.has_cvs) goStep(4);
              else if (jobState?.has_criteria) goStep(3);
              else goStep(2);
            }}>
              {jobState?.has_evaluations ? 'View Results \u2192' : jobState?.has_cvs ? 'Go to Results \u2192' : jobState?.has_criteria ? 'Upload CVs \u2192' : 'Set Criteria \u2192'}
            </button>
          </div>
          <StickyContinue
            show={!!evalSelectedJob}
            anchorRef={continueAnchorRef}
            label={jobState?.has_evaluations ? 'View Results' : jobState?.has_cvs ? 'Go to Results' : jobState?.has_criteria ? 'Upload CVs' : 'Set Criteria'}
            onClick={() => {
              if (jobState?.has_evaluations || jobState?.has_cvs) goStep(4);
              else if (jobState?.has_criteria) goStep(3);
              else goStep(2);
            }}
          />
        </div>
      )}

      {/* STEP 2 */}
      {step === 2 && (
        <div className="wizard-panel active">
          {/* Row 1: Criteria Source + Scoring Preferences side by side */}
          <div className="criteria-grid">
            <div className="criteria-section">
              <div className="criteria-section-header">
                <h4>Criteria Source</h4>
                <span className="criteria-section-hint">Choose a saved set or create new criteria.</span>
              </div>
              <div className="form-group" style={{ marginBottom: '0' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-600)' }}>Saved Criteria Sets</label>
                {criteriaSets.length === 0 ? (
                  <div style={{ padding: '10px 12px', background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', fontSize: '13px', color: 'var(--gray-500)' }}>
                    No saved criteria sets yet.
                    <span style={{ display: 'block', marginTop: '4px', fontSize: '12px', color: 'var(--gray-400)' }}>Create new criteria using the actions below.</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <select value={selectedSetId} onChange={e => { if (e.target.value) applyCriteriaSet(e.target.value); else { setSelectedSetId(''); setAppliedSet(null); } }} style={{ flex: 1 }}>
                      <option value="">&mdash; Create new criteria (from scratch) &mdash;</option>
                      {/* De-dupe by name (keep the newest id) so re-saving via "Update" doesn't pile up entries. */}
                      {Object.values(criteriaSets.reduce((acc, s) => {
                        if (!acc[s.name] || (s.id || 0) > (acc[s.name].id || 0)) acc[s.name] = s;
                        return acc;
                      }, {})).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <button className="btn btn-secondary btn-sm" onClick={loadCriteriaSets}>&#8635;</button>
                  </div>
                )}
              </div>
            </div>
            <div className="criteria-section">
              <div className="criteria-section-header">
                <h4>Scoring Preferences</h4>
                <span className="criteria-section-hint">Adjust scoring importance. Weights must total 100%.</span>
              </div>
              <div className="weight-config compact">
                {[{ key: 'skills', label: 'Skills' }, { key: 'experience', label: 'Experience' }, { key: 'education', label: 'Education' }].map(w => (
                  <div key={w.key} className="weight-row compact">
                    <label>{w.label}</label>
                    <input type="range" min="0" max="100" value={weights[w.key]} onChange={e => { setWeights(prev => ({ ...prev, [w.key]: parseInt(e.target.value) })); markCriteriaDirty(); }} />
                    <span className="weight-val">{weights[w.key]}%</span>
                  </div>
                ))}
                <div className={`weight-total ${weightTotal !== 100 ? 'invalid' : ''}`}>
                  {weightTotal === 100 ? `Total: ${weightTotal}%` : `Total: ${weightTotal}% (must equal 100%)`}
                </div>
              </div>
            </div>
          </div>
          {/* Row 2: Action panel — full width */}
          <div className="criteria-actions-card" style={{ marginTop: '20px' }}>
            <h4 className="criteria-actions-title">Choose How to Create Criteria</h4>
            <div className="criteria-actions-btns">
              {[{ key: 'job_desc', icon: '\uD83D\uDCCB', label: 'From Job Description' }, { key: 'manual', icon: '\u270F', label: 'Write / Paste' }, { key: 'ai', icon: '\u2728', label: 'AI Generate' }, { key: 'upload', icon: '\uD83D\uDCC4', label: 'Upload File' }].map(s => (
                <button key={s.key} className={`criteria-action-btn ${criteriaSource === s.key ? 'active' : ''}`} onClick={() => setCriteriaSource(s.key)}>
                  <span className="criteria-action-icon">{s.icon}</span>
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
            {criteriaSource === 'job_desc' && (
              <div className="criteria-action-content">
                {evalSelectedJob?.job_description ? (
                  <>
                    <p style={{ fontSize: '13px', color: 'var(--gray-600)', margin: '0 0 10px' }}>
                      Use the job description from <strong>{evalSelectedJob.job_title}</strong> as your evaluation criteria.
                    </p>
                    <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => {
                      setCriteriaText(evalSelectedJob.job_description);
                      setSelectedSetId('');
                      showToast('Job description loaded as criteria', 'success');
                    }}>
                      Load Job Description
                    </button>
                  </>
                ) : (
                  <p style={{ fontSize: '13px', color: 'var(--gray-400)', fontStyle: 'italic', margin: 0 }}>This job has no description. Create one in Job Openings first.</p>
                )}
              </div>
            )}
            {criteriaSource === 'ai' && (
              <div className="criteria-action-content">
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-600)', display: 'block', marginBottom: '6px' }}>Additional Context <span style={{ color: 'var(--gray-400)', fontWeight: 400 }}>(Optional)</span></label>
                <textarea value={aiContext} onChange={e => setAiContext(e.target.value)} placeholder="Must-have skills, constraints, culture fit notes..." style={{ minHeight: '60px', fontSize: '13px', width: '100%' }} />
                <button className="btn btn-primary" style={{ marginTop: '10px', width: '100%' }} onClick={generateAICriteria} disabled={generating || !evalSelectedJob}>
                  {generating ? 'Generating...' : '\u2728 Generate Criteria'}
                </button>
                <div className="ai-gen-status">{genStatus}</div>
              </div>
            )}
            {criteriaSource === 'upload' && (
              <div className="criteria-action-content">
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-600)', display: 'block', marginBottom: '6px' }}>Upload a PDF or TXT file with criteria</label>
                <input type="file" accept=".pdf,.txt" onChange={async (e) => {
                  if (!e.target.files.length) return;
                  try { const text = await extractTextFromFile(e.target.files[0]); setCriteriaText(text); setSelectedSetId(''); showToast('Criteria extracted', 'success'); }
                  catch { showToast('Failed to read file', 'error'); }
                }} />
              </div>
            )}
            {criteriaSource === 'manual' && (
              <div className="criteria-action-content">
                <p style={{ fontSize: '13px', color: 'var(--gray-500)', fontStyle: 'italic', margin: 0 }}>Type or paste your criteria directly in the editor.</p>
              </div>
            )}
          </div>
          {/* Row 3: Criteria Draft — full width */}
          <div className="criteria-section criteria-draft-section" style={{ marginTop: '20px' }}>
            <div className="criteria-section-header">
              <h4>Criteria Draft</h4>
              <span className="criteria-section-hint">Edit criteria before continuing. All sources populate this editor.</span>
            </div>
            <textarea className="criteria-draft" value={criteriaText} onChange={e => { setCriteriaText(e.target.value); markCriteriaDirty(); if (selectedSetId) setSelectedSetId(''); }} placeholder="Your criteria will appear here. You can always edit before continuing." />

            {/* Structured criteria items — required/optional + per-item weight */}
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--gray-200)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div>
                  <h5 style={{ margin: 0, fontSize: '13px', fontWeight: 700 }}>Criteria Items <span style={{ fontWeight: 400, color: 'var(--gray-400)' }}>(optional)</span></h5>
                  <span style={{ fontSize: '12px', color: 'var(--gray-500)' }}>
                    Break your criteria into items. Mark items as required so the AI penalizes candidates who don't meet them.
                  </span>
                </div>
                <button type="button" className="btn btn-sm btn-secondary" onClick={addCriteriaItem}>+ Add Item</button>
              </div>
              {criteriaItems.length === 0 ? (
                <div style={{ padding: '12px', background: 'var(--gray-50)', border: '1px dashed var(--gray-200)', borderRadius: 'var(--radius)', fontSize: '12px', color: 'var(--gray-500)', textAlign: 'center' }}>
                  No items yet. Add items for fine-grained, per-item evaluation.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {criteriaItems.map((it) => (
                    <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '8px', alignItems: 'center', padding: '8px', background: it.required ? '#fef3c7' : 'var(--gray-50)', border: '1px solid ' + (it.required ? '#fcd34d' : 'var(--gray-200)'), borderRadius: 'var(--radius)' }}>
                      <input type="text" value={it.text} onChange={e => updateCriteriaItem(it.id, { text: e.target.value })} placeholder="e.g. 5+ years of Python experience" style={{ fontSize: '13px' }} />
                      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 600, color: it.required ? '#92400e' : 'var(--gray-500)', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                        <input type="checkbox" checked={it.required} onChange={e => updateCriteriaItem(it.id, { required: e.target.checked })} />
                        Required
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--gray-600)', whiteSpace: 'nowrap' }} title="How much this item should weigh in scoring (1 = nice-to-have, 10 = critical)">
                        Importance
                        <select value={it.importance ?? 5} onChange={e => updateCriteriaItem(it.id, { importance: clampImportance(e.target.value) })} style={{ fontSize: '12px', padding: '2px 4px' }}>
                          {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </label>
                      <button type="button" onClick={() => removeCriteriaItem(it.id)} className="btn btn-sm btn-ghost" style={{ padding: '4px 8px' }} title="Remove">&times;</button>
                    </div>
                  ))}
                  <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '4px' }}>
                    {criteriaItems.filter(i => i.required).length} required &middot; {criteriaItems.filter(i => !i.required).length} optional
                  </div>
                </div>
              )}
            </div>
            {criteriaText && !saveCriteria && !selectedSetId && (
              <div className="unsaved-warning-card">
                <span className="warn-ico">{'\u26A0'}</span>
                <div>
                  <strong>Unsaved criteria</strong>
                  <p>These criteria will be used for this evaluation but won't be reusable later. Check the box below to save.</p>
                </div>
              </div>
            )}
            <div className="save-criteria-row">
              <label className="save-criteria-label">
                <input type="checkbox" checked={saveCriteria} onChange={e => setSaveCriteria(e.target.checked)} />
                <span>Save this criteria set for future evaluations</span>
              </label>
              {saveCriteria && (
                <>
                  <input
                    ref={criteriaNameRef}
                    type="text"
                    value={saveCriteriaName}
                    onChange={e => { setSaveCriteriaName(e.target.value); if (criteriaNameError && e.target.value.trim()) setCriteriaNameError(false); }}
                    placeholder='Criteria set name (e.g. "Senior Backend 2026")'
                    style={{ marginTop: '8px', width: '100%', borderColor: criteriaNameError ? '#dc2626' : undefined, outline: criteriaNameError ? '1px solid #dc2626' : undefined }}
                  />
                  {criteriaNameError && <div style={{ marginTop: '4px', fontSize: '12px', color: '#dc2626' }}>Required when "Save this criteria set" is checked.</div>}
                </>
              )}
            </div>
          </div>
          <div className="wizard-footer">
            <button className="btn btn-secondary" onClick={() => goStep(1)}>&larr; Back</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              {/* Nice-to-have: when the loaded criteria has been edited (weights /
                  draft / items), offer to persist it before moving on. */}
              {appliedSet && criteriaDirty && (
                <button className="btn btn-success" onClick={updateCriteria} disabled={updatingCriteria}
                  title={`Save your changes back to "${appliedSet.name}"`}>
                  {updatingCriteria ? 'Updating…' : `💾 Update "${appliedSet.name}"`}
                </button>
              )}
              <span className="step-info">Step 2 of 4</span>
              <button ref={continueAnchorRef} className="btn btn-primary" onClick={() => goStep(3)}>Continue &rarr;</button>
            </div>
          </div>
          <StickyContinue show anchorRef={continueAnchorRef} label="Continue to Upload CVs" onClick={() => goStep(3)} />
        </div>
      )}

      {/* STEP 3 */}
      {step === 3 && (
        <div className="wizard-panel active">
          <div className="criteria-bar">
            <div><strong>{evalSelectedJob?.job_title}</strong> &middot; {criteriaText.length > 0 ? 'Custom criteria set' : 'Using job description'}</div>
            <div>Skills <strong>{weights.skills}%</strong> &middot; Experience <strong>{weights.experience}%</strong> &middot; Education <strong>{weights.education}%</strong></div>
          </div>
          <div className="dropzone" onClick={() => document.getElementById('cv-file-input').click()} onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }} onDragLeave={e => e.currentTarget.classList.remove('dragover')}
            onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('dragover'); if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files); }}>
            <div className="dropzone-icon">{'\uD83D\uDCE5'}</div>
            <div className="dropzone-text">Drop CVs here</div>
            <div className="dropzone-sub">PDF, TXT allowed</div>
            <input type="file" id="cv-file-input" accept=".pdf,.txt" multiple onChange={e => processFiles(e.target.files)} style={{ display: 'none' }} />
          </div>
          <div className="file-list">
            {uploadedFiles.map((f, i) => (
              <div key={i} className="file-item">
                <div className="file-info">
                  <span style={{ fontSize: '16px' }}>{'\uD83D\uDCC4'}</span>
                  <div>
                    <div className="file-name">{f.fileName}</div>
                    <div className="file-meta">{f.name} {f.email && `\u00b7 ${f.email}`}</div>
                  </div>
                </div>
                {f.error ? <span style={{ color: 'var(--danger)', fontSize: '12px' }}>{f.error}</span> : <span className="badge badge-active" style={{ fontSize: '11px' }}>Ready</span>}
                <button className="file-remove" onClick={() => setUploadedFiles(prev => prev.filter((_, idx) => idx !== i))}>&times;</button>
              </div>
            ))}
          </div>
          <div className="wizard-footer">
            <button className="btn btn-secondary" onClick={() => goStep(2)}>&larr; Back</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className="step-info">Step 3 of 4</span>
              <button className="btn btn-primary" disabled={!uploadedFiles.some(f => !f.error && f.text) || uploading} onClick={submitCVs}>
                {uploading ? 'Uploading...' : 'Upload CVs \u2192'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 4 */}
      {step === 4 && (
        <div className="wizard-panel active">
          <div className="table-wrap">
            {evalBusy && (() => {
              const pct = evalProgressPct();
              return (
                <div style={{ padding: '8px 16px 12px' }}>
                  <div style={{ height: 7, background: 'var(--gray-200)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: '#7c3aed', borderRadius: 4, transition: 'width 0.4s ease' }} />
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--gray-600)', marginTop: '6px', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>{evaluating
                      ? `Scoring ${ev.done}/${ev.total} candidate${ev.total > 1 ? 's' : ''} on GTX 1650 \u2014 ~${Math.max(5, Math.round(ev.total * 12))}s total`
                      : 'Scoring candidate on GTX 1650 \u2014 ~15s'}</span>
                    <strong style={{ color: '#7c3aed' }}>{pct}%</strong>
                  </div>
                </div>
              );
            })()}
            {/* Duplicate warning banner */}
            {activeDuplicateCount > 0 && resultsFilter !== 'duplicates' && !dupBannerDismissed && (
              <div className="dup-warning-banner">
                <span className="dup-warning-icon">{'\u26A0'}</span>
                <span><strong>{activeDuplicateCount} duplicate{activeDuplicateCount > 1 ? 's' : ''}</strong> detected (same email, different uploads)</span>
                <button className="btn btn-sm btn-warning-outline" onClick={() => switchFilter('duplicates')}>Review Duplicates</button>
                <button className="dup-dismiss-btn" onClick={() => setDupBannerDismissed(true)} title="Dismiss">&times;</button>
              </div>
            )}
            {/* Filter bar */}
            <div className="results-filter-bar">
              <span className="results-filter-label">Show:</span>
              {[
                { key: 'all', label: 'All', count: candidates.length },
                { key: 'active', label: 'Active', count: candidates.filter(c => !shortlistMap[c.id] && !isArchived(c.id) && !isDuplicate(c.id)).length },
                { key: 'shortlisted', label: 'Shortlisted', count: candidates.filter(c => { const s = shortlistMap[c.id]; return !isArchived(c.id) && (s === 'shortlisted' || s === 'interviewed' || s === 'hired'); }).length },
                { key: 'rejected', label: 'Rejected', count: candidates.filter(c => !isArchived(c.id) && shortlistMap[c.id] === 'rejected').length },
                { key: 'duplicates', label: 'Duplicates', count: candidates.filter(c => isDuplicate(c.id) && !isArchived(c.id)).length },
                { key: 'archived', label: 'Archived', count: candidates.filter(c => isArchived(c.id)).length },
              ].map(f => (
                <button key={f.key} className={`results-filter-btn${resultsFilter === f.key ? ' active' : ''}${f.key === 'duplicates' && f.count > 0 ? ' has-duplicates' : ''}`} onClick={() => switchFilter(f.key)}>
                  {f.label}
                  <span className="results-filter-count">{f.count}</span>
                </button>
              ))}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                {(() => {
                  const unevalCount = candidates.filter(c => !evalMap[c.id]).length;
                  const allDone = candidates.length > 0 && unevalCount === 0;
                  const busy = evaluating || evaluatingOneId != null;
                  return (
                    <button className="btn btn-primary btn-sm" onClick={runEvaluation} disabled={busy || allDone}
                      title={allDone ? 'All candidates are already evaluated' : ''} style={{ whiteSpace: 'nowrap' }}>
                      {evaluating ? `AI evaluating… ${ev.done}/${ev.total}` : allDone ? '✓ All Evaluated' : `✨ Run Evaluation${unevalCount ? ` (${unevalCount})` : ''}`}
                    </button>
                  );
                })()}
                <span style={{ fontSize: 12.5, color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>Sort by</span>
                <select value={resultsSort} onChange={e => setResultsSort(e.target.value)}
                  style={{ width: 150, flexShrink: 0, padding: '7px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', fontSize: 13, fontFamily: 'inherit', outline: 'none', background: 'var(--surface)', cursor: 'pointer' }}>
                  <option value="recent">Most recent</option>
                  <option value="score">Highest score</option>
                  <option value="name">Name (A–Z)</option>
                </select>
              </div>
            </div>
            {candidates.length === 0 ? <EmptyState>No candidates submitted yet. Upload CVs first.</EmptyState> : filtered.length === 0 ? <EmptyState>No candidates match this filter.</EmptyState> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>
                {filtered.map(c => {
                  const e = evalMap[c.id];
                  const status = shortlistMap[c.id];
                  const archived = isArchived(c.id);
                  const dup = isDuplicate(c.id);
                  const isOpen = expandedRow === c.id;
                  const overall = e?.overall_score != null ? parseFloat(e.overall_score) : null;
                  // Match the other tabs: white card for shortlisted/interviewed;
                  // only a hired card is green and a rejected card is red.
                  const tint = status === 'rejected' ? 'var(--tint-danger)'
                    : status === 'hired' ? 'var(--tint-success)'
                    : 'var(--surface)';
                  return (
                    <div key={c.id} style={{
                      background: tint, border: `1px solid ${isOpen ? '#bfdbfe' : 'var(--gray-200)'}`,
                      borderRadius: 12, overflow: 'hidden',
                      boxShadow: isOpen ? '0 4px 16px rgba(37,99,235,0.08)' : '0 1px 2px rgba(0,0,0,0.04)',
                      transition: 'border-color 0.15s, box-shadow 0.15s, opacity 0.35s', opacity: fadingOut[c.id] ? 0 : 1,
                    }}>
                      <div onClick={() => setExpandedRow(isOpen ? null : c.id)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', cursor: 'pointer', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 160 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: 15, color: 'var(--gray-900)' }}>{c.candidate_name}</strong>
                            {dup && !archived && <span style={CVCHIP('#fef3c7', '#92400e')}>Duplicate</span>}
                            {!archived && status === 'rejected' && <span style={CVCHIP('#fee2e2', '#991b1b')}>{'✗'} Rejected</span>}
                            {!archived && (status === 'shortlisted' || status === 'interviewed' || status === 'hired') && <span style={CVCHIP('#dcfce7', '#166534')}>{'✓'} {status.charAt(0).toUpperCase() + status.slice(1)}</span>}
                            {archived && <span style={CVCHIP('#f1f5f9', '#475569')}>{'\u{1F4E6}'} Archived</span>}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>{c.email || '—'} {'·'} {formatDate(c.submitted_at)}</div>
                        </div>

                        <div className="sl-action-row" onClick={ev => ev.stopPropagation()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                          {archived ? (
                            <button className="btn btn-sm btn-ghost" onClick={() => restoreCandidate(c.id)}>Restore</button>
                          ) : status === 'rejected' ? (
                            <>
                              <button className="btn btn-sm btn-ghost" onClick={() => revertDecision(c.id, 'reject')} title="Revert this rejection">Unreject</button>
                              <button className="btn btn-sm btn-ghost" onClick={() => archiveCandidate(c.id)}>Archive</button>
                            </>
                          ) : (status === 'shortlisted' || status === 'interviewed' || status === 'hired') ? (
                            <>
                              <button className="btn btn-sm btn-primary" onClick={() => navigate(`/shortlist?focus=${c.id}&job=${evalJobId}`)} title="Open this candidate in the Shortlist tab">View in Shortlist →</button>
                              {status === 'shortlisted' && <button className="btn btn-sm btn-ghost" onClick={() => revertDecision(c.id, 'shortlist')}>Unshortlist</button>}
                              <button className="btn btn-sm btn-ghost" onClick={() => archiveCandidate(c.id)}>Archive</button>
                            </>
                          ) : (
                            <>
                              {!e && (
                                <button className="btn btn-sm btn-purple" onClick={() => evaluateOne(c.id)}
                                  disabled={evaluating || (evaluatingOneId != null && evaluatingOneId !== c.id)}>
                                  {evaluatingOneId === c.id ? 'Evaluating…' : 'Evaluate'}
                                </button>
                              )}
                              {dup ? (
                                <button className="btn btn-sm btn-ghost" onClick={() => archiveCandidate(c.id)}>Archive Duplicate</button>
                              ) : (
                                <>
                                  <button className="btn btn-sm btn-success" onClick={() => addToShortlist(c.id)}>Shortlist</button>
                                  <button className="btn btn-sm btn-danger" onClick={() => rejectCandidate(c.id, c.candidate_name, c.email)}>Reject</button>
                                  <button className="btn btn-sm btn-ghost" onClick={() => archiveCandidate(c.id)}>Archive</button>
                                </>
                              )}
                            </>
                          )}
                        </div>

                        <ScoreStrip
                          className="cv-score-cell"
                          dims={[
                            { label: 'Skills', value: e?.skills_score },
                            { label: 'Experience', value: e?.experience_score },
                            { label: 'Education', value: e?.education_score },
                          ]}
                          overall={{ label: 'Overall', value: e?.overall_score }}
                          emptyText={<>Not<br />evaluated</>}
                        />
                        <span className="cv-score-caret" style={{ color: 'var(--gray-400)', fontSize: 13, flexShrink: 0, transition: 'transform 0.25s ease', transform: isOpen ? 'rotate(180deg)' : 'none' }}>{'▾'}</span>
                      </div>

                      <div style={{ display: 'grid', gridTemplateRows: isOpen ? '1fr' : '0fr', transition: 'grid-template-rows 0.28s ease' }}>
                        <div style={{ overflow: 'hidden' }}>
                          <div style={{ borderTop: '1px solid var(--gray-100)', background: 'var(--surface-2)', padding: 18 }}>
                            {e ? (() => {
                              const req = extractReq(e.reasoning);
                              return (
                                <>
                                  <div style={{ display: 'flex', gap: 8, maxWidth: 380 }}>
                                    <CvChip value={e.skills_score} label="Skills" />
                                    <CvChip value={e.experience_score} label="Experience" />
                                    <CvChip value={e.education_score} label="Education" />
                                  </div>
                                  {(req.missing.length > 0 || req.met.length > 0) && (
                                    <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                      {req.met.map((t, i) => <span key={'m' + i} style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 10, background: '#dcfce7', color: '#166534' }}>✓ {t}</span>)}
                                      {req.missing.map((t, i) => <span key={'x' + i} style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 10, background: '#fee2e2', color: '#991b1b' }}>✗ {t}</span>)}
                                    </div>
                                  )}
                                  {e.strengths && <div style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.55, color: 'var(--gray-700)' }}><strong style={{ color: '#166534' }}>Strengths:</strong> {e.strengths}</div>}
                                  {e.weaknesses && <div style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.55, color: 'var(--gray-700)' }}><strong style={{ color: '#991b1b' }}>Weaknesses:</strong> {e.weaknesses}</div>}
                                  {req.clean && <div style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.55, color: 'var(--gray-700)' }}><strong style={{ color: 'var(--gray-600)' }}>Reasoning:</strong> {req.clean}</div>}
                                </>
                              );
                            })() : (
                              <p style={{ fontSize: 13, color: 'var(--gray-400)', fontStyle: 'italic', margin: 0 }}>Not evaluated yet — run the evaluation to see the score breakdown.</p>
                            )}
                            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                              {!e && <button className="btn btn-sm btn-secondary" onClick={() => setDetailCandidate(c)}>View CV text</button>}
                              {c.cv_file_available && <button className="btn btn-sm btn-secondary" onClick={() => viewCV(c.id, c.candidate_name)}>View original PDF</button>}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="wizard-footer">
            <button className="btn btn-secondary" onClick={() => { setEvalSelectedJob(null); setUploadedFiles([]); setCriteriaText(''); setSelectedSetId(''); setStep(1); loadJobs(); }}>&larr; Start New Evaluation</button>
            <span className="step-info">Step 4 of 4</span>
          </div>
        </div>
      )}

      <EvalDetailModal candidate={detailCandidate} allCandidates={candidates} job={evalSelectedJob} isOpen={!!detailCandidate} onClose={() => setDetailCandidate(null)} />
    </div>
  );
}
