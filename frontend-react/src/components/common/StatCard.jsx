export default function StatCard({ label, value, style }) {
  return (
    <div className="stat-card">
      <div className="label">{label}</div>
      <div className="value" style={style}>{value}</div>
    </div>
  );
}
