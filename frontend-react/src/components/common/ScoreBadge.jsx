import { scoreClass } from '../../utils/helpers';

export default function ScoreBadge({ score }) {
  if (score == null) return <span style={{ color: 'var(--gray-400)', fontStyle: 'italic', fontSize: '13px' }}>Not evaluated</span>;
  const s = parseFloat(score);
  return <span className={`score-badge ${scoreClass(s)}`}>{s.toFixed(1)}</span>;
}
