// Mobile replacement for the "Show:" filter pills — a single compact dropdown so
// the filter bar stays one tidy line (Show ▾ … Sort by ▾) instead of a row of
// sliding pills. Hidden on desktop via CSS (.results-show-select); the pills show
// there instead. Pass the SAME { key, label, count } array the pills are built
// from so the options + counts stay in sync.
export default function ShowSelect({ filters, value, onChange }) {
  return (
    <select
      className="results-show-select"
      value={value}
      onChange={e => onChange(e.target.value)}
      aria-label="Show filter"
    >
      {filters.map(f => (
        <option key={f.key} value={f.key}>
          {f.label}{f.count != null ? ` · ${f.count}` : ''}
        </option>
      ))}
    </select>
  );
}
