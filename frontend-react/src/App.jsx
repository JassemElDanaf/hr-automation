import { BrowserRouter, Routes, Route, Outlet, Navigate } from 'react-router-dom';
import { SelectedJobProvider } from './state/selectedJob';
import { UIProvider } from './state/uiState';
import Header from './components/layout/Header';
import NavTabs from './components/layout/NavTabs';
import Toast from './components/common/Toast';
import EmailComposerModal from './components/modals/EmailComposerModal';
import Dashboard from './pages/Dashboard';
import JobOpenings from './pages/JobOpenings';
import CVEvaluation from './pages/CVEvaluation';
import Shortlist from './pages/Shortlist';
import Emails from './pages/Emails';
import LiveInterview from './pages/LiveInterview';
import CandidateInterview from './pages/CandidateInterview';
import TalentPool from './pages/TalentPool';
import './styles/global.css';

function HRLayout() {
  return (
    <>
      <Header />
      <NavTabs />
      <Outlet />
      <Toast />
      <EmailComposerModal />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <SelectedJobProvider>
        <UIProvider>
          <Routes>
            {/* Standalone candidate-facing route — no HR chrome */}
            <Route path="/interview/:token" element={<CandidateInterview />} />

            {/* HR dashboard routes — full layout */}
            <Route element={<HRLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/jobs" element={<JobOpenings />} />
              <Route path="/cv-eval" element={<CVEvaluation />} />
              <Route path="/shortlist" element={<Shortlist />} />
              <Route path="/emails" element={<Emails />} />
              <Route path="/talent-pool" element={<TalentPool />} />
              <Route path="/live-interview" element={<LiveInterview />} />
              {/* AI Interviews now lives as the Results sub-tab of Interview */}
              <Route path="/ai-interviews" element={<Navigate to="/live-interview?tab=results" replace />} />
            </Route>
          </Routes>
        </UIProvider>
      </SelectedJobProvider>
    </BrowserRouter>
  );
}
