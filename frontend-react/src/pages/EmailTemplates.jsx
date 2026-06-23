import { useEffect, useState } from 'react';
import { useUI } from '../state/uiState';
import { TEMPLATE_DEFS, effectiveTemplate, setTemplateOverrides } from '../services/email';
import { listEmailTemplates, saveEmailTemplate } from '../services/auth';
import Loading from '../components/common/Loading';

// Admin-only editor for every email template — candidate-facing (rejection,
// shortlist, interview invite, offer) and hiring-manager-facing (recommendation,
// interview pack). Overrides are stored in the DB (auth sidecar); the built-in
// defaults live in services/email.js.
export default function EmailTemplates() {
  const { showToast } = useUI();
  const [loading, setLoading] = useState(true);
  const [overrides, setOverrides] = useState({});

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    try { const t = await listEmailTemplates(); setTemplateOverrides(t); setOverrides(t); }
    catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(false); }
  }

  return (
    <div className="container">
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--gray-900)' }}>Email Templates</h2>
        <p style={{ fontSize: 14, color: 'var(--gray-500)', marginTop: 4 }}>
          Edit any email the system sends — to candidates and to hiring managers. Placeholder tokens like <code>{'{candidate_name}'}</code> are filled in automatically when an email is sent. On the hiring-manager templates, tokens like <code>{'{evaluation_summary}'}</code> or <code>{'{questions}'}</code> insert generated content — move them around, but don't edit inside them.
        </p>
      </div>
      {loading ? <Loading /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {Object.keys(TEMPLATE_DEFS).map(key => (
            <TemplateCard key={key + JSON.stringify(overrides[key] || '')} tkey={key} overridden={!!overrides[key]} onSaved={load} showToast={showToast} />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({ tkey, overridden, onSaved, showToast }) {
  const def = TEMPLATE_DEFS[tkey];
  const eff = effectiveTemplate(tkey);
  const [subject, setSubject] = useState(eff.subject);
  const [body, setBody] = useState(eff.body);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false); // collapsed by default — expand only the one you want to edit

  const dirty = subject !== eff.subject || body !== eff.body;

  async function save() {
    setSaving(true);
    try { await saveEmailTemplate(tkey, subject, body); showToast(`"${def.name}" saved`, 'success'); onSaved(); }
    catch (e) { showToast(e.message, 'error'); setSaving(false); }
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--gray-200)', borderRadius: 12, padding: 18 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: open ? 10 : 0, cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ fontSize: 12, color: 'var(--gray-400)', transition: 'transform 150ms ease', transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--gray-900)' }}>{def.name}</h3>
        {overridden && <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '2px 8px', borderRadius: 10, background: 'var(--tint-info)', color: 'var(--primary)' }}>Edited</span>}
        {!open && dirty && <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>Unsaved changes</span>}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--gray-400)' }}>{tkey}</span>
      </div>
      {!open ? null : (
      <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, marginTop: 12 }}>
        {def.placeholders.map(p => (
          <code key={p} style={{ fontSize: 11.5, padding: '2px 8px', borderRadius: 6, background: 'var(--gray-100)', color: 'var(--gray-600)' }}>{`{${p}}`}</code>
        ))}
      </div>
      <label style={lbl}>Subject</label>
      <input style={inp} value={subject} onChange={e => setSubject(e.target.value)} />
      <label style={{ ...lbl, marginTop: 12 }}>Body</label>
      <textarea style={{ ...inp, minHeight: 190, lineHeight: 1.6, resize: 'vertical' }} value={body} onChange={e => setBody(e.target.value)} />
      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save'}</button>
        <button className="btn btn-secondary btn-sm" onClick={() => { setSubject(def.subject); setBody(def.body); }}>Reset to default</button>
        {dirty && <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>Unsaved changes</span>}
      </div>
      </>
      )}
    </div>
  );
}

const lbl = { display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--gray-600)', marginBottom: 5 };
const inp = { width: '100%', padding: '9px 11px', fontSize: 13.5, border: '1px solid var(--gray-300)', borderRadius: 8, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', background: 'var(--surface)', color: 'var(--gray-800)' };
