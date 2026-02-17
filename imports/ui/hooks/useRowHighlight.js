import { useEffect } from 'react';

// useRowHighlight: scrolls the row into view and triggers a temporary CSS highlight.
// If onClear is provided, it will be called after 3 seconds (one-shot highlight semantics).
export const useRowHighlight = (id, rowSelector, onClear) => {
  useEffect(() => {
    if (!id) return;
    const sel = `${rowSelector}[data-person-id="${id}"]`;
    const el = typeof document !== 'undefined' ? document.querySelector(sel) : null;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Add a transient class to ensure highlight animation even if parent state-based class changes
      el.classList.add('highlight');
      const t = setTimeout(() => {
        el.classList.remove('highlight');
        if (typeof onClear === 'function') onClear();
      }, 3000);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, rowSelector]);
};


