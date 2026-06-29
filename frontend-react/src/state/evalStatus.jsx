import { createContext, useContext, useState, useRef, useCallback } from 'react';
import { apiGet, apiPost } from '../services/api';
import { useUI } from './uiState';

const EvalStatusContext = createContext(null);

// Global, navigation-proof evaluation status. The scoring itself runs in n8n;
// this provider owns the request plus a live poll of how many candidates have
// been scored, so the on-screen indicator survives page changes and fires a
// notification when the run finishes.
export function EvalStatusProvider({ children }) {
  const { showToast } = useUI();
  const [evalState, setEvalState] = useState(null);
  // null = idle; otherwise { jobId, jobTitle, total, done, candidateId, phase }
  // phase: 'running' | 'done' | 'error'
  const pollRef = useRef(null);
  const clearRef = useRef(null);
  const [aiTask, setAiTask] = useState(null);   // generic Ollama activity: { label, phase, nav }
  const aiClearRef = useRef(null);

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  // Generic "AI is working" wrapper for any Ollama-backed action (criteria gen,
  // question gen, interview re-scoring…). Shows the global indicator while it runs.
  // `nav` (optional) = { to, hint } — makes the indicator card clickable so the
  // user can jump back to the tab/candidate the task is running for.
  // sourceExtractor: optional fn(result) → 'gemini'|'ollama'|null
  const runAiTask = useCallback(async (label, fn, nav = null, sourceExtractor = null) => {
    if (aiClearRef.current) { clearTimeout(aiClearRef.current); aiClearRef.current = null; }
    setAiTask({ label, phase: 'running', nav });
    const linger = nav ? 12000 : 4000;
    try {
      const r = await fn();
      const source = sourceExtractor ? (sourceExtractor(r) || null) : null;
      setAiTask({ label, phase: 'done', nav, source });
      aiClearRef.current = setTimeout(() => setAiTask(null), linger);
      return r;
    } catch (e) {
      setAiTask({ label, phase: 'error', nav, source: null });
      aiClearRef.current = setTimeout(() => setAiTask(null), linger);
      throw e;
    }
  }, []);

  const startEvaluation = useCallback(async ({ jobId, jobTitle, total, baselineCount = 0, candidateId = null, payload }) => {
    if (pollRef.current) {
      showToast('An evaluation is already running — let it finish first.', 'info');
      return { data: { success: false, error: 'busy' } };
    }
    if (clearRef.current) { clearTimeout(clearRef.current); clearRef.current = null; }
    const totalN = Math.max(1, total || 1);
    setEvalState({ jobId, jobTitle: jobTitle || 'this job', total: totalN, done: 0, candidateId, phase: 'running' });

    // Live progress: poll how many of the job's candidates are scored now.
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiGet(`/evaluations?job_id=${jobId}`);
        const count = (res.data || []).filter(e => e && e.id).length;
        const done = Math.max(0, Math.min(totalN, count - baselineCount));
        setEvalState(s => (s && s.phase === 'running') ? { ...s, done } : s);
      } catch {}
    }, 3000);

    let result;
    try {
      result = await apiPost('/cv-evaluate', payload);
      stopPoll();
      if (result?.data?.success) {
        setEvalState(s => (s ? { ...s, done: s.total, phase: 'done' } : s));
        showToast(candidateId ? 'Candidate evaluated' : `Evaluation complete — ${totalN} candidate${totalN > 1 ? 's' : ''} scored`, 'success');
      } else {
        setEvalState(s => (s ? { ...s, phase: 'error' } : s));
        showToast(result?.data?.error ? `Evaluation failed: ${result.data.error}` : 'Evaluation failed — check n8n and Ollama', 'error');
      }
    } catch (err) {
      stopPoll();
      setEvalState(s => (s ? { ...s, phase: 'error' } : s));
      const msg = (err?.message?.includes('fetch') || err?.message?.includes('Network'))
        ? 'Evaluation failed: cannot reach n8n — is it running?'
        : `Evaluation failed: ${err?.message || 'unknown error'}`;
      showToast(msg, 'error');
      result = { data: { success: false, error: err?.message || 'network' } };
    } finally {
      // Keep the done/error card visible briefly, then dismiss it.
      clearRef.current = setTimeout(() => setEvalState(null), 4500);
    }
    return result;
  }, [showToast]);

  // Dismiss the generic AI card immediately (e.g. the user clicked it).
  const dismissAiTask = useCallback(() => {
    if (aiClearRef.current) { clearTimeout(aiClearRef.current); aiClearRef.current = null; }
    setAiTask(null);
  }, []);

  return (
    <EvalStatusContext.Provider value={{ evalState, startEvaluation, aiTask, runAiTask, dismissAiTask }}>
      {children}
    </EvalStatusContext.Provider>
  );
}

export function useEvalStatus() {
  const ctx = useContext(EvalStatusContext);
  if (!ctx) throw new Error('useEvalStatus must be used within EvalStatusProvider');
  return ctx;
}
