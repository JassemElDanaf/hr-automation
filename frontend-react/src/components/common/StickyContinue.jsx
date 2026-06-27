import { useEffect, useState } from 'react';

// Floating "Continue" button pinned to the lower-right of the viewport so the
// user can advance to the next step from anywhere on a long page without
// scrolling to the bottom. Shown only when `show` is true.
//
// If `anchorRef` is given (a ref to the real inline Continue button at the bottom
// of the page), the floating button HIDES itself once that inline button scrolls
// into view — so you don't see two Continue buttons at once when you reach the end.
export default function StickyContinue({ show, label, onClick, disabled = false, anchorRef }) {
  const [anchorVisible, setAnchorVisible] = useState(false);

  useEffect(() => {
    const el = anchorRef?.current;
    if (!el) { setAnchorVisible(false); return; }
    const obs = new IntersectionObserver(
      ([entry]) => setAnchorVisible(entry.isIntersecting),
      { threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [anchorRef, show]);

  if (!show || anchorVisible) return null;
  return (
    <button
      type="button"
      className="sticky-continue"
      onClick={onClick}
      disabled={disabled}
    >
      {label} <span aria-hidden style={{ marginLeft: 2 }}>→</span>
    </button>
  );
}
