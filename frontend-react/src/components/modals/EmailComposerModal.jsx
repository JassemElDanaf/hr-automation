import { useState } from 'react';
import { useUI } from '../../state/uiState';

export default function EmailComposerModal() {
  const { emailComposer, closeEmailComposer, showToast } = useUI();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [working, setWorking] = useState(false);

  // Sync state when composer opens
  const cfg = emailComposer;
  if (!cfg) return null;

  const hasEmail = cfg.candidate.email && cfg.candidate.email.includes('@');
  const showToggle = cfg.showSendToggle === true;

  // We use key-based re-init via the effect below
  // But since this is a controlled modal, let's handle it via derived state
  const currentSubject = subject || cfg.defaultSubject || '';
  const currentBody = body || cfg.defaultBody || '';

  const handleSend = async () => {
    const willSend = hasEmail && (showToggle ? sendEmail : true);
    const subj = currentSubject.trim();
    const bod = currentBody.trim();

    if (willSend) {
      if (!subj) { showToast('Subject cannot be empty', 'error'); return; }
      if (!bod) { showToast('Email body cannot be empty', 'error'); return; }
    }

    setWorking(true);
    try {
      await cfg.onSend({ subject: subj, body: bod, sendEmail: willSend });
      closeEmailComposer();
      setSubject('');
      setBody('');
    } catch (err) {
      showToast('Failed: ' + (err.message || err), 'error');
    } finally {
      setWorking(false);
    }
  };

  const handleReset = () => {
    setSubject(cfg.defaultSubject || '');
    setBody(cfg.defaultBody || '');
    showToast('Reset to default template', 'success');
  };

  return (
    <div className="modal-overlay active" onClick={(e) => e.target === e.currentTarget && closeEmailComposer()}>
      <div className="modal" style={{ maxWidth: '640px' }}>
        <div className="modal-header">
          <h3>{cfg.title || 'Compose Email'}</h3>
          <button className="modal-close" onClick={closeEmailComposer}>&times;</button>
        </div>
        <div className="modal-body" style={{ padding: '20px' }}>
          <p style={{ marginBottom: '14px', color: 'var(--gray-600)' }}>{cfg.description}</p>
          <div style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', padding: '12px', marginBottom: '14px', fontSize: '13px' }}>
            <div style={{ marginBottom: '4px' }}><strong>To:</strong> {cfg.candidate.email || 'No email on file'}</div>
            <div><strong>Candidate:</strong> {cfg.candidate.name || '\u2014'}</div>
          </div>

          {showToggle && hasEmail && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', cursor: 'pointer' }}>
              <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
              <span style={{ fontWeight: 600, fontSize: '14px' }}>Also send email</span>
            </label>
          )}

          {!hasEmail && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '10px 12px', borderRadius: 'var(--radius)', fontSize: '13px', marginBottom: '12px' }}>
              No email on file for this candidate. Email cannot be sent.
            </div>
          )}

          {hasEmail && (showToggle ? sendEmail : true) && (
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--gray-700)', marginBottom: '4px' }}>Subject</label>
              <input
                type="text"
                value={currentSubject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject line"
                style={{ width: '100%', marginBottom: '12px' }}
              />
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--gray-700)', marginBottom: '4px' }}>Body</label>
              <textarea
                value={currentBody}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Email body"
                style={{ width: '100%', minHeight: '220px', fontSize: '13px', lineHeight: 1.6 }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', gap: '10px', flexWrap: 'wrap' }}>
                <button className="btn btn-sm btn-secondary" type="button" onClick={handleReset}>&#x21BA; Reset to default template</button>
                <span style={{ fontSize: '12px', color: 'var(--gray-500)' }}>Tip: personalize before sending.</span>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={closeEmailComposer}>Cancel</button>
          <button
            className={`btn ${cfg.sendClass || 'btn-primary'}`}
            onClick={handleSend}
            disabled={working || (!hasEmail && !showToggle)}
          >
            {working ? 'Working...' : (cfg.sendLabel || 'Send Email')}
          </button>
        </div>
      </div>
    </div>
  );
}
