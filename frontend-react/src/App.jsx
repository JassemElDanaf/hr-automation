import { BrowserRouter, Routes, Route } from 'react-router-dom';
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
import './styles/global.css';

export default function App() {
  return (
    <BrowserRouter>
      <SelectedJobProvider>
        <UIProvider>
          <Header />
          <NavTabs />
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/jobs" element={<JobOpenings />} />
            <Route path="/cv-eval" element={<CVEvaluation />} />
            <Route path="/shortlist" element={<Shortlist />} />
            <Route path="/emails" element={<Emails />} />
          </Routes>
          <Toast />
          <EmailComposerModal />
        </UIProvider>
      </SelectedJobProvider>
    </BrowserRouter>
  );
}
