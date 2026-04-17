import { createContext, useContext, useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'hr_selected_job';

const SelectedJobContext = createContext(null);

export function SelectedJobProvider({ children }) {
  const [selectedJob, setSelectedJobState] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && obj.id) return obj;
      }
    } catch {}
    return null;
  });

  const setSelectedJob = useCallback((job) => {
    if (!job || !job.id) {
      setSelectedJobState(null);
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      return;
    }
    const normalized = {
      id: parseInt(job.id),
      job_title: job.job_title || '',
      department: job.department || '',
    };
    setSelectedJobState(normalized);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized)); } catch {}
  }, []);

  const clearSelectedJob = useCallback(() => {
    setSelectedJobState(null);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }, []);

  return (
    <SelectedJobContext.Provider value={{ selectedJob, setSelectedJob, clearSelectedJob }}>
      {children}
    </SelectedJobContext.Provider>
  );
}

export function useSelectedJob() {
  const ctx = useContext(SelectedJobContext);
  if (!ctx) throw new Error('useSelectedJob must be used within SelectedJobProvider');
  return ctx;
}
