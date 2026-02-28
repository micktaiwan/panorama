import React, { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import './NoteToc.css';

function extractHeadings(view) {
  if (!view) return [];
  const headings = [];
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      headings.push({
        level: node.attrs.level,
        text: node.textContent,
        pos,
      });
    }
  });
  return headings;
}

export function NoteToc({ editorRef, docVersion, noteId }) {
  const [headings, setHeadings] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const observerRef = useRef(null);

  // Extract headings when doc or note changes
  useEffect(() => {
    // When noteId changes, the ProseMirror editor remounts — defer to let the new view initialize
    const timer = requestAnimationFrame(() => {
      const view = editorRef.current?.view;
      setHeadings(extractHeadings(view));
    });
    return () => cancelAnimationFrame(timer);
  }, [editorRef, docVersion, noteId]);

  // Scroll spy via IntersectionObserver
  useEffect(() => {
    const view = editorRef.current?.view;
    if (!view || headings.length === 0) return;

    const editorDom = view.dom;
    const headingEls = editorDom.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (headingEls.length === 0) return;

    // Find the scrollable ancestor
    const scrollParent = editorDom.closest('.ProseMirror-scroll') || editorDom.closest('.note-editor') || editorDom.parentElement;

    observerRef.current?.disconnect();

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the topmost visible heading
        const visible = entries.filter(e => e.isIntersecting);
        if (visible.length > 0) {
          // Pick the one closest to the top
          let best = visible[0];
          for (const entry of visible) {
            if (entry.boundingClientRect.top < best.boundingClientRect.top) {
              best = entry;
            }
          }
          const idx = Array.from(headingEls).indexOf(best.target);
          if (idx !== -1) setActiveIndex(idx);
        }
      },
      { root: scrollParent, rootMargin: '0px 0px -70% 0px', threshold: 0 }
    );

    headingEls.forEach(el => observer.observe(el));
    observerRef.current = observer;

    return () => observer.disconnect();
  }, [editorRef, headings]);

  const handleClick = useCallback((index) => {
    const view = editorRef.current?.view;
    if (!view) return;
    const headingEls = view.dom.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headingEls[index]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [editorRef]);

  if (headings.length === 0) return null;

  return (
    <div className="note-toc">
      <div className="note-toc-title">Contents</div>
      {headings.map((h, i) => (
        <button
          key={`${h.pos}-${i}`}
          className={`note-toc-item note-toc-level-${h.level}${i === activeIndex ? ' active' : ''}`}
          onClick={() => handleClick(i)}
          title={h.text}
        >
          {h.text}
        </button>
      ))}
    </div>
  );
}

NoteToc.propTypes = {
  editorRef: PropTypes.object.isRequired,
  docVersion: PropTypes.number,
  noteId: PropTypes.string,
};
