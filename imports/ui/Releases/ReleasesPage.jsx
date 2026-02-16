import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { useSubscribe, useFind } from 'meteor/react-meteor-data';
import { ReleasesCollection } from '/imports/api/releases/collections';
import { marked } from 'marked';
import './ReleasesPage.css';

const renderMarkdown = (text) => {
  if (!text) return '';
  return marked.parse(text, { breaks: true });
};

export const ReleasesPage = ({ releaseId }) => {
  const isLoading = useSubscribe('releases.all');
  const releases = useFind(() => ReleasesCollection.find({}, { sort: { createdAt: -1 } }));
  const highlightRef = useRef(null);

  useEffect(() => {
    if (releaseId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [releaseId, releases.length]);

  if (isLoading()) {
    return <div className="releasesPage"><p className="muted">Loading...</p></div>;
  }

  return (
    <div className="releasesPage">
      <h2>Releases</h2>
      {releases.length === 0 ? (
        <p className="muted">No releases yet.</p>
      ) : (
        <div className="releasesPage-list">
          {releases.map((r) => (
            <article
              key={r._id}
              ref={r._id === releaseId ? highlightRef : undefined}
              className={`releasesPage-card${r._id === releaseId ? ' highlight' : ''}`}
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
      )}
    </div>
  );
};

ReleasesPage.propTypes = {
  releaseId: PropTypes.string,
};
