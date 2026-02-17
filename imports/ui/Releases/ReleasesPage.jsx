import React, { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { ReleasesCollection } from '/imports/api/releases/collections';
import { marked } from 'marked';
import { timeAgo } from '/imports/ui/utils/date';
import './ReleasesPage.css';

const renderMarkdown = (text) => {
  if (!text) return '';
  return marked.parse(text, { breaks: true });
};

export const ReleasesPage = ({ releaseId }) => {
  const isLoading = useSubscribe('releases.all');
  const releases = useFind(() => ReleasesCollection.find({}, { sort: { createdAt: -1 } }));
  const cardRefs = useRef({});
  const contentRef = useRef(null);
  const [activeId, setActiveId] = useState(releaseId || null);
  const scrollingRef = useRef(false);

  const programmaticScroll = useCallback((el, id, block = 'start') => {
    scrollingRef.current = true;
    setActiveId(id);
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block });
      // Re-enable observer after scroll settles
      setTimeout(() => { scrollingRef.current = false; }, 600);
    });
  }, []);

  const loading = isLoading();

  useEffect(() => {
    if (!loading && releaseId && cardRefs.current[releaseId]) {
      programmaticScroll(cardRefs.current[releaseId], releaseId, 'center');
    }
  }, [releaseId, loading, releases.length, programmaticScroll]);

  // Track which card is visible while scrolling
  useEffect(() => {
    const container = contentRef.current;
    if (!container || releases.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (scrollingRef.current) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.dataset.id);
            break;
          }
        }
      },
      { root: container, threshold: 0.3 }
    );
    Object.values(cardRefs.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [releases.length]);

  const scrollToRelease = useCallback((id) => {
    const el = cardRefs.current[id];
    if (el) programmaticScroll(el, id);
  }, [programmaticScroll]);

  if (loading) {
    return <div className="releasesPage"><p className="muted">Loading...</p></div>;
  }

  return (
    <div className="releasesPage">
      <h2>Releases</h2>
      {releases.length === 0 ? (
        <p className="muted">No releases yet.</p>
      ) : (
        <div className="releasesPage-layout">
          <nav className="releasesPage-sidebar">
            {releases.map((r) => (
              <button
                key={r._id}
                className={`releasesPage-sidebarItem${activeId === r._id ? ' active' : ''}`}
                onClick={() => scrollToRelease(r._id)}
              >
                <span className="releasesPage-sidebarTop">
                  <span className="releasesPage-sidebarVersion">v{r.version}</span>
                  <span className="releasesPage-sidebarAgo">{timeAgo(r.createdAt)}</span>
                </span>
                <span className="releasesPage-sidebarTitle">{r.title}</span>
              </button>
            ))}
          </nav>
          <div className="releasesPage-content-area scrollArea" ref={contentRef}>
            <div className="releasesPage-list">
              {releases.map((r) => (
                <article
                  key={r._id}
                  data-id={r._id}
                  ref={(el) => { cardRefs.current[r._id] = el; }}
                  className={`releasesPage-card${activeId === r._id ? ' highlight' : ''}`}
                >
                  <div className="releasesPage-cardHeader">
                    <span className="releasesPage-version">v{r.version}</span>
                    <h3 className="releasesPage-title">{r.title}</h3>
                    <span className="releasesPage-date">
                      {r.createdAt?.toLocaleString(undefined, {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div
                    className="releasesPage-content"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(r.content) }}
                  />
                </article>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

ReleasesPage.propTypes = {
  releaseId: PropTypes.string,
};
