import Modal from './Modal';

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

export default function EvalDetailModal({ candidate, allCandidates, isOpen, onClose }) {
  if (!candidate) return null;
  const c = candidate;
  const hasEval = c.overall_score != null;
  const overall = parseFloat(c.overall_score);
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
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '13px', color: 'var(--gray-500)' }}>Submitted</div>
          <div style={{ fontSize: '15px' }}>{new Date(c.submitted_at).toLocaleDateString()}</div>
        </div>
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
          </div>

          <div style={{ background: 'var(--gray-50)', borderRadius: 'var(--radius)', padding: '20px', marginBottom: '20px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--gray-800)', marginBottom: '16px' }}>Score Breakdown</h4>
            <ScoreBar label="Skills Match (40%)" score={c.skills_score} />
            <ScoreBar label="Experience (35%)" score={c.experience_score} />
            <ScoreBar label="Education (25%)" score={c.education_score} />
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
            <p style={{ fontSize: '14px', color: 'var(--gray-600)', marginTop: '4px' }}>{c.reasoning || 'Keyword-based analysis'}</p>
            <p style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '4px' }}>Evaluated: {new Date(c.evaluated_at).toLocaleString()}</p>
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
          <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--gray-700)', marginBottom: '8px' }}>CV / Resume</h4>
          <div style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', padding: '16px', maxHeight: '300px', overflowY: 'auto', fontSize: '13px', lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--gray-700)' }}>
            {c.cv_text}
          </div>
        </div>
      )}
    </Modal>
  );
}
