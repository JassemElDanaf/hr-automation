import { scoreColor } from '../../utils/helpers';

// Compact horizontal score breakdown shown in the COLLAPSED list cards (Decision
// style) so HR sees the per-dimension scores at a glance without expanding.
// dims = [{ label, value }] (small), overall = { label, value } (big, with divider).
// `emptyText` renders when overall is null (e.g. "Not evaluated").
export default function ScoreStrip({ dims = [], overall, emptyText, className = '' }) {
  const fmt = v => { const n = v != null ? parseFloat(v) : NaN; return isNaN(n) ? '—' : n.toFixed(1); };
  const hasAny = (overall && overall.value != null) || dims.some(d => d.value != null);
  return (
    <div className={`score-strip ${className}`} style={{ display: 'flex', alignItems: 'center', gap: 18, flexShrink: 0 }}>
      {hasAny && dims.map(d => (
        <div key={d.label} className="score-strip-dim" style={{ textAlign: 'center', minWidth: 42 }}>
          <div style={{ fontWeight: 800, fontSize: 17, color: scoreColor(d.value), lineHeight: 1 }}>{fmt(d.value)}</div>
          <div className="score-strip-lbl" style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4, whiteSpace: 'nowrap' }}>{d.label}</div>
        </div>
      ))}
      <div className="score-strip-overall" style={{ textAlign: 'center', minWidth: 52, borderLeft: hasAny ? '1px solid var(--gray-200)' : 'none', paddingLeft: hasAny ? 16 : 0 }}>
        {overall && overall.value != null
          ? <div style={{ fontWeight: 800, fontSize: 23, color: scoreColor(overall.value), lineHeight: 1 }}>{fmt(overall.value)}</div>
          : <div style={{ fontSize: 11, color: 'var(--gray-400)', fontStyle: 'italic', lineHeight: 1.15 }}>{emptyText || '—'}</div>}
        <div className="score-strip-lbl" style={{ fontSize: 9.5, fontWeight: 600, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>{overall?.label || 'Overall'}</div>
      </div>
    </div>
  );
}
