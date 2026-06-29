import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { apiPost } from '../services/api';
import { COMPANY_NAME, BRAND_NAME } from '../config/brand';

function formatTime(s) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function decodeToken(token) {
  try {
    // Tokens are URL-safe base64 ('-'/'_' for '+'/'/', padding stripped).
    let b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch { return null; }
}

const MAX_QUESTIONS = 5;
const CAT_BG    = { hr: '#eff6ff', technical: '#f0fdf4', salary: '#fffbeb', iqama: '#f5f3ff', notice: '#fef2f2', location: '#ecfeff' };
const CAT_COLOR = { hr: '#2563eb', technical: '#16a34a', salary: '#d97706', iqama: '#7c3aed', notice: '#dc2626', location: '#0891b2' };
const CAT_LABEL = { hr: 'Behavioural', technical: 'Technical', salary: 'Salary', iqama: 'Visa', notice: 'Notice Period', location: 'Location' };

const CI_STYLES = `
  @keyframes ci-dot {
    0%,80%,100% { transform:scale(0.55); opacity:0.35; }
    40%         { transform:scale(1);    opacity:1; }
  }
  @keyframes ci-check {
    from { stroke-dashoffset:100; opacity:0; }
    60%  { opacity:1; }
    to   { stroke-dashoffset:0; opacity:1; }
  }
  @keyframes ci-fadein {
    from { opacity:0; transform:translateY(8px); }
    to   { opacity:1; transform:translateY(0); }
  }
  @keyframes ci-slideup {
    from { opacity:0; transform:translateY(16px); }
    to   { opacity:1; transform:translateY(0); }
  }
  @keyframes ci-blink {
    0%,100% { opacity:1; }
    50%     { opacity:0.2; }
  }
  @keyframes ci-wave {
    0%,100% { transform:scaleY(0.35); }
    50%     { transform:scaleY(1); }
  }

  * { box-sizing:border-box; }

  .ci-page {
    display:flex; flex-direction:column; width:100vw; height:100vh;
    background:#f3f4f6; overflow:hidden;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    color:#111827;
  }

  /* ── Topbar ── */
  .ci-top {
    flex:0 0 54px; display:flex; align-items:center; justify-content:space-between;
    padding:0 24px; background:#fff; border-bottom:1px solid #e5e7eb; flex-shrink:0;
  }
  .ci-brand { font-size:15px; font-weight:700; color:#111827; }
  .ci-brand em { color:#2563eb; font-style:normal; }
  .ci-top-right { display:flex; align-items:center; gap:14px; }
  .ci-chip {
    display:inline-flex; align-items:center; gap:5px; padding:4px 11px;
    border-radius:99px; font-size:11px; font-weight:700; letter-spacing:0.05em;
    text-transform:uppercase; border:1px solid;
  }
  .ci-chip.idle  { background:#f9fafb; color:#9ca3af; border-color:#e5e7eb; }
  .ci-chip.live  { background:#fef2f2; color:#dc2626; border-color:#fecaca; }
  .ci-chip.ended { background:#f0fdf4; color:#16a34a; border-color:#bbf7d0; }
  .ci-chip-dot { width:6px; height:6px; border-radius:50%; background:currentColor; }
  .ci-chip.live .ci-chip-dot { animation:ci-blink 1.2s ease-in-out infinite; }
  .ci-top-timer { font-size:13px; font-weight:700; color:#6b7280; font-variant-numeric:tabular-nums; }

  /* ── Body: 50/50 split ── */
  .ci-body {
    flex:1 1 0; display:grid; grid-template-columns:1fr 1fr;
    min-height:0; overflow:hidden;
  }

  /* ── LEFT: interview transcript feed ── */
  .ci-feed-col {
    display:flex; flex-direction:column; border-right:1px solid #e5e7eb;
    background:#fff; min-height:0;
  }
  .ci-feed-hdr {
    flex:0 0 44px; display:flex; align-items:center; gap:8px; padding:0 20px;
    border-bottom:1px solid #f3f4f6; flex-shrink:0;
  }
  .ci-feed-title { font-size:11px; font-weight:700; color:#9ca3af; text-transform:uppercase; letter-spacing:0.07em; }
  .ci-feed-status {
    display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:600;
  }
  .ci-feed-status.speaking { color:#16a34a; }
  .ci-feed-status.waiting  { color:#2563eb; }
  .ci-feed-status.loading  { color:#9ca3af; }
  .ci-feed-status-dot { width:5px; height:5px; border-radius:50%; background:currentColor; animation:ci-blink 2s ease-in-out infinite; }

  .ci-feed {
    flex:1 1 0; overflow-y:auto; padding:20px 20px 12px; display:flex;
    flex-direction:column; gap:0; scroll-behavior:smooth;
  }
  .ci-feed::-webkit-scrollbar { width:4px; }
  .ci-feed::-webkit-scrollbar-thumb { background:#e5e7eb; border-radius:2px; }

  /* Completed Q+A pair */
  .ci-pair { display:flex; flex-direction:column; gap:0; margin-bottom:20px; animation:ci-slideup 0.3s ease both; }

  .ci-q-bubble {
    display:flex; flex-direction:column; gap:6px;
    background:#f9fafb; border:1px solid #e5e7eb; border-radius:10px 10px 10px 3px;
    padding:14px 16px;
  }
  .ci-q-bubble-meta { display:flex; align-items:center; gap:8px; }
  .ci-q-badge { font-size:10px; font-weight:700; color:#9ca3af; text-transform:uppercase; letter-spacing:0.08em; }
  .ci-cat-pill { font-size:10px; font-weight:700; padding:2px 8px; border-radius:99px; border:1px solid; text-transform:uppercase; letter-spacing:0.05em; }
  .ci-q-bubble-text { font-size:14px; color:#111827; line-height:1.65; font-weight:500; margin:0; }

  .ci-a-bubble {
    margin-top:6px; margin-left:16px;
    background:#eff6ff; border:1px solid #dbeafe; border-radius:3px 10px 10px 10px;
    padding:12px 16px;
  }
  .ci-a-bubble-label { font-size:10px; font-weight:700; color:#93c5fd; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:5px; }
  .ci-a-bubble-text { font-size:14px; color:#1e40af; line-height:1.6; margin:0; }

  /* Active (current) question at bottom of feed */
  .ci-active-q {
    display:flex; flex-direction:column; gap:6px; margin-bottom:4px;
    background:#fff; border:2px solid #bfdbfe; border-radius:10px 10px 10px 3px;
    padding:14px 16px; animation:ci-slideup 0.35s ease both;
  }
  .ci-active-q-meta { display:flex; align-items:center; gap:8px; }
  .ci-active-q-badge { font-size:10px; font-weight:700; color:#2563eb; text-transform:uppercase; letter-spacing:0.08em; }
  .ci-active-q-text { font-size:15px; color:#111827; line-height:1.7; font-weight:600; margin:0; }

  .ci-wave-row { display:flex; align-items:center; gap:4px; padding:8px 2px 0; }
  .ci-wave-bars { display:flex; align-items:center; gap:3px; height:22px; }
  .ci-wave-bars span { display:block; width:4px; border-radius:2px; background:#bfdbfe; }
  /* Always animate — color shifts between speaking (green) and listening (blue) */
  .ci-wave-bars span:nth-child(1) { animation:ci-wave 0.7s 0s   ease-in-out infinite; height:8px;  }
  .ci-wave-bars span:nth-child(2) { animation:ci-wave 0.7s 0.14s ease-in-out infinite; height:14px; }
  .ci-wave-bars span:nth-child(3) { animation:ci-wave 0.7s 0.28s ease-in-out infinite; height:20px; }
  .ci-wave-bars span:nth-child(4) { animation:ci-wave 0.7s 0.14s ease-in-out infinite; height:14px; }
  .ci-wave-bars span:nth-child(5) { animation:ci-wave 0.7s 0s   ease-in-out infinite; height:8px;  }
  .ci-wave-bars.speaking span { background:#86efac; transition:background 0.4s; }
  .ci-wave-bars:not(.speaking) span { background:#bfdbfe; transition:background 0.4s; }
  .ci-wave-status { font-size:11px; color:#9ca3af; margin-left:8px; font-style:italic; }

  .ci-loading-dots { display:inline-flex; gap:5px; align-items:center; }
  .ci-loading-dots span { display:inline-block; width:7px; height:7px; border-radius:50%; background:#d1d5db; }
  .ci-loading-dots span:nth-child(1){animation:ci-dot 1.1s 0s    ease-in-out infinite;}
  .ci-loading-dots span:nth-child(2){animation:ci-dot 1.1s 0.18s ease-in-out infinite;}
  .ci-loading-dots span:nth-child(3){animation:ci-dot 1.1s 0.36s ease-in-out infinite;}

  /* ── RIGHT: video + answer ── */
  .ci-right-col {
    display:flex; flex-direction:column; background:#f3f4f6; min-height:0; overflow:hidden;
  }

  .ci-video-wrap {
    flex:1 1 0; position:relative; background:#1f2937; min-height:0; overflow:hidden; height:100%;
  }
  .ci-vid-label {
    position:absolute; top:12px; left:12px; z-index:2;
    font-size:11px; font-weight:700; color:rgba(255,255,255,0.75);
    background:rgba(0,0,0,0.3); padding:3px 9px; border-radius:99px;
    letter-spacing:0.05em; text-transform:uppercase; backdrop-filter:blur(4px);
  }
  .ci-vid-mic {
    position:absolute; top:12px; right:12px; z-index:2;
    width:28px; height:28px; border-radius:50%;
    display:flex; align-items:center; justify-content:center; backdrop-filter:blur(4px);
  }
  .ci-vid-mic.on  { background:rgba(37,99,235,0.75); }
  .ci-vid-mic.off { background:rgba(220,38,38,0.75); }
  .ci-video { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .ci-no-cam {
    position:absolute; inset:0; display:flex; flex-direction:column;
    align-items:center; justify-content:center; gap:10px;
    color:rgba(255,255,255,0.3); font-size:13px;
  }
  .ci-live-tx {
    position:absolute; bottom:0; left:0; right:0;
    padding:12px 14px; background:linear-gradient(transparent,rgba(0,0,0,0.65));
    font-size:13px; line-height:1.55;
  }
  .ci-tx-final  { color:#fff; display:block; }
  .ci-tx-interim { color:rgba(255,255,255,0.5); font-style:italic; }

  /* Answer panel — lives inside active question bubble */
  .ci-answer-inline {
    margin-top:10px; border-top:1px solid #dbeafe; padding-top:10px;
    display:flex; flex-direction:column; gap:6px;
  }
  .ci-ans-label {
    display:flex; align-items:center; gap:6px;
    font-size:11px; font-weight:700; color:#9ca3af; text-transform:uppercase; letter-spacing:0.06em;
  }
  .ci-ans-dot { width:6px; height:6px; border-radius:50%; background:#2563eb; animation:ci-blink 0.9s ease-in-out infinite; }
  .ci-ans-text {
    font-size:14px; color:#374151; line-height:1.6;
    min-height:38px; max-height:90px; overflow-y:auto;
  }
  .ci-ans-placeholder { color:#d1d5db; font-style:italic; }
  .ci-manual-in {
    width:100%; background:#f9fafb; border:1px solid #d1d5db; border-radius:7px;
    padding:9px 12px; font-size:13px; color:#111827; outline:none; font-family:inherit;
  }
  .ci-manual-in:focus { border-color:#2563eb; box-shadow:0 0 0 3px rgba(37,99,235,0.1); }
  .ci-manual-in::placeholder { color:#9ca3af; }
  .ci-next-row { display:flex; justify-content:flex-end; margin-top:10px; }

  /* ── Bottom bar ── */
  .ci-bar {
    flex:0 0 52px; display:flex; align-items:center; justify-content:space-between;
    padding:0 20px; background:#fff; border-top:1px solid #e5e7eb; flex-shrink:0; gap:12px;
  }
  .ci-bar-l { display:flex; align-items:center; gap:14px; }
  .ci-bar-c { display:flex; align-items:center; gap:8px; }
  .ci-bar-timer { font-size:15px; font-weight:700; color:#374151; font-variant-numeric:tabular-nums; }
  .ci-bar-qnum  { font-size:12px; color:#9ca3af; font-weight:500; }
  .ci-ibtn {
    width:38px; height:38px; border-radius:50%; border:1px solid #e5e7eb;
    cursor:pointer; display:flex; align-items:center; justify-content:center;
    transition:background 0.15s, transform 0.1s; background:#f9fafb; color:#374151;
  }
  .ci-ibtn:hover:not(:disabled) { background:#f3f4f6; }
  .ci-ibtn:active:not(:disabled) { transform:scale(0.92); }
  .ci-ibtn.mic-on  { background:#eff6ff; color:#2563eb; border-color:#bfdbfe; }
  .ci-ibtn.mic-off { background:#fef2f2; color:#dc2626; border-color:#fecaca; }
  .ci-ibtn.cam-on  { background:#f9fafb; color:#6b7280; }
  .ci-ibtn.cam-off { background:#fef2f2; color:#dc2626; border-color:#fecaca; }
  .ci-next-btn {
    padding:9px 22px; border-radius:8px; border:none; background:#2563eb; color:#fff;
    font-size:13px; font-weight:700; cursor:pointer; font-family:inherit;
    transition:background 0.15s, transform 0.1s;
  }
  .ci-next-btn:hover:not(:disabled)  { background:#1d4ed8; }
  .ci-next-btn:active:not(:disabled) { transform:scale(0.97); }
  .ci-next-btn:disabled { opacity:0.4; cursor:not-allowed; }

  /* ── Screens ── */
  .ci-screen {
    width:100vw; min-height:100vh; background:#f3f4f6;
    display:flex; align-items:center; justify-content:center; padding:32px 16px;
  }
  .ci-card {
    background:#fff; border:1px solid #e5e7eb; border-radius:12px;
    padding:36px 44px; max-width:660px; width:100%;
    box-shadow:0 4px 20px rgba(0,0,0,0.06); animation:ci-fadein 0.35s ease both;
  }
  .ci-eyebrow { font-size:11px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#2563eb; margin-bottom:10px; }
  .ci-h1 { font-size:26px; font-weight:800; color:#111827; margin-bottom:6px; line-height:1.2; }
  .ci-sub { font-size:15px; color:#6b7280; margin-bottom:22px; line-height:1.55; }
  .ci-list { list-style:none; padding:0; margin:0 0 26px; display:flex; flex-direction:column; gap:9px; }
  /* position:relative + padding-left (not flex) so an inline <strong> and the
     text after it flow together on one line instead of splitting into columns. */
  .ci-list li { position:relative; padding-left:22px; font-size:14px; color:#374151; line-height:1.55; }
  .ci-list li::before { position:absolute; left:2px; top:0; content:'›'; color:#2563eb; font-weight:700; font-size:16px; line-height:1.5; }
  .ci-go {
    width:100%; padding:13px; border:none; border-radius:8px; background:#2563eb;
    color:#fff; font-size:15px; font-weight:700; cursor:pointer; font-family:inherit; transition:background 0.15s;
  }
  .ci-go:hover:not(:disabled) { background:#1d4ed8; }
  .ci-go:disabled { opacity:0.5; cursor:not-allowed; }
  .ci-note { text-align:center; font-size:12px; color:#9ca3af; margin-top:12px; }

  .ci-check { display:flex; align-items:center; justify-content:center; margin-bottom:20px; }
  .ci-check svg circle { stroke:#16a34a; stroke-width:2; fill:#dcfce7; }
  .ci-check svg path { stroke:#16a34a; stroke-width:2.5; stroke-linecap:round; stroke-linejoin:round; stroke-dasharray:100; animation:ci-check 0.7s 0.25s cubic-bezier(.65,.05,.35,.95) both; fill:none; }
  .ci-done-h { font-size:22px; font-weight:800; color:#111827; text-align:center; margin-bottom:8px; }
  .ci-done-b { font-size:15px; color:#6b7280; text-align:center; line-height:1.7; }
  .ci-done-note { margin-top:12px; font-size:12px; color:#9ca3af; text-align:center; }
  .ci-err-icon { font-size:36px; text-align:center; margin-bottom:14px; }
  .ci-err-h { font-size:18px; font-weight:700; color:#111827; text-align:center; margin-bottom:8px; }
  .ci-err-b { font-size:14px; color:#6b7280; text-align:center; }

  @media (max-width:768px) {
    .ci-body { grid-template-columns:1fr; grid-template-rows:1fr 1fr; }
    .ci-card { padding:28px 22px; }
  }
`;

export default function CandidateInterview() {
  const { token } = useParams();
  const [tokenData, setTokenData]   = useState(null);
  const [phase, setPhase]           = useState('intro');
  const [starting, setStarting]     = useState(false);

  const [completedPairs, setCompletedPairs] = useState([]); // [{question, answer, category}]
  const [currentQ, setCurrentQ]     = useState(null);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [liveText, setLiveText]     = useState('');
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [loadingQ, setLoadingQ]     = useState(false);
  const [timer, setTimer]           = useState(0);
  const [micOn, setMicOn]           = useState(true);
  const [camOn, setCamOn]           = useState(false);
  const [hasSpeechAPI, setHasSpeechAPI] = useState(false);
  const [sttFailed, setSttFailed] = useState(false); // speech recognition unavailable → show typing fallback
  const [manualAnswer, setManualAnswer] = useState('');
  const [chipStatus, setChipStatus] = useState('idle');
  const [submitting, setSubmitting] = useState(false);
  // Pre-interview device check (intro screen)
  const [speakerState, setSpeakerState] = useState('idle'); // idle | playing
  const [devicesReady, setDevicesReady] = useState(false);
  const [deviceError, setDeviceError] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  const testStreamRef = useRef(null);
  const testVideoRef  = useRef(null);
  const audioCtxRef   = useRef(null);
  const meterRafRef   = useRef(null);

  const videoRef        = useRef(null);
  const streamRef       = useRef(null);
  const feedRef         = useRef(null);
  const timerRef        = useRef(null);
  const recognitionRef  = useRef(null);
  const silenceRef      = useRef(null);
  const currentAnswerRef = useRef('');
  const liveTextRef     = useRef('');
  const currentQRef     = useRef(null);
  const transcriptRef   = useRef([]);
  const currentQIdxRef  = useRef(0);
  const loadingQRef     = useRef(false);
  const phaseRef        = useRef('intro');
  const finalTimerRef   = useRef(0);
  const speakingRef     = useRef(false);
  const micOnRef           = useRef(true);
  const customQRef         = useRef(null);
  const mediaRecorderRef   = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingFilename  = useRef('');
  const recordingStartRef  = useRef(null); // Date.now() when recording began
  const currentQStartRef   = useRef(null); // recording-seconds when current Q was asked

  // Inject styles
  useEffect(() => {
    if (!document.getElementById('ci-css')) {
      const s = document.createElement('style'); s.id = 'ci-css'; s.textContent = CI_STYLES;
      document.head.appendChild(s);
    }
    const prevBg = document.body.style.background;
    const prevOv = document.body.style.overflow;
    document.body.style.background = '#f3f4f6';
    document.body.style.overflow = 'hidden';
    document.title = `AI Interview — ${COMPANY_NAME}`;
    return () => {
      document.body.style.background = prevBg;
      document.body.style.overflow = prevOv;
      document.title = BRAND_NAME;
      document.getElementById('ci-css')?.remove();
    };
  }, []);

  // Decode token
  useEffect(() => {
    const data = decodeToken(token);
    if (!data || !data.jobId || !data.candidateId) {
      phaseRef.current = 'error'; setPhase('error');
    } else { setTokenData(data); }
    setHasSpeechAPI(!!(window.SpeechRecognition || window.webkitSpeechRecognition));
    // Preload TTS voices — getVoices() is empty on first call in Chrome until
    // the voiceschanged event fires, so warm it up before the interview starts.
    try { window.speechSynthesis?.getVoices(); } catch {}
    return () => cleanup();
  }, [token]);

  // Wire camera stream after phase switches to 'interview'
  useEffect(() => {
    if (phase === 'interview' && videoRef.current && streamRef.current)
      videoRef.current.srcObject = streamRef.current;
  }, [phase]);

  // Wire the device-test preview AFTER the <video> mounts. Setting srcObject
  // in testDevices() ran before React rendered the element (gated on
  // devicesReady), so testVideoRef was still null → black preview.
  useEffect(() => {
    if (devicesReady && testVideoRef.current && testStreamRef.current)
      testVideoRef.current.srcObject = testStreamRef.current;
  }, [devicesReady]);

  // Auto-scroll feed to bottom when new content appears
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [completedPairs, currentQ, loadingQ]);

  function cleanup() { stopTimer(); stopSpeaking(); stopRecognition(); stopCamera(); stopDeviceTest(); }

  // ── Pre-interview device check (intro screen) ────────────────────────────────
  async function testSpeaker() {
    if (speakerState === 'playing') return;
    setSpeakerState('playing');
    try { window.speechSynthesis?.resume(); } catch {}
    // Chrome loads voices async — if not ready yet, wait up to 1s (don't block longer
    // or the browser may revoke the user-gesture context needed for audio autoplay).
    if (window.speechSynthesis && !window.speechSynthesis.getVoices().length) {
      await new Promise(r => {
        const tid = setTimeout(r, 1000);
        window.speechSynthesis.addEventListener('voiceschanged', () => { clearTimeout(tid); r(); }, { once: true });
      });
    }
    await speak('Hi! If you can hear this clearly, your speaker is working and you are ready for the interview.');
    setSpeakerState('idle');
  }

  async function testDevices() {
    setDeviceError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      testStreamRef.current = stream;
      setDevicesReady(true);
      if (testVideoRef.current) testVideoRef.current.srcObject = stream;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx(); audioCtxRef.current = ctx;
        const analyser = ctx.createAnalyser(); analyser.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          setMicLevel(Math.min(100, Math.round(avg * 1.6)));
          meterRafRef.current = requestAnimationFrame(tick);
        };
        tick();
      }
    } catch {
      setDeviceError('Could not access camera or microphone. Check your browser permissions and that no other app is using them.');
    }
  }

  function stopDeviceTest() {
    if (meterRafRef.current) { cancelAnimationFrame(meterRafRef.current); meterRafRef.current = null; }
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch {} audioCtxRef.current = null; }
    if (testStreamRef.current) { testStreamRef.current.getTracks().forEach(t => t.stop()); testStreamRef.current = null; }
    setMicLevel(0);
  }

  // Seconds into the recording — used to timestamp each question so the HM's
  // playback can overlay the question being asked at that moment.
  function recSeconds() {
    return recordingStartRef.current ? Math.round((Date.now() - recordingStartRef.current) / 1000) : null;
  }

  // ── Timer ──────────────────────────────────────────────────────────────────

  function startTimer() {
    setTimer(0); finalTimerRef.current = 0; stopTimer();
    timerRef.current = setInterval(() => {
      setTimer(t => { finalTimerRef.current = t + 1; return t + 1; });
    }, 1000);
  }
  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  // ── Camera ─────────────────────────────────────────────────────────────────

  async function startCamera() {
    try {
      // Request video + audio so MediaRecorder captures both
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCamOn(true);
    } catch {
      // Fall back to video-only (no recording audio)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCamOn(true);
      } catch { setCamOn(false); }
    }
  }

  function startRecording(candidateId, jobId) {
    if (!streamRef.current) return;
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
    try {
      recordingChunksRef.current = [];
      const options = mimeType ? { mimeType } : {};
      const rec = new MediaRecorder(streamRef.current, options);
      rec.ondataavailable = e => { if (e.data?.size > 0) recordingChunksRef.current.push(e.data); };
      rec.start(2000); // chunk every 2s
      mediaRecorderRef.current = rec;
      recordingFilename.current = `${candidateId}_${jobId}_${Date.now()}.webm`;
      recordingStartRef.current = Date.now();
    } catch { /* MediaRecorder not supported — recording silently skipped */ }
  }

  async function stopAndUploadRecording() {
    // The recorder is usually already stopped by stopCamera() in finishInterview —
    // the captured chunks survive in recordingChunksRef, so upload from those
    // rather than bailing on recorder state.
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      await new Promise(resolve => {
        rec.onstop = resolve;
        rec.stop();
      });
    }
    if (!recordingChunksRef.current.length) return null;
    try {
      const blob = new Blob(recordingChunksRef.current, { type: 'video/webm' });
      const filename = recordingFilename.current || 'recording.webm';
      // Relative path — proxied by the vite dev server to the recording
      // sidecar (:8903), so uploads work from a candidate's machine too.
      const res = await fetch(`/recording/upload?filename=${encodeURIComponent(filename)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'video/webm', 'X-Filename': filename },
        body: blob,
      });
      const json = await res.json();
      return json.success ? json.filename : null;
    } catch { return null; }
  }

  function stopCamera() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setCamOn(false);
  }
  function toggleCamera() {
    if (!streamRef.current) return;
    const tracks = streamRef.current.getVideoTracks();
    if (!tracks.length) return;
    const next = !tracks[0].enabled;
    tracks.forEach(t => { t.enabled = next; }); setCamOn(next);
  }

  // ── TTS ────────────────────────────────────────────────────────────────────

  function pickVoice() {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    const en = voices.filter(v => /^en/i.test(v.lang) && !v.name.includes('eSpeak'));
    // Prefer LOCAL (offline) voices first — network voices like "Google US English"
    // produce no sound on a restricted/offline network, which is the usual cause
    // of "I can't hear the AI". Local OS voices (e.g. Microsoft Zira/David on
    // Windows) always work without internet.
    const localEn = en.filter(v => v.localService);
    const niceLocal = ['Microsoft Zira', 'Microsoft Aria', 'Microsoft Jenny', 'Microsoft David', 'Microsoft Mark', 'Samantha', 'Karen'];
    for (const name of niceLocal) { const v = localEn.find(v => v.name.includes(name)); if (v) return v; }
    if (localEn.length) return localEn[0];
    // No local English voice — fall back to any English, then any voice at all.
    return en[0] || voices[0] || null;
  }
  function stopSpeaking() {
    window.speechSynthesis?.cancel(); speakingRef.current = false; setIsSpeaking(false);
  }
  function speak(text) {
    return new Promise(resolve => {
      const synth = window.speechSynthesis;
      if (!synth || !text) { resolve(); return; }
      let done = false, timer = null, keepAlive = null;
      const finish = () => {
        if (done) return; done = true;
        if (timer) clearTimeout(timer);
        if (keepAlive) clearInterval(keepAlive);
        speakingRef.current = false; setIsSpeaking(false);
        resolve();
      };
      const doSpeak = () => {
        try {
          const u = new SpeechSynthesisUtterance(text);
          u.rate = 0.96; u.pitch = 1.05; u.lang = 'en-US';
          const v = pickVoice(); if (v) u.voice = v;
          u.onend = finish;
          u.onerror = finish;
          speakingRef.current = true; setIsSpeaking(true);
          synth.speak(u);
          try { synth.resume(); } catch {}
          keepAlive = setInterval(() => { try { if (synth.paused) synth.resume(); } catch {} }, 3000);
          timer = setTimeout(finish, Math.min(20000, Math.max(4500, text.length * 90)));
        } catch { finish(); }
      };
      // Chrome race condition: cancel() then immediate speak() silently drops the
      // utterance. Give Chrome a tick to process the cancel before queuing the new one.
      if (synth.speaking || synth.pending) {
        synth.cancel();
        setTimeout(doSpeak, 80);
      } else {
        doSpeak();
      }
    });
  }

  // ── Recognition ────────────────────────────────────────────────────────────

  function startRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    stopRecognition();
    const rec = new SR();
    rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US';
    rec.onstart = () => setIsListening(true);
    rec.onresult = (e) => {
      if (phaseRef.current !== 'interview') return;
      let interim = '', finalChunk = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalChunk += t + ' '; else interim += t;
      }
      if (finalChunk) { currentAnswerRef.current += finalChunk; setCurrentAnswer(currentAnswerRef.current); }
      liveTextRef.current = interim;
      setLiveText(interim);
      armSilence();
    };
    rec.onend = () => {
      setIsListening(false);
      // Don't restart while loading the next question or while TTS is speaking —
      // both cases call startRecognition() explicitly when they're done.
      if (phaseRef.current === 'interview' && micOnRef.current && !loadingQRef.current && !speakingRef.current)
        setTimeout(() => { if (phaseRef.current === 'interview' && !loadingQRef.current && !speakingRef.current) startRecognition(); }, 300);
    };
    rec.onerror = (e) => {
      // Chrome's speech recognition is a NETWORK service (audio → Google). On a
      // restricted/offline network it fails with service-not-available/network;
      // mic permission issues give not-allowed/audio-capture. In all these cases
      // recognition can't capture answers, so fall back to letting the candidate
      // TYPE — otherwise every answer ends up "(no response)".
      if (['not-allowed', 'service-not-available', 'network', 'audio-capture'].includes(e.error)) {
        micOnRef.current = false; setMicOn(false); setIsListening(false); setSttFailed(true);
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        setIsListening(false);
      }
    };
    recognitionRef.current = rec;
    try { rec.start(); } catch {}
  }
  function stopRecognition() {
    clearSilence();
    if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch {} recognitionRef.current = null; }
    liveTextRef.current = '';
    setIsListening(false); setLiveText('');
  }
  function armSilence() {
    clearSilence();
    silenceRef.current = setTimeout(() => {
      if (phaseRef.current !== 'interview' || loadingQRef.current || speakingRef.current) return;
      if (currentAnswerRef.current.trim().length > 24) advanceQuestion(false);
    }, 3500);
  }
  function clearSilence() { if (silenceRef.current) { clearTimeout(silenceRef.current); silenceRef.current = null; } }
  function toggleMic() {
    const next = !micOnRef.current; micOnRef.current = next; setMicOn(next);
    if (!next) stopRecognition(); else if (phaseRef.current === 'interview') startRecognition();
  }

  // ── Interview flow ─────────────────────────────────────────────────────────

  async function startInterview() {
    if (!tokenData) return;
    setStarting(true);
    // Unlock speech synthesis *inside* the click gesture. The first real speak()
    // happens after `await startCamera()` (the camera permission prompt), by which
    // point Chrome no longer sees an active user gesture and can silently block
    // audio. Priming it here with an empty utterance keeps later speech audible.
    try { window.speechSynthesis?.resume(); window.speechSynthesis?.speak(new SpeechSynthesisUtterance('')); } catch {}
    stopDeviceTest(); // release the preview stream; startCamera re-acquires (permission already granted)
    try {
      await startCamera();
      startRecording(tokenData.candidateId, tokenData.jobId);

      let firstQ;
      const hasCustom = Array.isArray(tokenData.customQuestions) && tokenData.customQuestions.length > 0;
      if (hasCustom) {
        customQRef.current = tokenData.customQuestions;
        firstQ = tokenData.customQuestions[0];
      } else {
        customQRef.current = null;
        const res = await apiPost('/interview/next-question', {
          jobId: tokenData.jobId, evaluationId: tokenData.evaluationId,
          questionNumber: 1, transcript: [],
        });
        firstQ = res.data || res;
      }

      const total = hasCustom ? tokenData.customQuestions.length : MAX_QUESTIONS;
      currentQRef.current = firstQ; currentQIdxRef.current = 1;
      transcriptRef.current = []; currentAnswerRef.current = '';
      phaseRef.current = 'interview'; micOnRef.current = true;
      setCurrentQ(firstQ); setCurrentQIndex(1); setCompletedPairs([]);
      setCurrentAnswer(''); setLiveText(''); setManualAnswer('');
      setMicOn(true); setPhase('interview'); setChipStatus('live');
      startTimer();
      await speak(`Welcome to your interview for ${tokenData.jobTitle}. I'll ask you ${total} questions.`);
      currentQStartRef.current = recSeconds();
      await speak(firstQ.question);
      startRecognition();
    } catch { /* allow retry */ } finally { setStarting(false); }
  }

  async function advanceQuestion(manual) {
    if (loadingQRef.current) return;
    // Capture BEFORE stopRecognition() clears liveTextRef
    const spoken = (currentAnswerRef.current + ' ' + liveTextRef.current).trim();
    const typed  = manualAnswer.trim();
    clearSilence(); stopSpeaking(); stopRecognition();
    const answer = manual ? (typed || spoken || '(no response)') : (spoken || '');

    if (!manual && !answer) { if (phaseRef.current === 'interview') startRecognition(); return; }

    // Push completed pair into display state. `t` = seconds into the recording
    // when this question was asked — rides inside the transcript jsonb so no
    // schema change is needed; playback uses it to sync the question overlay.
    const entry = { question: currentQRef.current?.question || '', answer, category: currentQRef.current?.category || 'hr', t: currentQStartRef.current };
    const newTx = [...transcriptRef.current, entry];
    transcriptRef.current = newTx;
    setCompletedPairs([...newTx]);

    loadingQRef.current = true; setLoadingQ(true);
    currentAnswerRef.current = ''; setCurrentAnswer(''); setLiveText(''); setManualAnswer('');
    setCurrentQ(null);

    const totalQ = customQRef.current ? customQRef.current.length : MAX_QUESTIONS;
    if (currentQIdxRef.current >= totalQ) {
      setLoadingQ(false);
      await finishInterview(newTx); return;
    }

    try {
      let nextQ;
      if (customQRef.current) {
        nextQ = customQRef.current[currentQIdxRef.current]; // 0-based index = next item
        if (!nextQ) { setLoadingQ(false); await finishInterview(newTx); return; }
      } else {
        const res = await apiPost('/interview/next-question', {
          jobId: tokenData.jobId, evaluationId: tokenData.evaluationId,
          questionNumber: currentQIdxRef.current + 1, transcript: newTx,
        });
        nextQ = res.data || res;
        if (!nextQ?.question || nextQ.done) { await finishInterview(newTx); return; }
      }
      currentQRef.current = nextQ; currentQIdxRef.current += 1;
      setCurrentQ(nextQ); setCurrentQIndex(i => i + 1);
      loadingQRef.current = false; setLoadingQ(false);
      currentQStartRef.current = recSeconds();
      await speak(nextQ.question);
      startRecognition();
    } catch {
      loadingQRef.current = false; setLoadingQ(false);
      startRecognition();
    }
  }

  async function finishInterview(finalTx) {
    phaseRef.current = 'ended'; loadingQRef.current = false;
    stopRecognition(); stopTimer(); setChipStatus('ended');
    stopCamera();
    await speak('Great job! Please take a moment to review your answers, then submit when you\'re ready.');
    stopSpeaking();
    setPhase('review');
  }

  async function submitInterview() {
    setSubmitting(true);
    // completedPairs carries the candidate's review-screen edits; transcriptRef
    // only has the original captured answers. Sync the ref so both agree.
    const tr = completedPairs.length ? completedPairs : transcriptRef.current;
    transcriptRef.current = tr;
    const duration = finalTimerRef.current;
    const base = { jobId: tokenData.jobId, evaluationId: tokenData.evaluationId, candidateId: tokenData.candidateId, candidateName: tokenData.candidateName, transcript: tr, durationSeconds: duration, customQuestions: tokenData.customQuestions || [] };
    // 1. Save immediately with empty scores
    try { await apiPost('/interview/save-transcript', { ...base, scores: {} }); } catch {}
    // 2. Show done screen
    setSubmitting(false);
    setPhase('done');
    // 3. Upload recording + evaluate in background
    const [recordingPath] = await Promise.all([
      stopAndUploadRecording(),
    ]);
    try {
      const evalRes = await apiPost('/interview/evaluate', base);
      const scores = evalRes.data || evalRes;
      await apiPost('/interview/save-transcript', { ...base, scores, recordingPath: recordingPath || '' });
    } catch {}
  }

  // ── Screens ────────────────────────────────────────────────────────────────

  if (phase === 'error') return (
    <div className="ci-screen"><div className="ci-card">
      <div className="ci-err-icon">🔗</div>
      <div className="ci-err-h">Invalid or expired interview link.</div>
      <div className="ci-err-b">Please ask your HR contact to send you a new link.</div>
    </div></div>
  );

  if (phase === 'intro') return (
    <div className="ci-screen"><div className="ci-card">
      <div className="ci-eyebrow">{COMPANY_NAME}</div>
      <div className="ci-h1">AI Interview</div>
      <div className="ci-sub">
        {tokenData?.jobTitle && <>Role: <strong>{tokenData.jobTitle}</strong><br /></>}
        {tokenData?.candidateName && <>Hello, <strong>{tokenData.candidateName}</strong> — ready when you are.</>}
      </div>
      <ul className="ci-list">
        <li>The AI will ask you {tokenData?.customQuestions?.length || MAX_QUESTIONS} questions aloud</li>
        <li>Speak clearly — the interview advances automatically after a pause</li>
        <li>Click "Next Question" anytime to move on manually</li>
        <li>All questions and your answers stay visible on screen as you go</li>
        <li><strong>This interview is recorded</strong> (video and audio) and may be reviewed by the hiring team</li>
      </ul>
      {/* Device check — confirm speaker, camera and mic before starting */}
      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 18px', marginBottom: 22 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Check your devices</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: devicesReady || deviceError ? 14 : 0 }}>
          <button type="button" onClick={testSpeaker} disabled={speakerState === 'playing'}
            style={{ flex: 1, minWidth: 150, padding: '10px 14px', borderRadius: 8, border: '1px solid #bfdbfe', background: '#fff', color: '#2563eb', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            {speakerState === 'playing' ? '🔊 Playing…' : '🔊 Test speaker'}
          </button>
          <button type="button" onClick={testDevices}
            style={{ flex: 1, minWidth: 150, padding: '10px 14px', borderRadius: 8, border: '1px solid #bfdbfe', background: '#fff', color: '#2563eb', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            {devicesReady ? '🎥 Camera & mic ✓' : '🎥 Test camera & mic'}
          </button>
        </div>
        {speakerState === 'playing' && (
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>You should hear a short message. No sound? Check your volume/output device, then retry.</div>
        )}
        {deviceError && <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 8 }}>{deviceError}</div>}
        {devicesReady && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <video ref={testVideoRef} autoPlay playsInline muted style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 8, background: '#111827', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#374151', marginBottom: 6 }}>Speak — your mic level should move:</div>
              <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${micLevel}%`, background: micLevel > 8 ? '#16a34a' : '#9ca3af', transition: 'width 0.1s' }} />
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>Camera preview on the left. If both work, you're set.</div>
            </div>
          </div>
        )}
      </div>

      <button className="ci-go" onClick={startInterview} disabled={starting || !tokenData}>
        {starting ? 'Starting…' : 'Start Interview'}
      </button>
      <div className="ci-note">By starting, you consent to being recorded. Allow microphone and camera access when prompted.</div>
    </div></div>
  );

  if (phase === 'review') return (
    <div className="ci-page">
      {/* Same topbar */}
      <div className="ci-top">
        <div className="ci-brand">{COMPANY_NAME}</div>
        <div className="ci-top-right">
          <div className="ci-chip ended"><span className="ci-chip-dot" />Interview done</div>
        </div>
      </div>

      {/* Scrollable review body */}
      <div style={{ flex: '1 1 0', overflowY: 'auto', padding: '32px 40px', display: 'flex', flexDirection: 'column', gap: 0 }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
            Review before submitting
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#111827', marginBottom: 6 }}>Your Interview Answers</h2>
          <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6 }}>
            Check that your answers are accurate. Once you submit, they'll be sent directly to the hiring team.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {completedPairs.map((pair, i) => {
            const bg    = CAT_BG[pair.category]    || '#eff6ff';
            const color = CAT_COLOR[pair.category] || '#2563eb';
            const label = CAT_LABEL[pair.category] || '';
            return (
              <div key={i} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
                {/* Question row */}
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #f3f4f6', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Q{i + 1}</span>
                    {label && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, border: `1px solid ${color}40`, background: bg, color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>}
                  </div>
                  <p style={{ fontSize: 15, fontWeight: 600, color: '#111827', margin: 0, lineHeight: 1.65 }}>{pair.question}</p>
                </div>
                {/* Answer row */}
                <div style={{ padding: '14px 20px', background: '#fafafa' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Your answer</div>
                    <div style={{ fontSize: 10, color: '#9ca3af' }}>Tap to edit before submitting</div>
                  </div>
                  <textarea
                    value={pair.answer}
                    onChange={e => {
                      const updated = completedPairs.map((p, idx) => idx === i ? { ...p, answer: e.target.value } : p);
                      setCompletedPairs(updated);
                    }}
                    rows={3}
                    style={{ width: '100%', fontSize: 14, color: '#1e40af', lineHeight: 1.7, margin: 0, padding: '8px 10px', border: '1px solid #bfdbfe', borderRadius: 6, fontFamily: 'inherit', resize: 'vertical', outline: 'none', background: '#eff6ff' }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom spacer so last card isn't hidden behind the bar */}
        <div style={{ height: 80 }} />
      </div>

      {/* Fixed bottom submit bar */}
      <div style={{ flex: '0 0 68px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 40px', background: '#fff', borderTop: '1px solid #e5e7eb' }}>
        <span style={{ fontSize: 13, color: '#9ca3af' }}>
          {completedPairs.length} question{completedPairs.length !== 1 ? 's' : ''} · {tokenData?.candidateName}
        </span>
        <button
          className="ci-next-btn"
          style={{ padding: '10px 32px', fontSize: 14, borderRadius: 8 }}
          onClick={submitInterview}
          disabled={submitting}
        >
          {submitting ? 'Submitting…' : 'Submit Interview →'}
        </button>
      </div>
    </div>
  );

  if (phase === 'done') return (
    <div className="ci-screen"><div className="ci-card">
      <div className="ci-check">
        <svg width="72" height="72" viewBox="0 0 72 72" fill="none">
          <circle cx="36" cy="36" r="34" strokeWidth="2" />
          <path d="M22 36l10 10 18-20" />
        </svg>
      </div>
      <div className="ci-done-h">Interview Submitted</div>
      <div className="ci-done-b">
        Thank you, <strong>{tokenData?.candidateName}</strong>.<br />Your responses have been recorded and sent to the team.
      </div>
      <div className="ci-done-note">The HR team will review your interview and be in touch soon.</div>
    </div></div>
  );

  // ── Interview room ─────────────────────────────────────────────────────────

  const isLoading = loadingQ && !currentQ;
  const totalQuestions = tokenData?.customQuestions?.length || MAX_QUESTIONS;
  const statusLabel = isLoading ? 'Preparing next question…' : isSpeaking ? 'AI speaking' : 'Listening';
  const statusClass = isLoading ? 'loading' : isSpeaking ? 'speaking' : 'waiting';

  return (
    <div className="ci-page">

      {/* Top bar */}
      <div className="ci-top">
        <div className="ci-brand">{COMPANY_NAME}</div>
        <div className="ci-top-right">
          <div className={`ci-chip ${chipStatus}`}>
            <span className="ci-chip-dot" />
            {chipStatus === 'live' ? 'Live' : chipStatus === 'ended' ? 'Ended' : 'Idle'}
          </div>
          <span className="ci-top-timer">{formatTime(timer)}</span>
        </div>
      </div>

      {/* 50/50 body */}
      <div className="ci-body">

        {/* LEFT — scrollable Q&A transcript */}
        <div className="ci-feed-col">
          <div className="ci-feed-hdr">
            <span className="ci-feed-title">Interview</span>
            <div className={`ci-feed-status ${statusClass}`}>
              {!isLoading && <span className="ci-feed-status-dot" />}
              {statusLabel}
            </div>
          </div>

          <div className="ci-feed" ref={feedRef}>
            {/* Completed Q&A pairs */}
            {completedPairs.map((pair, i) => {
              const bg    = CAT_BG[pair.category]    || '#eff6ff';
              const color = CAT_COLOR[pair.category] || '#2563eb';
              const label = CAT_LABEL[pair.category] || '';
              return (
                <div className="ci-pair" key={i}>
                  <div className="ci-q-bubble">
                    <div className="ci-q-bubble-meta">
                      <span className="ci-q-badge">Q{i + 1}</span>
                      {label && <span className="ci-cat-pill" style={{ background: bg, color, borderColor: color + '40' }}>{label}</span>}
                    </div>
                    <p className="ci-q-bubble-text">{pair.question}</p>
                  </div>
                  <div className="ci-a-bubble">
                    <div className="ci-a-bubble-label">Your answer</div>
                    <p className="ci-a-bubble-text">{pair.answer}</p>
                  </div>
                </div>
              );
            })}

            {/* Active question or loading */}
            {isLoading ? (
              <div className="ci-active-q">
                <div className="ci-active-q-meta">
                  <span className="ci-active-q-badge">Q{currentQIndex + 1}</span>
                </div>
                <p className="ci-active-q-text">
                  <span className="ci-loading-dots"><span /><span /><span /></span>
                </p>
              </div>
            ) : currentQ ? (
              <div className="ci-active-q">
                <div className="ci-active-q-meta">
                  <span className="ci-active-q-badge">Q{currentQIndex} of {totalQuestions}</span>
                  {CAT_LABEL[currentQ.category] && (
                    <span className="ci-cat-pill" style={{
                      background: CAT_BG[currentQ.category],
                      color: CAT_COLOR[currentQ.category],
                      borderColor: CAT_COLOR[currentQ.category] + '40',
                    }}>{CAT_LABEL[currentQ.category]}</span>
                  )}
                </div>
                <p className="ci-active-q-text">{currentQ.question}</p>
                <div className="ci-wave-row">
                  <div className={`ci-wave-bars ${isSpeaking ? 'speaking' : ''}`}>
                    <span /><span /><span /><span /><span />
                  </div>
                  <span className="ci-wave-status">
                    {isSpeaking ? 'AI speaking…' : 'Listening for your answer…'}
                  </span>
                  {/* Manual replay — a direct click always allows TTS even if the
                      browser blocked the automatic speech. */}
                  <button
                    type="button"
                    onClick={() => speak(currentQ.question)}
                    title="Replay the question aloud"
                    style={{ marginLeft: 'auto', border: '1px solid #bfdbfe', background: '#fff', color: '#2563eb', borderRadius: 6, padding: '4px 11px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                  >
                    🔊 Replay question
                  </button>
                </div>

                {/* Answer panel — directly under question */}
                <div className="ci-answer-inline">
                  <div className="ci-ans-label">
                    {!isSpeaking && <span className="ci-ans-dot" />}
                    Your answer
                  </div>
                  {hasSpeechAPI && !sttFailed ? (
                    <div className="ci-ans-text">
                      {currentAnswer || liveText
                        ? <>{currentAnswer}{liveText && <span className="ci-ans-placeholder"> {liveText}</span>}</>
                        : <span className="ci-ans-placeholder">Start speaking…</span>
                      }
                    </div>
                  ) : (
                    <>
                      {sttFailed && (
                        <div style={{ fontSize: 11, color: '#b45309', marginBottom: 6 }}>
                          Voice capture isn't available on this device/network — please type your answer instead.
                        </div>
                      )}
                      <input
                        className="ci-manual-in"
                        type="text"
                        placeholder="Type your answer and press Enter…"
                        value={manualAnswer}
                        onChange={e => setManualAnswer(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); advanceQuestion(true); } }}
                      />
                    </>
                  )}
                </div>

                {/* Next button — under answer */}
                <div className="ci-next-row">
                  <button className="ci-next-btn" onClick={() => advanceQuestion(true)} disabled={loadingQ}>
                    {loadingQ ? 'Loading…' : currentQIndex >= totalQuestions ? 'Finish Interview' : 'Next Question →'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* RIGHT — video + answer */}
        <div className="ci-right-col">
          <div className="ci-video-wrap">
            <div className="ci-vid-label">{tokenData?.candidateName || 'You'}</div>
            <div className={`ci-vid-mic ${micOn ? 'on' : 'off'}`}>
              {micOn
                ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
              }
            </div>
            <video ref={videoRef} autoPlay playsInline muted className="ci-video" />
            {!camOn && (
              <div className="ci-no-cam">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                </svg>
                <span>Camera off</span>
              </div>
            )}
            {(currentAnswer || liveText) && (
              <div className="ci-live-tx">
                {currentAnswer && <span className="ci-tx-final">{currentAnswer}</span>}
                {liveText && <span className="ci-tx-interim">{liveText}</span>}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Bottom bar */}
      <div className="ci-bar">
        <div className="ci-bar-l">
          <span className="ci-bar-timer">{formatTime(timer)}</span>
          <span className="ci-bar-qnum">Q {currentQIndex} / {totalQuestions}</span>
        </div>
        <div className="ci-bar-c">
          <button className={`ci-ibtn ${micOn ? 'mic-on' : 'mic-off'}`} onClick={toggleMic} title={micOn ? 'Mute' : 'Unmute'}>
            {micOn
              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
            }
          </button>
          <button className={`ci-ibtn ${camOn ? 'cam-on' : 'cam-off'}`} onClick={toggleCamera} title={camOn ? 'Camera off' : 'Camera on'}>
            {camOn
              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.66 6H14a2 2 0 0 1 2 2v2.34l1 1L22 8v8"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2l10 10Z"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
