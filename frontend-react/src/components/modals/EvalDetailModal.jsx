import { useState } from 'react';
import Modal from './Modal';
import { apiGet } from '../../services/api';
import { useUI } from '../../state/uiState';
import { getRecommendationTemplate, sendEmailRequest, getEmailStatus } from '../../services/email';
import { base64ToBlobUrl } from '../../utils/pdf';

function ScoreBar({ label, score }) {
  const s = parseFloat(score) || 0;
  const pct = s * 10;
  const color = s >= 7 ? 'var(--success)' : s >= 4 ? 'var(--warning)' : 'var(--danger)';
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-700)' }}>{label}</span>
        <span style={{ fontSize: '13px', fontWeight: 700, color }}>{s.toFixed(1)} / 10</span>
      </div>
      <div className="progress-bar"><div className="progress-fill" style={{ width: `${pct}%`, background: color }}></div></div>
    </div>
  );
}

function BulletList({ text, color }) {
  if (!text) return <p style={{ color: 'var(--gray-400)', fontStyle: 'italic' }}>None</p>;
  return (
    <ul style={{ margin: 0, paddingLeft: '20px' }}>
      {text.split(';').map(s => s.trim()).filter(Boolean).map((s, i) => (
        <li key={i} style={{ color, marginBottom: '4px', fontSize: '14px' }}>{s}</li>
      ))}
    </ul>
  );
}

function looksLikeEmail(s) { return typeof s === 'string' && /@/.test(s) && /\./.test(s.split('@').pop() || ''); }

// The n8n CV-eval parser appends required-item findings to reasoning in two stable
// lines: `Required items NOT met: a; b; c` and `Required items met: x; y`.
// Split them out here so we can render them as chips and strip them from the prose.
function extractRequiredItems(reasoning) {
  if (!reasoning) return { missing: [], met: [], cleanedReasoning: '' };
  const splitList = (s) => (s || '').split(';').map(x => x.trim()).filter(Boolean);
  const mMissing = reasoning.match(/Required items NOT met:\s*([^\n]+)/i);
  const mMet = reasoning.match(/Required items met:\s*([^\n]+)/i);
  const cleaned = reasoning
    .replace(/\n*Required items NOT met:[^\n]*/i, '')
    .replace(/\n*Required items met:[^\n]*/i, '')
    .trim();
  return {
    missing: mMissing ? splitList(mMissing[1]) : [],
    met: mMet ? splitList(mMet[1]) : [],
    cleanedReasoning: cleaned,
  };
}

function RequiredItemsBlock({ missing, met }) {
  if (missing.length === 0 && met.length === 0) return null;
  const chip = (text, kind) => {
    const ok = kind === 'met';
    return (
      <span key={kind + text} style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        background: ok ? '#dcfce7' : '#fee2e2',
        color: ok ? '#166534' : '#991b1b',
        border: `1px solid ${ok ? '#86efac' : '#fca5a5'}`,
        borderRadius: '999px', padding: '4px 10px',
        fontSize: '12px', fontWeight: 600, marginRight: '6px', marginBottom: '6px',
      }}>{ok ? '\u2713' : '\u2717'} {text}</span>
    );
  };
  return (
    <div style={{
      background: missing.length > 0 ? '#fef2f2' : '#f0fdf4',
      border: `1px solid ${missing.length > 0 ? '#fecaca' : '#bbf7d0'}`,
      borderRadius: 'var(--radius)', padding: '14px', marginBottom: '20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: 'var(--gray-800)' }}>
          Required Criteria
        </h4>
        <span style={{ fontSize: '12px', color: 'var(--gray-600)' }}>
          {met.length} met \u00b7 {missing.length} missing
        </span>
      </div>
      {missing.length > 0 && (
        <div style={{ marginBottom: met.length > 0 ? '10px' : 0 }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase', marginBottom: '6px' }}>Not met</div>
          <div>{missing.map(t => chip(t, 'missing'))}</div>
        </div>
      )}
      {met.length > 0 && (
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#166534', textTransform: 'uppercase', marginBottom: '6px' }}>Met</div>
          <div>{met.map(t => chip(t, 'met'))}</div>
        </div>
      )}
    </div>
  );
}

const HM_LS_KEY = 'hr_hiring_manager_emails';
function loadHMEmails() {
  try { return JSON.parse(localStorage.getItem(HM_LS_KEY) || '{}'); } catch { return {}; }
}
function saveHMEmail(jobId, email) {
  if (!jobId || !email) return;
  const m = loadHMEmails();
  m[jobId] = email;
  try { localStorage.setItem(HM_LS_KEY, JSON.stringify(m)); } catch {}
}

export default function EvalDetailModal({ candidate, allCandidates, job, isOpen, onClose }) {
  const { showToast, openEmailComposer } = useUI();
  const [loadingFile, setLoadingFile] = useState(false);
  if (!candidate) return null;
  const c = candidate;
  const canViewOriginal = !!c.cv_file_available;

  function emailRecommendation() {
    const jobTitle = job?.job_title || job?.title || 'the position';
    const department = job?.department || '';
    const reportingTo = job?.reporting_to || '';
    // Per request: leave the To: field empty by default. The cached HM email and
    // job.reporting_to fallback are no longer used for prefill (we still cache on
    // send, so re-enabling later is a one-line change).
    const initialEmail = '';
    const tmpl = getRecommendationTemplate({
      candidateName: c.candidate_name,
      candidateEmail: c.email,
      jobTitle,
      department,
      evaluation: c,
    });
    openEmailComposer({
      title: 'Email Recommendation to Hiring Manager',
      description: `Send the evaluation summary for ${c.candidate_name} to the hiring manager.`,
      candidate: { id: c.id, name: c.candidate_name, email: c.email },
      job: { id: job?.id, title: jobTitle },
      emailType: 'recommendation',
      recipientLabel: 'Hiring manager',
      recipientName: reportingTo || 'Hiring manager',
      recipientEmail: initialEmail,
      editableRecipient: true,
      defaultSubject: tmpl.subject,
      defaultBody: tmpl.body,
      sendLabel: 'Send Recommendation',
      sendClass: 'btn-primary',
      onSend: async ({ subject, body, recipientEmail }) => {
        if (!looksLikeEmail(recipientEmail)) { showToast('Please enter a valid hiring manager email', 'error'); throw new Error('invalid recipient'); }
        const res = await sendEmailRequest({
          candidateId: c.id, jobId: job?.id, emailType: 'recommendation',
          recipientEmail, candidateName: c.candidate_name, jobTitle,
          subject, body,
        });
        if (job?.id) saveHMEmail(job.id, recipientEmail);
        const status = getEmailStatus(res);
        showToast(status.message, status.type);
      },
    });
  }

  async function viewOriginalCV() {
    // Open the tab synchronously inside the click handler so the popup blocker
    // treats it as a user-initiated navigation. We then redirect it once the
    // base64 data arrives.
    const win = window.open('about:blank', '_blank');
    setLoadingFile(true);
    try {
      const res = await apiGet(`/cv-file?candidate_id=${c.id}`);
      // apiGet returns the parsed body directly (not wrapped in {data}), so the file
      // fields live on res.data — the previous code looked at res.data.data and always
      // missed.
      const d = res?.data?.data || res?.data || {};
      if (res?.success === false || !d.cv_file_data) {
        if (win) win.close();
        showToast('Original CV file is not available', 'error');
        return;
      }
      const url = base64ToBlobUrl(d.cv_file_data, d.cv_file_mime || 'application/pdf');
      if (win) {
        win.location.href = url;
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = d.cv_file_name || (c.candidate_name + '.pdf');
        document.body.appendChild(a); a.click(); a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      if (win) win.close();
      showToast('Failed to load CV file', 'error');
    } finally {
      setLoadingFile(false);
    }
  }
  const hasEval = c.overall_score != null;
  const overall = parseFloat(c.overall_score);
  const reqItems = extractRequiredItems(c.reasoning);
  const overallColor = overall >= 7 ? 'var(--success)' : overall >= 4 ? 'var(--warning)' : 'var(--danger)';
  const overallLabel = overall >= 8 ? 'Excellent' : overall >= 6 ? 'Good' : overall >= 4 ? 'Average' : overall >= 2 ? 'Below Average' : 'Poor';
  const rank = hasEval ? (allCandidates || []).filter(x => x.overall_score != null && parseFloat(x.overall_score) > overall).length + 1 : null;
  const total = (allCandidates || []).filter(x => x.overall_score != null).length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={c.candidate_name} wide
      footer={<button className="btn btn-secondary" onClick={onClose}>Close</button>}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid var(--gray-200)' }}>
        <div>
          <div style={{ fontSize: '13px', color: 'var(--gray-500)' }}>Email</div>
          <div style={{ fontSize: '15px' }}>{c.email || '\u2014'}</div>
        </div>
        {c.submitted_at && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '13px', color: 'var(--gray-500)' }}>Submitted</div>
            <div style={{ fontSize: '15px' }}>{new Date(c.submitted_at).toLocaleDateString()}</div>
          </div>
        )}
        {c.shortlisted_at && !c.submitted_at && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '13px', color: 'var(--gray-500)' }}>Shortlisted</div>
            <div style={{ fontSize: '15px' }}>{new Date(c.shortlisted_at).toLocaleDateString()}</div>
          </div>
        )}
        {c.status && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '13px', color: 'var(--gray-500)' }}>Status</div>
            <div style={{ fontSize: '15px', fontWeight: 600, textTransform: 'capitalize' }}>{c.status}</div>
          </div>
        )}
        {hasEval && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '13px', color: 'var(--gray-500)' }}>Rank</div>
            <div style={{ fontSize: '15px', fontWeight: 700 }}>#{rank} of {total}</div>
          </div>
        )}
      </div>

      {hasEval ? (
        <>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div style={{ fontSize: '56px', fontWeight: 800, color: overallColor, lineHeight: 1 }}>{overall.toFixed(1)}</div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: overallColor, marginTop: '4px' }}>{overallLabel}</div>
            <div style={{ fontSize: '13px', color: 'var(--gray-400)', marginTop: '2px' }}>Overall Score / 10</div>
            <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-primary" onClick={emailRecommendation}>
                {'\u2709'} Email Recommendation to Hiring Manager
              </button>
            </div>
          </div>

          <RequiredItemsBlock missing={reqItems.missing} met={reqItems.met} />

          <div style={{ background: 'var(--gray-50)', borderRadius: 'var(--radius)', padding: '20px', marginBottom: '20px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--gray-800)', marginBottom: '16px' }}>Score Breakdown</h4>
            <ScoreBar label="Skills Match" score={c.skills_score} />
            <ScoreBar label="Experience" score={c.experience_score} />
            <ScoreBar label="Education" score={c.education_score} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
            <div style={{ background: '#f0fdf4', borderRadius: 'var(--radius)', padding: '16px' }}>
              <h4 style={{ fontSize: '13px', fontWeight: 700, color: '#166534', marginBottom: '8px' }}>Strengths</h4>
              <BulletList text={c.strengths} color="#166534" />
            </div>
            <div style={{ background: '#fef2f2', borderRadius: 'var(--radius)', padding: '16px' }}>
              <h4 style={{ fontSize: '13px', fontWeight: 700, color: '#991b1b', marginBottom: '8px' }}>Weaknesses</h4>
              <BulletList text={c.weaknesses} color="#991b1b" />
            </div>
          </div>

          <div className="eval-detail-section">
            <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--gray-700)' }}>Evaluation Method</h4>
            <p style={{ fontSize: '14px', color: 'var(--gray-600)', marginTop: '4px', whiteSpace: 'pre-wrap' }}>{reqItems.cleanedReasoning || c.reasoning || 'Keyword-based analysis'}</p>
            {c.evaluated_at && <p style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '4px' }}>Evaluated: {new Date(c.evaluated_at).toLocaleString()}</p>}
          </div>
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: '30px', color: 'var(--gray-400)' }}>
          <p style={{ fontSize: '16px', fontWeight: 600 }}>Not Yet Evaluated</p>
          <p style={{ marginTop: '8px' }}>Click "Run Evaluation" to score this candidate.</p>
        </div>
      )}

      {c.cv_text && (
        <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--gray-200)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--gray-700)', margin: 0 }}>CV / Resume</h4>
            {canViewOriginal && (
              <button className="btn btn-secondary btn-sm" onClick={viewOriginalCV} disabled={loadingFile}>
                {loadingFile ? 'Loading…' : `View Original${(c.cv_file_mime || '').includes('pdf') ? ' PDF' : ' File'}`}
              </button>
            )}
          </div>
          <div style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', padding: '16px', maxHeight: '300px', overflowY: 'auto', fontSize: '13px', lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--gray-700)' }}>
            {c.cv_text}
          </div>
        </div>
      )}
    </Modal>
  );
}
