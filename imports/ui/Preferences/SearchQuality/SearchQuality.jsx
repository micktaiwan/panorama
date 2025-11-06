import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { Meteor } from 'meteor/meteor';
import { notify } from '/imports/ui/utils/notify';
import './SearchQuality.css';

export const SearchQuality = () => {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [autoFixing, setAutoFixing] = useState(false);
  const [autoFixReport, setAutoFixReport] = useState(null);
  const [limit, setLimit] = useState(10);
  const [showDetails, setShowDetails] = useState(true);

  const runTest = () => {
    setLoading(true);
    setResults(null);
    setAutoFixReport(null);

    Meteor.call('qdrant.qualityTest', { limit, verbose: false }, (err, res) => {
      setLoading(false);
      if (err) {
        notify({ message: err.reason || err.message || 'Quality test failed', kind: 'error' });
        console.error('[SearchQuality] Error:', err);
      } else {
        setResults(res);
        if (res.error) {
          notify({ message: res.error, kind: 'error' });
        } else {
          notify({ message: 'Quality test completed!', kind: 'success' });
        }
      }
    });
  };

  const runAutoFix = (dryRun = false) => {
    setAutoFixing(true);
    setAutoFixReport(null);

    Meteor.call('qdrant.autoFix', { dryRun, sampleSize: 100 }, (err, report) => {
      setAutoFixing(false);
      if (err) {
        notify({ message: err.reason || err.message || 'Auto-fix failed', kind: 'error' });
        console.error('[SearchQuality] Auto-fix error:', err);
      } else {
        setAutoFixReport(report);
        if (dryRun) {
          notify({ message: `Found ${report.summary.totalMissing} missing documents`, kind: 'info' });
        } else {
          notify({ message: report.summary.recommendation, kind: 'success' });
          // Auto-rerun test after fixing
          if (report.summary.totalMissing > 0) {
            setTimeout(() => {
              notify({ message: 'Re-running quality test...', kind: 'info' });
              runTest();
            }, 1000);
          }
        }
      }
    });
  };

  const exportDebugReport = () => {
    if (!results) return;

    const report = {
      timestamp: new Date().toISOString(),
      config: results.config,
      summary: results.summary,
      failurePatterns: results.failurePatterns,
      recommendations: results.recommendations,
      recommendationsSummary: results.recommendationsSummary,
      tests: results.tests,
      failures: results.failures,
      totalFailures: results.totalFailures
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `search-quality-report-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    notify({ message: 'Debug report exported!', kind: 'success' });
  };

  const formatPercent = (val) => {
    return (val * 100).toFixed(1) + '%';
  };

  const getSuccessColor = (rate) => {
    if (rate >= 0.8) return 'success';
    if (rate >= 0.6) return 'warning';
    return 'error';
  };

  return (
    <div className="searchQuality">
      <h2>Search Quality Test</h2>
      <p className="description">
        This test automatically generates search queries from your existing documents
        and verifies that the semantic search can find them.
      </p>

      <div className="controls">
        <div className="formRow">
          <label htmlFor="search_limit">Search Limit (results per query)</label>
          <input
            id="search_limit"
            type="number"
            min="5"
            max="50"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            disabled={loading}
            className="afInput"
            style={{ width: '80px' }}
          />
          <span className="hint">
            How many results to check per query (default: 10, used by MCP: 8)
          </span>
        </div>

        <button
          onClick={runTest}
          disabled={loading}
          className="btn btn-primary"
        >
          {loading ? 'Running Test...' : 'Run Quality Test'}
        </button>

        {results && !results.error && (
          <button
            onClick={exportDebugReport}
            className="btn ml8"
          >
            Export Debug Report (JSON)
          </button>
        )}
      </div>

      {loading && (
        <div className="loading">
          <div className="spinner" />
          <p>Generating queries and testing search results...</p>
        </div>
      )}

      {results && !results.error && (
        <div className="results">
          <div className="summary">
            <h3>Summary</h3>
            <div className="metrics">
              <div className={`metric ${getSuccessColor(results.summary.successRate_top3)}`}>
                <div className="metric-label">Success Rate (Top-3)</div>
                <div className="metric-value">{formatPercent(results.summary.successRate_top3)}</div>
                <div className="metric-hint">Expected document found in first 3 results</div>
              </div>
              <div className={`metric ${getSuccessColor(results.summary.successRate_top5)}`}>
                <div className="metric-label">Success Rate (Top-5)</div>
                <div className="metric-value">{formatPercent(results.summary.successRate_top5)}</div>
                <div className="metric-hint">Expected document found in first 5 results</div>
              </div>
              <div className={`metric ${getSuccessColor(results.summary.successRate_top10)}`}>
                <div className="metric-label">Success Rate (Top-{limit})</div>
                <div className="metric-value">{formatPercent(results.summary.successRate_top10)}</div>
                <div className="metric-hint">Expected document found in top {limit} results</div>
              </div>
              <div className={`metric ${getSuccessColor(results.summary.hitRate)}`}>
                <div className="metric-label">Hit Rate</div>
                <div className="metric-value">{formatPercent(results.summary.hitRate)}</div>
                <div className="metric-hint">Document found anywhere in results</div>
              </div>
              <div className="metric neutral">
                <div className="metric-label">Mean Reciprocal Rank (MRR)</div>
                <div className="metric-value">{results.summary.mrr.toFixed(3)}</div>
                <div className="metric-hint">Average position quality (higher is better)</div>
              </div>
              <div className="metric neutral">
                <div className="metric-label">Average Rank</div>
                <div className="metric-value">{results.summary.avgRank.toFixed(2)}</div>
                <div className="metric-hint">When found, average position</div>
              </div>
              <div className="metric neutral">
                <div className="metric-label">Average Score</div>
                <div className="metric-value">{results.summary.avgScore.toFixed(3)}</div>
                <div className="metric-hint">Qdrant similarity score (0-1)</div>
              </div>
            </div>

            <div className="test-info">
              <p><strong>{results.summary.totalTests}</strong> documents tested</p>
              <p><strong>{results.summary.totalQueries}</strong> search queries executed</p>
              <p><strong>{results.failures.length}</strong> documents with some failed queries</p>
              <p><strong>{results.totalFailures.length}</strong> documents not found at all</p>
            </div>

            {(results.summary.successRate_top10 < 0.5 || results.totalFailures.length > 5) && (
              <div className="auto-fix-section">
                <h4>🔧 Automatic Fix</h4>
                <p className="warning-message">
                  Critical search quality issues detected. This usually means documents are not indexed in Qdrant.
                </p>
                <div className="auto-fix-actions">
                  <button
                    onClick={() => runAutoFix(false)}
                    disabled={autoFixing}
                    className="btn btn-primary"
                  >
                    {autoFixing ? 'Fixing...' : 'Auto-Fix Missing Documents'}
                  </button>
                  <span className="hint">
                    This will check which documents are missing from Qdrant and reindex them automatically.
                  </span>
                </div>
              </div>
            )}
          </div>

          {autoFixReport && (
            <div className="auto-fix-report">
              <h3>Auto-Fix Report</h3>
              <div className="metrics">
                <div className="metric neutral">
                  <div className="metric-label">Documents Checked</div>
                  <div className="metric-value">{autoFixReport.summary.totalChecked}</div>
                </div>
                <div className={`metric ${autoFixReport.summary.totalMissing > 0 ? 'error' : 'success'}`}>
                  <div className="metric-label">Missing Documents</div>
                  <div className="metric-value">{autoFixReport.summary.totalMissing}</div>
                  <div className="metric-hint">{autoFixReport.summary.percentageMissing}% of checked</div>
                </div>
                {!autoFixReport.dryRun && autoFixReport.fixed && (
                  <div className="metric success">
                    <div className="metric-label">Documents Fixed</div>
                    <div className="metric-value">
                      {Object.values(autoFixReport.fixed).reduce((s, c) => s + c, 0)}
                    </div>
                  </div>
                )}
              </div>
              <div className="fix-details">
                {Object.entries(autoFixReport.checked).map(([kind, count]) => (
                  <div key={kind} className="fix-kind">
                    <strong>{kind}:</strong> {count} checked
                    {autoFixReport.missing[kind] > 0 && (
                      <span className="missing-count"> → {autoFixReport.missing[kind]} missing</span>
                    )}
                    {!autoFixReport.dryRun && autoFixReport.fixed[kind] > 0 && (
                      <span className="fixed-count"> → {autoFixReport.fixed[kind]} fixed</span>
                    )}
                  </div>
                ))}
              </div>
              {autoFixReport.errors && autoFixReport.errors.length > 0 && (
                <div className="fix-errors">
                  <h4>Errors ({autoFixReport.errors.length})</h4>
                  {autoFixReport.errors.map((err, idx) => (
                    <div key={idx} className="error-item">
                      {err.message || JSON.stringify(err)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {results.recommendations && results.recommendations.length > 0 && (
            <div className="auto-recommendations">
              <h3>
                🤖 Automatic Analysis
                {results.recommendationsSummary && results.recommendationsSummary.totalIssues > 0 && (
                  <span className="issues-badge">
                    {results.recommendationsSummary.critical > 0 && <span className="critical">{results.recommendationsSummary.critical} critical</span>}
                    {results.recommendationsSummary.high > 0 && <span className="high">{results.recommendationsSummary.high} high</span>}
                    {results.recommendationsSummary.medium > 0 && <span className="medium">{results.recommendationsSummary.medium} medium</span>}
                  </span>
                )}
              </h3>

              {results.recommendations.map((rec, idx) => (
                <div key={idx} className={`recommendation-card priority-${rec.priority}`}>
                  <div className="recommendation-header">
                    <span className={`priority-badge priority-${rec.priority}`}>
                      {rec.priority.toUpperCase()}
                    </span>
                    <span className="recommendation-type">{rec.type.replace(/_/g, ' ')}</span>
                  </div>

                  <p className="recommendation-reason">{rec.reason}</p>

                  {rec.code && (
                    <div className="code-suggestion">
                      <div className="code-file">{rec.code.file}:{rec.code.line}</div>
                      {rec.code.current && (
                        <pre className="code-current">Current:\n{rec.code.current}</pre>
                      )}
                      {rec.code.suggested && (
                        <pre className="code-suggested">Suggested:\n{rec.code.suggested}</pre>
                      )}
                      {rec.expectedImpact && (
                        <div className="code-impact">Expected: {rec.expectedImpact}</div>
                      )}
                    </div>
                  )}

                  {rec.suggestions && rec.suggestions.length > 0 && (
                    <div className="suggestions-list">
                      <strong>Suggestions:</strong>
                      <ul>
                        {rec.suggestions.map((sug, sidx) => (
                          <li key={sidx}>
                            <strong>{sug.action}</strong>
                            {sug.hint && <div className="suggestion-hint">{sug.hint}</div>}
                            {sug.code && (
                              <div className="suggestion-code">
                                {sug.code.file && <span className="code-ref">{sug.code.file}</span>}
                                {sug.code.meteor && <pre className="meteor-call">{sug.code.meteor}</pre>}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {rec.action && (
                    <div className="action-box">
                      <strong>Action:</strong>
                      {rec.action.meteor && <pre className="meteor-call">{rec.action.meteor}</pre>}
                      {rec.action.ui && <div className="ui-action">UI: {rec.action.ui}</div>}
                    </div>
                  )}

                  {rec.urgentActions && rec.urgentActions.length > 0 && (
                    <div className="urgent-actions">
                      <strong>🚨 Urgent Actions:</strong>
                      <ol>
                        {rec.urgentActions.map((action, aidx) => (
                          <li key={aidx}>{action}</li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {rec.affectedDocs && rec.affectedDocs.length > 0 && rec.affectedDocs.length <= 5 && (
                    <details className="affected-docs">
                      <summary>Affected documents ({rec.affectedDocs.length})</summary>
                      <ul>
                        {rec.affectedDocs.map((doc, didx) => (
                          <li key={didx}>{typeof doc === 'string' ? doc : `${doc.id}: ${doc.title}`}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {rec.affectedDocs && rec.affectedDocs.length > 5 && (
                    <div className="affected-docs-count">
                      Affects {rec.affectedDocs.length} documents
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {results.failures.length > 0 && (
            <div className="failures">
              <h3>
                Failed Queries ({results.failures.length})
                <button
                  className="btn-link"
                  onClick={() => setShowDetails(!showDetails)}
                >
                  {showDetails ? 'Hide Details' : 'Show Details'}
                </button>
              </h3>

              {showDetails && results.failures.map((failure, idx) => (
                <div key={idx} className="failure">
                  <div className="failure-header">
                    <span className="failure-kind">{failure.sourceDoc.kind}</span>
                    <span className="failure-title">{failure.sourceDoc.title}</span>
                    {failure.successRate > 0 && (
                      <span className="failure-partial">
                        (Partial: {formatPercent(failure.successRate)} success)
                      </span>
                    )}
                  </div>

                  <div className="failure-queries">
                    {failure.failedQueries.map((q, qIdx) => (
                      <div key={qIdx} className="failed-query">
                        <div className="query-text">"{q.query}"</div>
                        <div className="query-meta">
                          <span className="query-type">{q.type}</span>
                          <span className="query-desc">{q.description}</span>
                          {q.error && <span className="query-error">Error: {q.error}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {results.totalFailures.length > 0 && (
            <div className="total-failures">
              <h3>Total Failures ({results.totalFailures.length})</h3>
              <p className="warning-message">
                These documents were not found by ANY of their generated queries.
                This indicates a serious issue with indexing or embedding quality.
              </p>

              {results.totalFailures.map((failure, idx) => (
                <div key={idx} className="total-failure">
                  <div className="failure-header">
                    <span className="failure-kind">{failure.sourceDoc.kind}</span>
                    <span className="failure-title">{failure.sourceDoc.title}</span>
                  </div>
                  <div className="failure-queries">
                    <p>Tried {failure.queries.length} queries, all failed:</p>
                    <ul>
                      {failure.queries.map((q, qIdx) => (
                        <li key={qIdx}>"{q.query}" ({q.type})</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="detailed-results">
            <h3>
              Detailed Results ({results.tests.length} documents)
              <button
                className="btn-link"
                onClick={() => setShowDetails(!showDetails)}
              >
                {showDetails ? 'Hide All' : 'Show All'}
              </button>
            </h3>

            {showDetails && (
              <div className="results-table">
                <table>
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Kind</th>
                      <th>Queries Tested</th>
                      <th>Success Rate</th>
                      <th>Best Rank</th>
                      <th>Avg Score</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.tests.map((test, idx) => {
                      const isSuccess = test.successRate >= 0.5;
                      const isPartial = test.successRate > 0 && test.successRate < 0.5;
                      const isFailed = test.successRate === 0;

                      return (
                        <tr key={idx} className={isFailed ? 'failed-row' : isPartial ? 'partial-row' : 'success-row'}>
                          <td className="doc-title">{test.sourceDoc.title}</td>
                          <td>
                            <span className={`kind-badge kind-${test.sourceDoc.kind}`}>
                              {test.sourceDoc.kind}
                            </span>
                          </td>
                          <td>{test.queries.length}</td>
                          <td className="success-cell">
                            <strong>{formatPercent(test.successRate)}</strong>
                            <span className="query-breakdown">
                              ({test.queries.filter(q => q.rank > 0).length}/{test.queries.length})
                            </span>
                          </td>
                          <td className="rank-cell">
                            {test.bestRank === Infinity ? 'Not found' : `#${test.bestRank}`}
                          </td>
                          <td className="score-cell">
                            {test.avgScore > 0 ? test.avgScore.toFixed(3) : 'N/A'}
                          </td>
                          <td>
                            {isFailed && <span className="status-badge status-failed">✗ Failed</span>}
                            {isPartial && <span className="status-badge status-partial">⚠ Partial</span>}
                            {isSuccess && <span className="status-badge status-success">✓ OK</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {results.summary.successRate_top10 >= 0.8 && results.totalFailures.length === 0 && (
            <div className="success-message">
              <h3>✓ Search Quality is Good!</h3>
              <p>
                Your semantic search is performing well. Most documents are found in top-{limit} results.
              </p>
              {limit === 8 && results.summary.successRate_top5 >= 0.7 && (
                <p className="tip">
                  Tip: Your current MCP limit (8) seems appropriate based on these results.
                </p>
              )}
            </div>
          )}

          {results.summary.successRate_top10 < 0.6 && (
            <div className="recommendation">
              <h3>⚠ Recommendations</h3>
              <ul>
                {results.summary.successRate_top10 < 0.6 && (
                  <li>Consider increasing search limit from {limit} to {limit + 5} or {limit + 10}</li>
                )}
                {results.summary.avgScore < 0.5 && (
                  <li>Low average scores (&lt;0.5) indicate weak embeddings. Consider reindexing or changing embedding model.</li>
                )}
                {results.totalFailures.length > 3 && (
                  <li>{results.totalFailures.length} documents not found at all. Check if they are properly indexed in Qdrant.</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

SearchQuality.propTypes = {};
