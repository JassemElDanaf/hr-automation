import { useState, useRef, useEffect } from 'react';

// App-wide dropdown so every selector looks identical (replaces native <select>).
// Theme-aware via CSS variables. options: [{ value, label, badge?, disabled? }].
export default function Select({ value, onChange, options = [], placeholder = 'Select…', disabled, style, menuWidth }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const selected = options.find((o) => String(o.value) === String(value));

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', minWidth: 240, ...style }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '9px 12px', borderRadius: 10, cursor: disabled ? 'not-allowed' : 'pointer',
          border: `1px solid ${open ? 'var(--primary)' : 'var(--gray-300)'}`,
          background: 'var(--surface)', color: 'var(--gray-800)', fontFamily: 'inherit',
          fontSize: 14, fontWeight: 500, textAlign: 'left',
          boxShadow: open ? '0 0 0 3px rgba(37,99,235,0.12)' : 'none',
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
      >
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {selected ? selected.label : <span style={{ color: 'var(--gray-400)' }}>{placeholder}</span>}
        </span>
        <span style={{ color: 'var(--gray-400)', fontSize: 10, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 250,
          width: menuWidth || '100%', minWidth: '100%', maxHeight: 320, overflowY: 'auto',
          background: 'var(--surface)', border: '1px solid var(--gray-200)', borderRadius: 12,
          boxShadow: '0 12px 32px rgba(0,0,0,0.18)', padding: 6,
        }}>
          {options.length === 0 && <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--gray-400)' }}>No options</div>}
          {options.map((o) => {
            const isSel = String(o.value) === String(value);
            return (
              <button
                key={o.value}
                type="button"
                disabled={o.disabled}
                onClick={() => { if (!o.disabled) { onChange(o.value); setOpen(false); } }}
                onMouseEnter={(e) => { if (!o.disabled && !isSel) e.currentTarget.style.background = 'var(--gray-50)'; }}
                onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = 'none'; }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '9px 10px', borderRadius: 8, border: 'none', textAlign: 'left',
                  background: isSel ? 'var(--tint-info)' : 'none', cursor: o.disabled ? 'not-allowed' : 'pointer',
                  color: o.disabled ? 'var(--gray-400)' : 'var(--gray-800)', fontFamily: 'inherit', fontSize: 13.5,
                  opacity: o.disabled ? 0.7 : 1,
                }}
              >
                <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: isSel ? 600 : 500 }}>{o.label}</span>
                {o.badge && <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', padding: '1px 7px', borderRadius: 8, background: 'var(--tint-danger)', color: '#dc2626' }}>{o.badge}</span>}
                {isSel && <span style={{ color: 'var(--primary)', fontWeight: 700, flexShrink: 0 }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
