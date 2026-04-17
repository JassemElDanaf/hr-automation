import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../services/api';
import { useSelectedJob } from '../state/selectedJob';
import { useUI } from '../state/uiState';
import StatCard from '../components/common/StatCard';
import Badge from '../components/common/Badge';
import Loading from '../components/common/Loading';
import { relativeTime } from '../utils/helpers';
import { Chart, ArcElement, DoughnutController, Legend, Tooltip } from 'chart.js';

Chart.register(ArcElement, DoughnutController, Legend, Tooltip);

export default function Dashboard() {
  const { selectedJob, setSelectedJob } = useSelectedJob();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const [allJobs, setAllJobs] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [shortlist, setShortlist] = useState([]);
  const [filterJobId, setFilterJobId] = useState('');
  const [loading, setLoading] = useState(true);
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    if (selectedJob && !filterJobId) {
      setFilterJobId(String(selectedJob.id));
    }
  }, [selectedJob]);

  async function loadDashboard() {
    setLoading(true);
    try {
      const [jobsRes, candRes, slRes] = await Promise.all([
        apiGet('/job-openings'),
        apiGet('/dashboard-candidates'),
        apiGet('/dashboard-shortlist'),
      ]);
      setAllJobs(jobsRes.data || []);
      setCandidates((candRes.data || []).filter(c => c.id));
      setShortlist((slRes.data || []).filter(s => s.id));
    } catch (err) {
      showToast('Failed to load dashboard: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  const handleFilterChange = (e) => {
    const val = e.target.value;
    setFilterJobId(val);
    if (val) {
      const job = allJobs.find(j => j.id === parseInt(val));
      if (job) setSelectedJob(job);
    }
  };

  // Filtered data
  const selectedId = filterJobId ? parseInt(filterJobId) : null;
  const filteredCandidates = selectedId ? candidates.filter(c => c.job_opening_id === selectedId) : candidates;
  const filteredShortlist = selectedId ? shortlist.filter(s => s.job_opening_id === selectedId) : shortlist;
  const filteredJobs = selectedId ? allJobs.filter(j => j.id === selectedId) : allJobs;

  // Metrics
  const activeJobs = filteredJobs.filter(j => j.is_active).length;
  const withScores = filteredCandidates.filter(c => c.overall_score != null);
  const avgScore = withScores.length ? (withScores.reduce((a, c) => a + parseFloat(c.overall_score), 0) / withScores.length).toFixed(1) : '-';
  const hiredCount = filteredShortlist.filter(s => s.status === 'hired').length;

  // Funnel
  const shortlisted = filteredShortlist.filter(s => s.status === 'shortlisted').length;
  const interviewed = filteredShortlist.filter(s => s.status === 'interviewed').length;
  const rejected = filteredShortlist.filter(s => s.status === 'rejected').length;
  const funnelStages = [
    { label: 'Applied', count: filteredCandidates.length, color: '#3b82f6' },
    { label: 'Evaluated', count: withScores.length, color: '#8b5cf6' },
    { label: 'Shortlisted', count: shortlisted, color: '#06b6d4' },
    { label: 'Interviewed', count: interviewed, color: '#f59e0b' },
    { label: 'Hired', count: hiredCount, color: '#16a34a' },
    { label: 'Rejected', count: rejected, color: '#dc2626' },
  ];

  // Chart
  useEffect(() => {
    if (!chartRef.current) return;
    const total = shortlisted + interviewed + hiredCount + rejected;
    if (chartInstance.current) chartInstance.current.destroy();
    if (total === 0) return;
    chartInstance.current = new Chart(chartRef.current, {
      type: 'doughnut',
      data: {
        labels: ['Shortlisted', 'Interviewed', 'Hired', 'Rejected'],
        datasets: [{ data: [shortlisted, interviewed, hiredCount, rejected], backgroundColor: ['#06b6d4', '#f59e0b', '#16a34a', '#dc2626'], borderWidth: 0 }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { size: 12 }, padding: 10 } } }, cutout: '65%' },
    });
    return () => { if (chartInstance.current) chartInstance.current.destroy(); };
  }, [shortlisted, interviewed, hiredCount, rejected]);

  // Top jobs
  const jobCounts = {};
  for (const c of filteredCandidates) jobCounts[c.job_opening_id] = (jobCounts[c.job_opening_id] || 0) + 1;
  const topJobs = filteredJobs.map(j => ({ ...j, candidateCount: jobCounts[j.id] || 0 })).sort((a, b) => b.candidateCount - a.candidateCount).slice(0, 8);

  // Activity
  const activity = [
    ...filteredCandidates.map(c => ({ type: 'applied', at: c.submitted_at, text: `${c.candidate_name} applied` })),
    ...filteredShortlist.map(s => ({ type: s.status, at: s.updated_at, text: `${s.candidate_name} \u2192 ${s.status}` })),
  ].filter(a => a.at).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 10);

  const colors = { applied: '#3b82f6', shortlisted: '#06b6d4', interviewed: '#f59e0b', hired: '#16a34a', rejected: '#dc2626' };

  if (loading) return <div className="container"><Loading /></div>;

  return (
    <div className="container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '22px', fontWeight: 700 }}>Hiring Dashboard</h2>
          <p style={{ fontSize: '13px', color: 'var(--gray-500)' }}>Overview of your recruiting pipeline.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label style={{ fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap', color: 'var(--gray-600)' }}>View:</label>
          <select value={filterJobId} onChange={handleFilterChange} style={{ minWidth: '240px' }}>
            <option value="">All Jobs</option>
            {allJobs.map(j => <option key={j.id} value={j.id}>{j.job_title}</option>)}
          </select>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: '16px' }}>
        <StatCard label="Active Jobs" value={activeJobs} />
        <StatCard label="Total Candidates" value={filteredCandidates.length} />
        <StatCard label="Avg Score" value={avgScore} />
        <StatCard label="Hired" value={hiredCount} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        <div className="table-wrap" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px' }}>Hiring Funnel</h3>
          {funnelStages.map(s => (
            <div key={s.label} style={{ marginBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px', fontSize: '13px' }}>
                <span style={{ fontWeight: 600, color: 'var(--gray-700)' }}>{s.label}</span>
                <span style={{ fontWeight: 700, color: s.color }}>{s.count}</span>
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${filteredCandidates.length > 0 ? (s.count / filteredCandidates.length) * 100 : 0}%`, background: s.color }}></div>
              </div>
            </div>
          ))}
        </div>
        <div className="table-wrap" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px' }}>Candidates by Status</h3>
          {shortlisted + interviewed + hiredCount + rejected > 0
            ? <canvas ref={chartRef} style={{ maxHeight: '240px' }}></canvas>
            : <div className="empty-state" style={{ padding: '40px 0' }}><p>No candidates on the shortlist yet.</p></div>
          }
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
        <div className="table-wrap">
          <div className="table-header">
            <h2 style={{ fontSize: '15px' }}>Top Jobs by Candidate Count</h2>
            <button className="btn btn-secondary btn-sm" onClick={loadDashboard}>Refresh</button>
          </div>
          {topJobs.length === 0 ? <div className="empty-state"><p>No jobs yet.</p></div> : (
            <table>
              <thead><tr><th>Job</th><th>Dept</th><th>Candidates</th><th>Status</th></tr></thead>
              <tbody>
                {topJobs.map(j => (
                  <tr key={j.id}>
                    <td><strong style={{ cursor: 'pointer', color: 'var(--primary)' }} onClick={() => navigate('/jobs')}>{j.job_title}</strong></td>
                    <td style={{ color: 'var(--gray-500)', fontSize: '13px' }}>{j.department || '\u2014'}</td>
                    <td><strong>{j.candidateCount}</strong></td>
                    <td><Badge type={j.is_active ? 'active' : 'inactive'}>{j.is_active ? 'Active' : 'Inactive'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="table-wrap">
          <div className="table-header"><h2 style={{ fontSize: '15px' }}>Recent Activity</h2></div>
          <div style={{ padding: '12px 16px' }}>
            {activity.length === 0 ? <p style={{ color: 'var(--gray-400)', padding: '20px', textAlign: 'center' }}>No activity yet.</p> : (
              activity.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: '10px', padding: '8px 0', borderBottom: '1px solid var(--gray-100)', fontSize: '13px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: colors[a.type] || '#999', marginTop: '6px', flexShrink: 0 }}></div>
                  <div style={{ flex: 1 }}>
                    <div>{a.text}</div>
                    <div style={{ color: 'var(--gray-400)', fontSize: '12px' }}>{relativeTime(a.at)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
