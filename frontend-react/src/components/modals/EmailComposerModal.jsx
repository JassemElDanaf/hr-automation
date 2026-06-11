import { useState } from 'react';
import { useUI } from '../../state/uiState';

const HM_LS_KEY = 'hr_hiring_manager_emails';

function getKnownHMEmails() {
  try {
    const stored = JSON.parse(localStorage.getItem(HM_LS_KEY) || '{}');
    return [...new Set(Object.values(stored).filter(Boolean))];
  } catch { return []; }
}

const PlaneSVG = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15" style={{ display: 'block' }}>
    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
  </svg>
);

export default function EmailComposerModal() {
  const { emailComposer, closeEmailComposer, showToast } = useUI();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [editedRecipient, setEditedRecipient] = useState(null);
  const [sendEmail, setSendEmail] = useState(true);
  // idle | sending | sent | closing
  const [sendPhase, setSendPhase] = useState('idle');
  // null = not initialized for this open; otherwise { key: bool }
  const [attachSel, setAttachSel] = useState(null);

  const cfg = emailComposer;
  if (!cfg) return null;

  // Optional attachment checkboxes (cfg.attachmentOptions: [{key,label,sublabel,checked,disabled}])
  const attachmentOptions = Array.isArray(cfg.attachmentOptions) ? cfg.attachmentOptions : [];
  const attachState = attachSel !== null
    ? attachSel
    : Object.fromEntries(attachmentOptions.map(o => [o.key, !!o.checked && !o.disabled]));
  const toggleAttach = (key) => setAttachSel({ ...attachState, [key]: !attachState[key] });

  // HM-facing: editableRecipient:true → never fall back to candidate email
  // Candidate-facing with no email: also editable (editedRecipient starts empty)
  const defaultRecipient = cfg.editableRecipient
    ? (cfg.recipientEmail || '')
    : (cfg.recipientEmail || cfg.candidate?.email || '');

  const recipientEmail   = editedRecipient !== null ? editedRecipient : defaultRecipient;
  const recipientName    = cfg.recipientName || cfg.candidate?.name || '';
  const recipientLabel   = cfg.recipientLabel || 'Candidate';
  const editableRecipient = cfg.editableRecipient === true;
  // Treat candidate-with-no-email as editable too
  const toIsEditable     = editableRecipient || !defaultRecipient;
  const hasEmail         = !!(recipientEmail && recipientEmail.includes('@'));
  const showToggle       = cfg.showSendToggle === true;
  const isHMFlow         = editableRecipient;

  const knownHMEmails    = isHMFlow ? getKnownHMEmails() : [];

  const currentSubject = subject || cfg.defaultSubject || '';
  const currentBody    = body    || cfg.defaultBody    || '';

  const doClose = () => {
    closeEmailComposer();
    setSubject('');
    setBody('');
    setEditedRecipient(null);
    setSendPhase('idle');
    setAttachSel(null);
  };

  const handleClose = () => {
    if (sendPhase === 'sending' || sendPhase === 'sent') return;
    doClose();
  };

  const handleBack = () => {
    if (typeof cfg.onBack === 'function') cfg.onBack();
    doClose();
  };

  const handleReset = () => {
    setSubject(cfg.defaultSubject || '');
    setBody(cfg.defaultBody || '');
    showToast('Reset to default template', 'success');
  };

  const handleSend = async () => {
    const willSend = hasEmail && (showToggle ? sendEmail : true);
    const subj = currentSubject.trim();
    const bod  = currentBody.trim();

    if (willSend) {
      if (!subj) { showToast('Subject cannot be empty', 'error'); return; }
      if (!bod)  { showToast('Email body cannot be empty', 'error'); return; }
    }

    setSendPhase('sending');
    try {
      const selectedAttachments = attachmentOptions.filter(o => attachState[o.key] && !o.disabled).map(o => o.key);
      await cfg.onSend({ subject: subj, body: bod, sendEmail: willSend, recipientEmail, attachments: selectedAttachments });
      setSendPhase('sent');
      setTimeout(() => {
        setSendPhase('closing');
        setTimeout(doClose, 390);
      }, 680);
    } catch (err) {
      setSendPhase('idle');
      showToast('Failed: ' + (err.message || err), 'error');
    }
  };

  const isBusy    = sendPhase !== 'idle';
  const isClosing = sendPhase === 'closing';

  return (
    <div
      className={`modal-overlay active${isClosing ? ' modal-overlay-send-out' : ''}`}
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div
        className={`modal${isClosing ? ' modal-send-out' : ''}`}
        style={{ maxWidth: '640px', position: 'relative' }}
      >
        {sendPhase === 'sent' && <div className="modal-sent-flash" />}

        <div className="modal-header">
          <h3>{cfg.title || 'Compose Email'}</h3>
          <button className="modal-close" onClick={handleClose}>&times;</button>
        </div>

        <div className="modal-body" style={{ padding: '20px' }}>
          <p style={{ marginBottom: '14px', color: 'var(--gray-600)' }}>{cfg.description}</p>

          {/* ── Recipient block ── */}
          <div style={{
            background: 'var(--gray-50)', border: '1px solid var(--gray-200)',
            borderRadius: 'var(--radius)', padding: '12px', marginBottom: '14px', fontSize: '13px',
          }}>
            {toIsEditable ? (
              <div>
                {/* To: input row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: knownHMEmails.length > 0 ? '10px' : (hasEmail ? 0 : '6px') }}>
                  <strong style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {isHMFlow ? recipientLabel : 'To'}:
                  </strong>
                  <input
                    type="email"
                    value={recipientEmail}
                    onChange={(e) => setEditedRecipient(e.target.value)}
                    placeholder={
                      isHMFlow
                        ? `${recipientLabel.toLowerCase().replace(' ', '.')}@company.com`
                        : `Add email for ${recipientName || 'candidate'}…`
                    }
                    list={isHMFlow && knownHMEmails.length > 0 ? 'ecm-hm-emails' : undefined}
                    style={{ flex: 1, fontSize: '13px', padding: '5px 8px' }}
                    autoFocus={!hasEmail}
                  />
                </div>

                {/* Known HM email chips */}
                {isHMFlow && knownHMEmails.length > 0 && (
                  <div>
                    <datalist id="ecm-hm-emails">
                      {knownHMEmails.map(e => <option key={e} value={e} />)}
                    </datalist>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: 'var(--gray-400)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        Known:
                      </span>
                      {knownHMEmails.map(email => (
                        <button
                          key={email}
                          type="button"
                          onClick={() => setEditedRecipient(email)}
                          style={{
                            fontSize: '12px', padding: '2px 10px', borderRadius: 20,
                            border: `1px solid ${recipientEmail === email ? '#3b82f6' : 'var(--gray-300)'}`,
                            background: recipientEmail === email ? '#eff6ff' : 'white',
                            color: recipientEmail === email ? '#1d4ed8' : 'var(--gray-600)',
                            cursor: 'pointer', fontWeight: recipientEmail === email ? 700 : 400,
                            transition: 'all 0.12s',
                          }}
                        >
                          {email}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Soft hint when nothing typed yet (non-HM only, HM has chips) */}
                {!isHMFlow && !hasEmail && (
                  <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '2px' }}>
                    Type an address above to enable sending.
                  </div>
                )}
                {isHMFlow && !hasEmail && knownHMEmails.length === 0 && (
                  <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '4px' }}>
                    No previously used addresses on record yet.
                  </div>
                )}
              </div>
            ) : (
              /* Static To: (candidate-facing, email already on file) */
              <div style={{ marginBottom: '4px' }}>
                <strong>To:</strong> {recipientEmail}
              </div>
            )}

            {/* For HM flow always show the candidate name; for candidate flow show only if different from label */}
            {(isHMFlow ? cfg.candidate?.name : (recipientName && recipientName !== recipientLabel)) && (
              <div style={{ marginTop: toIsEditable ? '8px' : '4px', borderTop: toIsEditable ? '1px solid var(--gray-200)' : 'none', paddingTop: toIsEditable ? '8px' : 0 }}>
                <strong>{isHMFlow ? 'Candidate' : recipientLabel}:</strong> {isHMFlow ? cfg.candidate?.name : recipientName}
              </div>
            )}
          </div>

          {showToggle && hasEmail && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', cursor: 'pointer' }}>
              <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
              <span style={{ fontWeight: 600, fontSize: '14px' }}>Also send email</span>
            </label>
          )}

          {/* Subject + body — shown once we have a valid recipient (or toggle permits no-send) */}
          {(hasEmail || (showToggle && !sendEmail)) && (
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

              {attachmentOptions.length > 0 && (
                <div style={{ marginTop: '12px', padding: '12px 14px', background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gray-700)', marginBottom: '8px' }}>
                    📎 Attachments
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {attachmentOptions.map(o => (
                      <label key={o.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: o.disabled ? 'not-allowed' : 'pointer', opacity: o.disabled ? 0.5 : 1 }}>
                        <input
                          type="checkbox"
                          checked={!!attachState[o.key] && !o.disabled}
                          disabled={o.disabled}
                          onChange={() => toggleAttach(o.key)}
                          style={{ marginTop: '2px' }}
                        />
                        <span style={{ fontSize: '13px', color: 'var(--gray-800)' }}>
                          {o.label}
                          {o.sublabel && <span style={{ display: 'block', fontSize: '11px', color: 'var(--gray-400)' }}>{o.sublabel}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Prompt to enter email when body is hidden because no address yet */}
          {!hasEmail && !(showToggle && !sendEmail) && (
            <div style={{
              padding: '14px 16px', background: 'var(--gray-50)', border: '1px dashed var(--gray-300)',
              borderRadius: 'var(--radius)', fontSize: '13px', color: 'var(--gray-500)', textAlign: 'center',
            }}>
              {isHMFlow
                ? `Enter the hiring manager's email address above to compose the message.`
                : `Add ${recipientName ? `${recipientName}'s` : 'a'} email address above to compose the message.`}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ display: 'flex', gap: '8px', justifyContent: cfg.onBack ? 'space-between' : 'flex-end' }}>
          {cfg.onBack && (
            <button className="btn btn-secondary" onClick={handleBack} disabled={isBusy}>
              {'\u2190'} {cfg.backLabel || 'Back'}
            </button>
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" onClick={handleClose} disabled={isBusy}>Cancel</button>
            <button
              className={`btn ${
                sendPhase === 'sent' || sendPhase === 'closing' ? 'btn-sent' :
                sendPhase === 'sending' ? 'btn-sending' :
                cfg.sendClass || 'btn-primary'
              }`}
              onClick={handleSend}
              disabled={isBusy || (!hasEmail && !(showToggle && !sendEmail))}
              style={{ position: 'relative', minWidth: 130, justifyContent: 'center' }}
            >
              {sendPhase === 'idle' && (
                <>
                  <PlaneSVG />
                  {cfg.sendLabel || 'Send Email'}
                </>
              )}
              {sendPhase === 'sending' && (
                <>
                  <span className="send-plane"><PlaneSVG /></span>
                  Sending
                  <span className="send-dots">
                    <span className="send-dot" />
                    <span className="send-dot" />
                    <span className="send-dot" />
                  </span>
                </>
              )}
              {(sendPhase === 'sent' || sendPhase === 'closing') && '✓ Sent!'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
