import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../../state/notifications';
import { useEvalStatus } from '../../state/evalStatus';
import { useServiceStatuses, SERVICES } from '../../state/serviceStatus';

// Header notification centre. Combines:
//  • a live "AI is running" row driven by evalStatus (Ollama activity),
//  • live service health (n8n / Ollama / SMTP / DB) + offline/recovery alerts, and
//  • stored events (inbound email replies, finished AI tasks).
export default function NotificationBell() {
  const navigate = useNavigate();
  const { items, unreadCount, markAllRead, removeItem, clearAll, addNotification } = useNotifications();
  const { evalState, aiTask } = useEvalStatus();
  const { statuses, recheck } = useServiceStatuses();
  const [open, setOpen] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [expanded, setExpanded] = useState(false);   // pill slid out of the bell?
  const [displayItem, setDisplayItem] = useState(null); // retained during slide-back
  const ref = useRef(null);

  // Notify when a service drops or recovers (skip the initial 'checking' baseline).
  const prevStates = useRef({});
  useEffect(() => {
    SERVICES.forEach(svc => {
      const cur = statuses[svc.key]?.state;
      const prev = prevStates.current[svc.key];
      if (cur && cur !== 'checking') {
        if (prev && prev !== 'checking' && prev !== cur) {
          if (cur === 'offline') {
            addNotification({ type: 'service', dedupeKey: `svc-down-${svc.key}-${Date.now()}`, icon: '⚠️',
              title: `${svc.label} went offline`, body: svc.offlineHint, nav: null });
          } else if (cur === 'online') {
            addNotification({ type: 'service', dedupeKey: `svc-up-${svc.key}-${Date.now()}`, icon: '✅',
              title: `${svc.label} is back online`, body: 'Service recovered', nav: null });
          }
        }
        prevStates.current[svc.key] = cur;
      }
    });
  }, [statuses, addNotification]);

  // Log AI tasks into the notification history when they finish, so there's a
  // record after the live row disappears. Keyed so each run logs once.
  const lastAiKey = useRef(null);
  useEffect(() => {
    if (aiTask && (aiTask.phase === 'done' || aiTask.phase === 'error')) {
      const key = `${aiTask.label}-${aiTask.phase}-${aiTask.nav?.to || ''}`;
      if (lastAiKey.current !== key) {
        lastAiKey.current = key;
        addNotification({
          type: 'ai',
          icon: aiTask.phase === 'error' ? '⚠️' : '✨',
          title: aiTask.phase === 'error' ? 'AI task failed' : aiTask.label.replace(/…$/, '') + ' — done',
          body: aiTask.nav?.hint || 'Local AI · Ollama',
          nav: aiTask.nav?.to || null,
        });
      }
    } else if (!aiTask) {
      lastAiKey.current = null;
    }
  }, [aiTask, addNotification]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // Live "running now" rows from Ollama activity.
  const live = [];
  if (evalState && evalState.phase === 'running') {
    live.push({ id: '_eval', icon: '⏳', title: 'AI evaluating CVs…',
      body: `${evalState.done}/${evalState.total} · ${evalState.jobTitle}`, nav: '/cv-eval' });
  }
  if (aiTask && aiTask.phase === 'running') {
    live.push({ id: '_ai', icon: '⏳', title: aiTask.label,
      body: aiTask.nav?.hint || 'Local AI · Ollama', nav: aiTask.nav?.to || null });
  }

  const offlineCount = Object.values(statuses).filter(s => s.state === 'offline').length;
  const totalBadge = unreadCount + live.length + offlineCount;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unreadCount) markAllRead();
  }
  function go(nav) { if (nav) { navigate(nav); setOpen(false); } }
  async function handleRecheck(e) { e.stopPropagation(); setRechecking(true); await recheck(); setRechecking(false); }

  // A live activity pill slides out of the bell while a task runs, and slides
  // back in when it finishes. `displayItem` is retained through the slide-back so
  // the text doesn't vanish before the animation completes.
  const runningItem = live[0];
  const runKey = runningItem ? `${runningItem.title}|${runningItem.body}` : '';
  const pct = (evalState && evalState.phase === 'running' && evalState.total > 1)
    ? Math.round((evalState.done / evalState.total) * 100) : null;

  useEffect(() => {
    if (runningItem) { setDisplayItem(runningItem); setExpanded(true); }
    else { setExpanded(false); const t = setTimeout(() => setDisplayItem(null), 460); return () => clearTimeout(t); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      {/* Sliding status pill — emerges from the bell while a task runs. */}
      <button type="button" onClick={toggle} title="Open notifications"
        aria-hidden={!expanded} tabIndex={expanded ? 0 : -1}
        style={{ display: 'flex', alignItems: 'center', gap: 9, height: 40, overflow: 'hidden', whiteSpace: 'nowrap',
          borderRadius: 22, border: `1px solid ${expanded ? 'var(--gray-200)' : 'transparent'}`,
          background: open ? 'var(--gray-50)' : 'var(--surface)', cursor: 'pointer', fontFamily: 'inherit',
          maxWidth: expanded ? 460 : 0, opacity: expanded ? 1 : 0,
          paddingLeft: expanded ? 11 : 0, paddingRight: expanded ? 14 : 0,
          marginRight: expanded ? 9 : 0, transform: expanded ? 'translateX(0)' : 'translateX(14px)',
          pointerEvents: expanded ? 'auto' : 'none',
          transition: 'max-width 420ms cubic-bezier(.34,1.2,.5,1), opacity 260ms ease, transform 420ms cubic-bezier(.34,1.2,.5,1), margin-right 420ms ease, padding 420ms ease' }}>
        <span style={{ width: 18, height: 18, borderRadius: '50%', border: '2.5px solid var(--gray-200)',
          borderTopColor: '#7c3aed', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
        <span style={{ textAlign: 'left', lineHeight: 1.25 }}>
          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--gray-800)', whiteSpace: 'nowrap' }}>{displayItem?.title}</span>
          {displayItem?.body && <span style={{ display: 'block', fontSize: 10.5, color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>{displayItem.body}</span>}
        </span>
        {pct != null && <span style={{ fontSize: 12, fontWeight: 800, color: '#7c3aed', flexShrink: 0 }}>{pct}%</span>}
      </button>

      {/* Bell — always present. */}
      <button type="button" onClick={toggle} title="Notifications"
        style={{ position: 'relative', width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--gray-200)',
          background: open ? 'var(--gray-50)' : 'var(--surface)', cursor: 'pointer', fontSize: 18, lineHeight: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        🔔
        {totalBadge > 0 && (
          <span style={{ position: 'absolute', top: -3, right: -3, minWidth: 18, height: 18, padding: '0 5px',
            borderRadius: 9, background: '#dc2626', color: '#fff', fontSize: 11, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--surface)' }}>
            {totalBadge > 9 ? '9+' : totalBadge}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 320, width: 320,
          background: 'var(--surface)', border: '1px solid var(--gray-200)', borderRadius: 12,
          boxShadow: '0 10px 34px rgba(0,0,0,0.16)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--gray-900)' }}>Notifications</span>
            {items.length > 0 && (
              <button onClick={clearAll} style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 600, color: 'var(--gray-400)',
                background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Clear all</button>
            )}
          </div>

          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {live.map(n => (
              <Row key={n.id} n={n} live onClick={() => go(n.nav)} />
            ))}
            {items.length === 0 && live.length === 0 && (
              <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--gray-400)', fontSize: 12.5 }}>
                You're all caught up.
              </div>
            )}
            {items.map(n => (
              <Row key={n.id} n={n} onClick={() => go(n.nav)} onRemove={() => removeItem(n.id)} />
            ))}
          </div>

          {/* Service health */}
          <div style={{ borderTop: '1px solid var(--gray-100)', background: 'var(--gray-50)', padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--gray-500)' }}>Services</span>
              <button onClick={handleRecheck} disabled={rechecking} title="Recheck all services"
                style={{ marginLeft: 'auto', width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--gray-200)',
                  background: 'var(--surface)', cursor: 'pointer', fontSize: 12, color: offlineCount ? '#ef4444' : 'var(--gray-400)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  animation: rechecking ? 'spin 0.8s linear infinite' : 'none' }}>↺</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {SERVICES.map(svc => {
                const st = statuses[svc.key] || {};
                const online = st.state === 'online', offline = st.state === 'offline';
                const dot = online ? '#22c55e' : offline ? '#ef4444' : '#94a3b8';
                return (
                  <span key={svc.key} title={`${svc.label} — ${online ? 'running' : offline ? 'offline' : 'checking…'}${st.detail ? ' · ' + st.detail : ''}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 20,
                      border: '1px solid var(--gray-200)', background: 'var(--surface)' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0,
                      animation: st.state === 'checking' ? 'spin 1s linear infinite' : 'none' }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-700)' }}>{svc.label}</span>
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ n, live, onClick, onRemove }) {
  return (
    <div onClick={onClick}
      style={{ display: 'flex', gap: 11, padding: '11px 14px', borderBottom: '1px solid var(--gray-100)',
        cursor: n.nav ? 'pointer' : 'default', background: live ? 'var(--tint-blue, rgba(37,99,235,0.06))' : n.read ? 'none' : 'var(--gray-50)' }}
      onMouseEnter={e => { if (n.nav) e.currentTarget.style.background = 'var(--gray-50)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = live ? 'var(--tint-blue, rgba(37,99,235,0.06))' : n.read ? 'none' : 'var(--gray-50)'; }}>
      <span style={{ fontSize: 16, flexShrink: 0, ...(live ? { animation: 'spin 1.2s linear infinite' } : {}) }}>{n.icon || '•'}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--gray-800)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.title}</div>
        {n.body && <div style={{ fontSize: 11.5, color: 'var(--gray-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.body}</div>}
        {!live && n.ts && <div style={{ fontSize: 10.5, color: 'var(--gray-400)', marginTop: 2 }}>{timeAgo(n.ts)}</div>}
      </div>
      {!live && onRemove && (
        <button onClick={e => { e.stopPropagation(); onRemove(); }} title="Dismiss"
          style={{ background: 'none', border: 'none', color: 'var(--gray-300)', cursor: 'pointer', fontSize: 15, lineHeight: 1, flexShrink: 0, padding: 0 }}>×</button>
      )}
    </div>
  );
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
