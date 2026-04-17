import { useState, useEffect, useCallback, useRef } from 'react';
import { apiGet, apiPost } from '../services/api';
import { useSelectedJob } from '../state/selectedJob';
import { useUI } from '../state/uiState';
import StatCard from '../components/common/StatCard';
import ScoreBadge from '../components/common/ScoreBadge';
import Loading from '../components/common/Loading';
import EmptyState from '../components/common/EmptyState';
import EvalDetailModal from '../components/modals/EvalDetailModal';
import { formatDate, nameFromFilename, extractEmail } from '../utils/helpers';
import { extractTextFromFile } from '../utils/pdf';
import { sendEmailRequest, getRejectionTemplate } from '../services/email';

export default function CVEvaluation() {
  const { selectedJob, setSelectedJob } = useSelectedJob();
  const { showToast, openEmailComposer } = useUI();

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

  // Step 3 state
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  // Step 4 state
  const [candidates, setCandidates] = useState([]);
  const [evaluations, setEvaluations] = useState([]);
  const [evaluating, setEvaluating] = useState(false);
  const [detailCandidate, setDetailCandidate] = useState(null);
  const [shortlistMap, setShortlistMap] = useState({}); // candidateId -> status string
  const [recentlyChanged, setRecentlyChanged] = useState({}); // candidateId -> true (for animation)
  const [resultsFilter, setResultsFilter] = useState('all'); // 'active' | 'shortlisted' | 'rejected' | 'archived' | 'all'
  const [dupBannerDismissed, setDupBannerDismissed] = useState(false);
  const [archivedMap, setArchivedMap] = useState(() => { // candidateId -> previousStatus
    try { return JSON.parse(localStorage.getItem('hr_archived_candidates_v2') || '{}'); } catch { return {}; }
  });
  const [fadingOut, setFadingOut] = useState({}); // candidateId -> true (for fade-out animation)
  const [pendingArchive, setPendingArchive] = useState(null); // { candidateId, previousStatus, timeoutId }
  const archiveTimeoutRef = useRef(null);
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

  // Auto-select global job on mount
  useEffect(() => {
    if (!evalSelectedJob && selectedJob && jobsCache.length > 0) {
      const match = jobsCache.find(j => j.id === selectedJob.id);
      if (match) selectJob(match);
    }
  }, [selectedJob, jobsCache]);

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
    setEvalSelectedJob(job);
    setEvalJobId(job.id);
    setSelectedJob(job);
    const state = await fetchJobState(job.id);
    setJobState(state);
  }

  function goStep(target) {
    if (target > 1 && !evalSelectedJob) { showToast('Select a job first', 'error'); return; }
    if (target === 3) {
      const total = weights.skills + weights.experience + weights.education;
      if (total !== 100) { showToast(`Weights must sum to 100% (currently ${total}%)`, 'error'); return; }
      if (saveCriteria) {
        let name = saveCriteriaName.trim();
        if (!name) {
          name = prompt('Enter a name for this criteria set:');
          if (!name || !name.trim()) { showToast('Criteria set name is required to save', 'error'); return; }
          name = name.trim();
          setSaveCriteriaName(name);
        }
        apiPost('/criteria-sets', {
          name, job_opening_id: evalJobId, criteria_text: criteriaText,
          skills_weight: weights.skills, experience_weight: weights.experience, education_weight: weights.education,
        }).then(() => {
          showToast('Criteria set saved!', 'success');
          loadCriteriaSets(); // refresh the saved sets list
        }).catch(() => showToast('Failed to save criteria set', 'error'));
      }
    }
    if (target === 2 && !criteriaText && evalSelectedJob) {
      setCriteriaText(evalSelectedJob.job_description || '');
      loadCriteriaSets();
    }
    if (target === 4) loadEvalResults();
    setStep(target);
  }

  async function loadCriteriaSets() {
    if (!evalJobId) return;
    try {
      const res = await apiGet(`/criteria-sets?job_id=${evalJobId}`);
      setCriteriaSets(res.data || []);
    } catch {}
  }

  function applyCriteriaSet(setId) {
    const cs = criteriaSets.find(s => s.id === parseInt(setId));
    if (!cs) return;
    setCriteriaText(cs.criteria_text || '');
    setWeights({ skills: cs.skills_weight || 40, experience: cs.experience_weight || 35, education: cs.education_weight || 25 });
    setSelectedSetId(setId);
  }

  async function generateAICriteria() {
    if (!evalSelectedJob || generating) return;
    if (criteriaText && !confirm('This will replace the current draft. Continue?')) return;
    setGenerating(true);
    setGenStatus('Calling Ollama (qwen3:4b)\u2026 30-90 seconds');
    const previous = criteriaText;
    try {
      const res = await apiPost('/generate-criteria', {
        job_title: evalSelectedJob.job_title, department: evalSelectedJob.department,
        seniority_level: evalSelectedJob.seniority_level, employment_type: evalSelectedJob.employment_type,
        job_description: [evalSelectedJob.job_description || '', aiContext ? '\n\nAdditional context:\n' + aiContext : ''].join('').trim(),
        extra_context: aiContext, skills_weight: weights.skills, experience_weight: weights.experience, education_weight: weights.education,
      });
      if (res.data.success && res.data.criteria_text) {
        setCriteriaText(res.data.criteria_text);
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
        newFiles.push({ fileName: file.name, name: nameFromFilename(file.name), email: extractEmail(text), text, error: text.length < 10 ? 'Very little text' : '' });
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
        const res = await apiPost('/cv-submit', { job_opening_id: evalJobId, candidate_name: f.name, email: f.email, cv_text: f.text });
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
    setEvaluating(true);
    try {
      const payload = { job_opening_id: evalJobId, skills_weight: weights.skills, experience_weight: weights.experience, education_weight: weights.education };
      if (criteriaText) payload.criteria_text = criteriaText;
      const res = await apiPost('/cv-evaluate', payload);
      if (res.data.success) showToast(res.data.message || 'Evaluation complete', 'success');
      else if (res.data.error) showToast(`Evaluation failed: ${res.data.error}`, 'error');
      else if (res.status === 404) showToast('Evaluation failed: no unevaluated candidates found', 'error');
      else if (res.status >= 500) showToast('Evaluation failed: backend error — check n8n and Ollama', 'error');
      else showToast('Evaluation failed: unexpected response from server', 'error');
    } catch (err) {
      if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError'))
        showToast('Evaluation failed: cannot reach n8n — is it running?', 'error');
      else
        showToast(`Evaluation failed: ${err.message || 'unknown error'}`, 'error');
    }
    finally { setEvaluating(false); loadEvalResults(); }
  }

  async function evaluateOne(candidateId) {
    try {
      const payload = { job_opening_id: evalJobId, candidate_id: candidateId, skills_weight: weights.skills, experience_weight: weights.experience, education_weight: weights.education };
      if (criteriaText) payload.criteria_text = criteriaText;
      const res = await apiPost('/cv-evaluate', payload);
      if (res.data.success) { showToast('AI evaluation complete!', 'success'); loadEvalResults(); }
      else showToast(`Evaluation failed: ${res.data.error || 'Ollama may not have responded'}`, 'error');
    } catch (err) { showToast(`Evaluation failed: ${err.message || 'network error'}`, 'error'); }
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

  function rejectCandidate(candidateId, candidateName, email) {
    const jobTitle = evalSelectedJob?.job_title || 'the position';
    const tmpl = getRejectionTemplate(candidateName, jobTitle);
    openEmailComposer({
      title: 'Reject Candidate', description: `Reject ${candidateName}?`,
      candidate: { id: candidateId, name: candidateName, email },
      job: { id: evalJobId, title: jobTitle }, emailType: 'rejection',
      defaultSubject: tmpl.subject, defaultBody: tmpl.body,
      sendLabel: 'Reject Candidate', sendClass: 'btn-danger', showSendToggle: true,
      onSend: async ({ subject, body, sendEmail }) => {
        const slRes = await apiPost('/add-to-shortlist', { candidate_id: candidateId, job_opening_id: evalJobId, notes: 'Rejected from evaluation results' });
        if (slRes.data.success) {
          const entry = slRes.data.data;
          const entryId = entry.id || (Array.isArray(entry) && entry[0]?.id);
          if (entryId) await apiPost('/update-shortlist-status', { id: entryId, status: 'rejected' });
        }
        if (sendEmail) await sendEmailRequest({ candidateId, jobId: evalJobId, emailType: 'rejection', recipientEmail: email, candidateName, jobTitle, subject, body });
        setShortlistMap(prev => ({ ...prev, [candidateId]: 'rejected' }));
        setRetainedInView(prev => new Set(prev).add(candidateId));
        setRecentlyChanged(prev => ({ ...prev, [candidateId]: true }));
        setTimeout(() => setRecentlyChanged(prev => { const n = { ...prev }; delete n[candidateId]; return n; }), 600);
        showToast('Candidate rejected', 'error');
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

  // Sort: unevaluated first, then pending (evaluated, no action), then shortlisted, then rejected. Newest first within each group.
  const statusOrder = (id) => {
    const s = shortlistMap[id];
    if (!evalMap[id]) return 0; // unevaluated
    if (!s) return 1; // evaluated, pending
    if (s === 'shortlisted' || s === 'interviewed' || s === 'hired') return 2;
    if (s === 'rejected') return 3;
    return 1;
  };
  const sorted = [...candidates].sort((a, b) => {
    const oa = statusOrder(a.id), ob = statusOrder(b.id);
    if (oa !== ob) return oa - ob;
    return new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0);
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
      <div style={{ textAlign: 'center', marginBottom: 0 }}>
        <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--primary)' }}>CV Evaluator Agent</span>
        <h2 style={{ fontSize: '18px', fontWeight: 700, marginTop: '2px' }}>AI-Powered CV Evaluation</h2>
        <p style={{ fontSize: '13px', color: 'var(--gray-500)', marginTop: '2px' }}>Select a job, define criteria, upload CVs, and get an instant AI evaluation report.</p>
      </div>

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
          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '2px' }}>Select a Job Opening</h3>
          <p style={{ fontSize: '13px', color: 'var(--gray-500)', marginBottom: '10px' }}>Choose the role you want to evaluate candidates for.</p>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <input type="text" className="search-bar" placeholder="Search jobs..." value={jobSearch} onChange={e => setJobSearch(e.target.value)} style={{ flex: 1 }} />
            <button className="btn btn-secondary btn-sm" onClick={loadJobs}>Refresh</button>
          </div>
          <div className="job-card-grid">
            {filteredJobs.length === 0 ? <EmptyState>No active job openings found.</EmptyState> :
              filteredJobs.map(job => (
                <div key={job.id} className={`job-card ${evalSelectedJob?.id === job.id ? 'selected' : ''}`} onClick={() => selectJob(job)}>
                  <div className="job-card-title">{job.job_title}</div>
                  <div className="job-card-meta">
                    <span>{job.department}</span>
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
            <button className="btn btn-primary" disabled={!evalSelectedJob} onClick={() => {
              if (jobState?.has_evaluations || jobState?.has_cvs) goStep(4);
              else if (jobState?.has_criteria) goStep(3);
              else goStep(2);
            }}>
              {jobState?.has_evaluations ? 'View Results \u2192' : jobState?.has_cvs ? 'Go to Results \u2192' : jobState?.has_criteria ? 'Upload CVs \u2192' : 'Set Criteria \u2192'}
            </button>
          </div>
        </div>
      )}

      {/* STEP 2 */}
      {step === 2 && (
        <div className="wizard-panel active">
          <div style={{ marginBottom: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--gray-900)' }}>Define Evaluation Criteria</h3>
            <p style={{ fontSize: '13px', color: 'var(--gray-500)', marginTop: '4px' }}>Tell the AI what matters for this role.</p>
          </div>
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
                    <select value={selectedSetId} onChange={e => { if (e.target.value) applyCriteriaSet(e.target.value); else setSelectedSetId(''); }} style={{ flex: 1 }}>
                      <option value="">&mdash; Create new criteria (from scratch) &mdash;</option>
                      {criteriaSets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
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
                    <input type="range" min="0" max="100" value={weights[w.key]} onChange={e => setWeights(prev => ({ ...prev, [w.key]: parseInt(e.target.value) }))} />
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
                  try { const text = await extractTextFromFile(e.target.files[0]); setCriteriaText(text); showToast('Criteria extracted', 'success'); }
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
            <textarea className="criteria-draft" value={criteriaText} onChange={e => setCriteriaText(e.target.value)} placeholder="Your criteria will appear here. You can always edit before continuing." />
            {criteriaText && !saveCriteria && (
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
              {saveCriteria && <input type="text" value={saveCriteriaName} onChange={e => setSaveCriteriaName(e.target.value)} placeholder='Criteria set name (e.g. "Senior Backend 2026")' style={{ marginTop: '8px', width: '100%' }} />}
            </div>
          </div>
          <div className="wizard-footer">
            <button className="btn btn-secondary" onClick={() => goStep(1)}>&larr; Back</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className="step-info">Step 2 of 4</span>
              <button className="btn btn-primary" onClick={() => goStep(3)}>Continue &rarr;</button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3 */}
      {step === 3 && (
        <div className="wizard-panel active">
          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}>Upload Candidate CVs</h3>
          <p style={{ fontSize: '13px', color: 'var(--gray-500)', marginBottom: '16px' }}>Upload one or more PDF CVs. Duplicates are automatically detected.</p>
          <div className="criteria-bar">
            <div><strong>{evalSelectedJob?.job_title}</strong> &mdash; {criteriaText.length > 0 ? criteriaText.length + ' char criteria' : 'Using job description'}</div>
            <div>Skills: <strong>{weights.skills}%</strong> &middot; Exp: <strong>{weights.experience}%</strong> &middot; Edu: <strong>{weights.education}%</strong></div>
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
          <div className="stats">
            <StatCard label="Candidates" value={uniqueCount || '-'} />
            <StatCard label="Evaluated" value={evalCount || '-'} />
            <StatCard label="Avg Score" value={avgScore} />
            <StatCard label="Top Score" value={topScore} />
          </div>
          <div className="table-wrap">
            <div className="table-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <h2>Evaluation Results</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {(() => {
                  const unevalCount = candidates.filter(c => !evalMap[c.id]).length;
                  const allDone = candidates.length > 0 && unevalCount === 0;
                  return (
                    <button className="btn btn-primary" onClick={runEvaluation} disabled={evaluating || allDone}
                      title={allDone ? 'All candidates are already evaluated' : ''}>
                      {evaluating ? 'AI evaluating...' : allDone ? '\u2713 All Evaluated' : `\u2728 Run Evaluation${unevalCount ? ` (${unevalCount})` : ''}`}
                    </button>
                  );
                })()}
              </div>
            </div>
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
            </div>
            {candidates.length === 0 ? <EmptyState>No candidates submitted yet. Upload CVs first.</EmptyState> : filtered.length === 0 ? <EmptyState>No candidates match this filter.</EmptyState> : (
              <table>
                <thead><tr><th>Candidate</th><th>Email</th><th>Submitted</th><th>Overall</th><th>Actions</th></tr></thead>
                <tbody>
                  {filtered.map(c => {
                    const e = evalMap[c.id];
                    const status = shortlistMap[c.id];
                    const justChanged = recentlyChanged[c.id];
                    const archived = isArchived(c.id);
                    const fading = fadingOut[c.id];
                    const dup = isDuplicate(c.id);
                    const rowClass = [
                      status === 'rejected' ? 'row-rejected' : (status === 'shortlisted' || status === 'interviewed' || status === 'hired') ? 'row-shortlisted' : '',
                      archived ? 'row-archived' : '',
                      fading ? 'row-fading-out' : '',
                      dup && !archived ? 'row-duplicate' : '',
                    ].filter(Boolean).join(' ');
                    return (
                      <tr key={c.id} className={rowClass}>
                        <td>
                          <strong>{c.candidate_name}</strong>
                          {dup && !archived && <span className="dup-badge">Duplicate</span>}
                        </td>
                        <td>{c.email || '\u2014'}</td>
                        <td>{formatDate(c.submitted_at)}</td>
                        <td><ScoreBadge score={e?.overall_score} /></td>
                        <td className="actions-cell">
                          <div className="actions-container">
                            {archived ? (
                              <>
                                <span className={`status-action-badge ${archivedMap[c.id] === 'rejected' ? 'status-rejected' : 'status-shortlisted'}`}>
                                  {archivedMap[c.id] === 'rejected' ? '\u2717 Rejected' : '\u2713 ' + (archivedMap[c.id] || 'Shortlisted').charAt(0).toUpperCase() + (archivedMap[c.id] || 'shortlisted').slice(1)}
                                </span>
                                <button className="btn btn-sm btn-ghost" onClick={() => restoreCandidate(c.id)}>Restore</button>
                              </>
                            ) : status === 'rejected' ? (
                              <>
                                <span className={`status-action-badge status-rejected${justChanged ? ' status-pop' : ''}`}>{'\u2717'} Rejected</span>
                                <button className="btn btn-sm btn-ghost" onClick={() => archiveCandidate(c.id)}>Archive</button>
                              </>
                            ) : status === 'shortlisted' || status === 'interviewed' || status === 'hired' ? (
                              <>
                                <span className={`status-action-badge status-shortlisted${justChanged ? ' status-pop' : ''}`}>{'\u2713'} {status.charAt(0).toUpperCase() + status.slice(1)}</span>
                                <button className="btn btn-sm btn-ghost" onClick={() => archiveCandidate(c.id)}>Archive</button>
                              </>
                            ) : (
                              <>
                                {!e && <button className="btn btn-sm btn-purple" onClick={() => evaluateOne(c.id)}>Run Evaluation</button>}
                                <button className="btn btn-sm btn-secondary" onClick={() => setDetailCandidate(c)}>{e ? 'Details' : 'View CV'}</button>
                                {dup ? (
                                  <button className="btn btn-sm btn-ghost" onClick={() => archiveCandidate(c.id)}>Archive Duplicate</button>
                                ) : (
                                  <>
                                    <button className="btn btn-sm btn-success" onClick={() => addToShortlist(c.id)}>Shortlist</button>
                                    <button className="btn btn-sm btn-danger" onClick={() => rejectCandidate(c.id, c.candidate_name, c.email)}>Reject</button>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="wizard-footer">
            <button className="btn btn-secondary" onClick={() => { setEvalSelectedJob(null); setUploadedFiles([]); setCriteriaText(''); setStep(1); loadJobs(); }}>&larr; Start New Evaluation</button>
            <span className="step-info">Step 4 of 4</span>
          </div>
        </div>
      )}

      <EvalDetailModal candidate={detailCandidate} allCandidates={candidates} isOpen={!!detailCandidate} onClose={() => setDetailCandidate(null)} />
    </div>
  );
}
