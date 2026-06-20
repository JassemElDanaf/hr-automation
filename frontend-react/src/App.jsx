import { BrowserRouter, Routes, Route, Outlet, Navigate } from 'react-router-dom';
import { SelectedJobProvider } from './state/selectedJob';
import { UIProvider } from './state/uiState';
import { EvalStatusProvider } from './state/evalStatus';
import { NotificationsProvider } from './state/notifications';
import { AuthProvider, useAuth } from './state/auth';
import { ThemeProvider } from './state/theme';
import Header from './components/layout/Header';
import NavTabs from './components/layout/NavTabs';
import Toast from './components/common/Toast';
import EmailComposerModal from './components/modals/EmailComposerModal';
import ConfirmDialog from './components/modals/ConfirmDialog';
import Login from './pages/Login';
import Users from './pages/Users';
import EmailTemplates from './pages/EmailTemplates';
import AuditLog from './pages/AuditLog';
import Dashboard from './pages/Dashboard';
import JobOpenings from './pages/JobOpenings';
import CVEvaluation from './pages/CVEvaluation';
import Shortlist from './pages/Shortlist';
import Emails from './pages/Emails';
import LiveInterview from './pages/LiveInterview';
import CandidateInterview from './pages/CandidateInterview';
import TalentPool from './pages/TalentPool';
import Decision from './pages/Decision';
import './styles/global.css';

function HRLayout() {
  return (
    <>
      <Header />
      <NavTabs />
      <Outlet />
      <Toast />
      <EmailComposerModal />
      <ConfirmDialog />
    </>
  );
}

// Gate the HR app behind login. The candidate interview route is mounted
// outside this, so candidates never see a login wall.
function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray-400)', fontSize: 14 }}>Loading…</div>;
  if (!user) return <Login />;
  return <HRLayout />;
}

function AdminOnly({ children }) {
  const { isAdmin } = useAuth();
  return isAdmin ? children : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
      <AuthProvider>
        <SelectedJobProvider>
          <UIProvider>
            <NotificationsProvider>
            <EvalStatusProvider>
              <Routes>
              {/* Standalone candidate-facing route — public, no auth, no HR chrome */}
              <Route path="/interview/:token" element={<CandidateInterview />} />

              {/* HR dashboard routes — require login */}
              <Route element={<RequireAuth />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/jobs" element={<JobOpenings />} />
                <Route path="/cv-eval" element={<CVEvaluation />} />
                <Route path="/shortlist" element={<Shortlist />} />
                <Route path="/emails" element={<Emails />} />
                <Route path="/talent-pool" element={<TalentPool />} />
                <Route path="/live-interview" element={<LiveInterview />} />
                <Route path="/decision" element={<Decision />} />
                <Route path="/users" element={<AdminOnly><Users /></AdminOnly>} />
                <Route path="/email-templates" element={<AdminOnly><EmailTemplates /></AdminOnly>} />
                <Route path="/audit-log" element={<AdminOnly><AuditLog /></AdminOnly>} />
                {/* AI Interviews now lives as the Results sub-tab of Interview */}
                <Route path="/ai-interviews" element={<Navigate to="/live-interview?tab=results" replace />} />
              </Route>
              </Routes>
            </EvalStatusProvider>
            </NotificationsProvider>
          </UIProvider>
        </SelectedJobProvider>
      </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
