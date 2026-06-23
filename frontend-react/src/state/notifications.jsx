import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { apiGet } from '../services/api';
import { useAuth } from './auth';
import { useUI } from './uiState';

// Global notification centre. Holds persisted events (e.g. inbound email replies)
// and polls the backend so the header bell surfaces them even when the user is on
// another tab. Transient "AI is running" status is layered on top by the bell
// itself (it reads evalStatus live) — only discrete events are stored here.
const NotificationsContext = createContext(null);

const STORE_KEY = 'hr_notifications';        // persisted notification list
const SEEN_KEY  = 'hr_notif_seen_inbound';   // highest inbound email id already surfaced
const SEEN_SESS_KEY = 'hr_notif_seen_session'; // highest completed-interview session id surfaced
const MAX_ITEMS = 50;
const POLL_MS   = 60000;

export function NotificationsProvider({ children }) {
  const { user } = useAuth();
  const { showToast } = useUI();
  const [items, setItems] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
  });
  const pollRef = useRef(null);

  const write = (next) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(next.slice(0, MAX_ITEMS))); } catch {} };

  const addNotification = useCallback((n) => {
    setItems(prev => {
      if (n.dedupeKey && prev.some(p => p.dedupeKey === n.dedupeKey)) return prev;
      const item = {
        id: n.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ts: Date.now(), read: false, ...n,
      };
      const next = [item, ...prev].slice(0, MAX_ITEMS);
      write(next);
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setItems(prev => { const next = prev.map(i => ({ ...i, read: true })); write(next); return next; });
  }, []);
  const removeItem = useCallback((id) => {
    setItems(prev => { const next = prev.filter(i => i.id !== id); write(next); return next; });
  }, []);
  const clearAll = useCallback(() => { setItems([]); write([]); }, []);

  const unreadCount = items.reduce((n, i) => n + (i.read ? 0 : 1), 0);

  // Poll for new inbound email replies across every job and surface each new one.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function poll() {
      try {
        const jobsRes = await apiGet('/job-openings');
        const jobs = jobsRes.data || [];
        const lists = await Promise.all(
          jobs.map(j => apiGet(`/email-history?job_id=${j.id}`).then(r => r.data || []).catch(() => []))
        );
        const inbound = lists.flat().filter(e => e && e.direction === 'inbound' && e.id);
        // NOTE: guard with `if`, don't `return` — an early return here would also
        // skip the completed-interview check below when there are no email replies.
        if (!cancelled && inbound.length) {
          const maxSeen = Number(localStorage.getItem(SEEN_KEY) || 0);
          const newMax = Math.max(maxSeen, ...inbound.map(e => Number(e.id)));
          localStorage.setItem(SEEN_KEY, String(newMax));

          // First run just sets the baseline so we don't replay the whole history.
          if (maxSeen !== 0) {
            const fresh = inbound.filter(e => Number(e.id) > maxSeen);
            fresh.forEach(e => addNotification({
              type: 'email',
              dedupeKey: `email-${e.id}`,
              icon: '📥',
              title: `New reply from ${e.recipient_email || 'a candidate'}`,
              body: e.subject || '(no subject)',
              nav: '/emails',
            }));
            if (fresh.length) {
              showToast(fresh.length === 1
                ? `📥 New email reply from ${fresh[0].recipient_email || 'a candidate'}`
                : `📥 ${fresh.length} new email replies`, 'info');
            }
          }
        }
      } catch {}

      // ── Completed AI interviews ──
      try {
        const jobsRes = await apiGet('/job-openings');
        const jobs = jobsRes.data || [];
        const sessLists = await Promise.all(
          jobs.map(j => apiGet(`/interview/sessions?jobId=${j.id}`).then(r => (Array.isArray(r) ? r : r.data) || []).catch(() => []))
        );
        const sessions = sessLists.flat().filter(s => s && s.id);
        if (cancelled) return;
        // Use key-EXISTENCE (not value) as the "baseline established" marker. The
        // old `seen === 0` check meant that when there were no prior sessions, the
        // very first completed interview was treated as baseline and never notified.
        const seenRaw = localStorage.getItem(SEEN_SESS_KEY);
        const baselined = seenRaw !== null;
        const seen = Number(seenRaw || 0);
        const newMax = sessions.length ? Math.max(seen, ...sessions.map(s => Number(s.id))) : seen;
        localStorage.setItem(SEEN_SESS_KEY, String(newMax)); // records baseline even at 0
        if (!baselined) return; // first run only establishes the baseline
        const freshSess = sessions.filter(s => Number(s.id) > seen);
        freshSess.forEach(s => addNotification({
          type: 'interview',
          dedupeKey: `sess-${s.id}`,
          icon: '🎤',
          title: `${s.candidateName || 'A candidate'} completed the interview`,
          body: 'Tap to view the results',
          nav: s.candidateId ? `/live-interview?tab=results&focus=${s.candidateId}` : '/live-interview?tab=results',
        }));
        if (freshSess.length) {
          showToast(freshSess.length === 1
            ? `🎤 ${freshSess[0].candidateName || 'A candidate'} completed the interview`
            : `🎤 ${freshSess.length} interviews completed`, 'success');
        }
      } catch {}
    }

    poll();
    pollRef.current = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(pollRef.current); };
  }, [user, addNotification]);

  return (
    <NotificationsContext.Provider value={{ items, unreadCount, addNotification, markAllRead, removeItem, clearAll }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider');
  return ctx;
}
