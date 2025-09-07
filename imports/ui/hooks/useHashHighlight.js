import { useEffect, useState } from 'react';

// useHashHighlight(paramKey: string, clearToHash: string)
// - Extracts an id from the hash when it starts with `#/${paramKey}/:id`
// - Returns the id once, then normalizes the hash to `clearToHash`
export const useHashHighlight = (paramKey, clearToHash) => {
  const [id, setId] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash || '';
    const path = hash.replace(/^#/, '');
    const parts = path.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[0] === String(paramKey)) {
      const found = parts[1] || null;
      if (found) {
        setId(found);
        if (clearToHash) window.history.replaceState(null, '', clearToHash);
      }
    }
  }, [paramKey, clearToHash]);

  return id;
};


