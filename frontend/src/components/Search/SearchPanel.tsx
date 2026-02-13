import { useState } from 'react';
import { search as api } from '../../services/api';
import type { SearchResult } from '../../types';
import './SearchPanel.css';

const kindLabels: Record<string, string> = {
  project: 'Projet',
  task: 'Tâche',
  note: 'Note',
  link: 'Lien',
};

export function SearchPanel() {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.query(query.trim(), { kind: kind || undefined });
      setResults(res.results);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur recherche');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  return (
    <div className="search-container">
      <div className="search-toolbar">
        <h2>Recherche sémantique</h2>
      </div>

      <div className="search-bar">
        <input
          className="search-input"
          placeholder="Rechercher dans tous les documents..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <select className="search-filter" value={kind} onChange={e => setKind(e.target.value)}>
          <option value="">Tout</option>
          <option value="project">Projets</option>
          <option value="task">Tâches</option>
          <option value="note">Notes</option>
          <option value="link">Liens</option>
        </select>
        <button className="btn-primary" onClick={handleSearch} disabled={loading}>
          {loading ? 'Recherche...' : 'Chercher'}
        </button>
      </div>

      {error && <p className="search-error">{error}</p>}

      {searched && results.length === 0 && !error && (
        <p className="empty">Aucun résultat pour "{query}"</p>
      )}

      <div className="search-results">
        {results.map((r, i) => (
          <div key={i} className="search-result">
            <div className="result-header">
              <span className="result-kind">{kindLabels[String(r.payload.kind)] || String(r.payload.kind)}</span>
              <span className="result-score">{(r.score * 100).toFixed(0)}%</span>
            </div>
            {(r.payload.name || r.payload.title) ? (
              <strong className="result-title">{String(r.payload.name ?? r.payload.title ?? '')}</strong>
            ) : null}
            {r.payload.preview ? (
              <p className="result-preview">{String(r.payload.preview)}</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
