import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Mobile browsers (iOS Safari / Android Chrome) refuse to render a PDF inside an
// <iframe> — they show an "Open" placeholder instead. So for a real on-phone
// preview we rasterise the first few pages to <canvas> with pdf.js (the same lib
// already bundled for CV text extraction). Works identically on every device.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();

export default function PdfPreview({ url, maxPages = 8 }) {
  const containerRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | done | error
  const [info, setInfo] = useState({ shown: 0, total: 0 });

  useEffect(() => {
    let cancelled = false;
    async function render() {
      setStatus('loading');
      try {
        const ab = await (await fetch(url)).arrayBuffer();
        if (cancelled) return;
        const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
        if (cancelled) return;
        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = '';
        const n = Math.min(pdf.numPages, maxPages);
        const width = container.clientWidth || 320;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let i = 1; i <= n; i++) {
          const page = await pdf.getPage(i);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * dpr });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.cssText = 'width:100%;height:auto;display:block;margin:0 auto 8px;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,0.12);background:#fff';
          container.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        }
        if (!cancelled) { setInfo({ shown: n, total: pdf.numPages }); setStatus('done'); }
      } catch {
        if (!cancelled) setStatus('error');
      }
    }
    if (url) render();
    return () => { cancelled = true; };
  }, [url, maxPages]);

  return (
    <div style={{ background: 'var(--gray-100)', maxHeight: 540, overflowY: 'auto' }}>
      <div ref={containerRef} style={{ padding: 8 }} />
      {status === 'loading' && <div style={{ padding: 20, textAlign: 'center', color: 'var(--gray-400)', fontSize: 13 }}>Rendering preview…</div>}
      {status === 'error' && <div style={{ padding: 20, textAlign: 'center', color: 'var(--gray-400)', fontSize: 13 }}>Couldn't render a preview — use Open or Download.</div>}
      {status === 'done' && info.total > info.shown && (
        <div style={{ padding: '8px', textAlign: 'center', color: 'var(--gray-500)', fontSize: 12 }}>
          Showing first {info.shown} of {info.total} pages — open in a new tab for the full CV.
        </div>
      )}
    </div>
  );
}
