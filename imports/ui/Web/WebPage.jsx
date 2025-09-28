import React, { useState } from 'react';
import { useFind } from 'meteor/react-meteor-data';
import { AppPreferencesCollection } from '../../api/appPreferences/collections';
import { notify } from '../utils/notify.js';
import './WebPage.css';
import { marked } from 'marked';
import { Meteor } from 'meteor/meteor';
import '/imports/ui/NoteSession/NoteSession.css';

export const WebPage = () => {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [savingNote, setSavingNote] = useState(false);

  const prefs = useFind(() => AppPreferencesCollection.find({}, { limit: 1 }))[0];
  const hasApiKey = !!(prefs?.perplexityApiKey);

  const handleSearch = async () => {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      notify({ message: 'Please enter a query', kind: 'error' });
      return;
    }

    if (trimmedQuery.length > 10000) {
      notify({ message: 'Query is too long (max 10,000 characters)', kind: 'error' });
      return;
    }

    if (!hasApiKey) {
      notify({ message: 'Perplexity API key not configured. Go to Preferences.', kind: 'error' });
      return;
    }

    setIsLoading(true);
    setResults(null);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${prefs.perplexityApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'sonar-pro',
          messages: [
            {
              role: 'user',
              content: trimmedQuery
            }
          ],
          max_tokens: 1000,
          temperature: 0.2
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const suffix = errorText ? ' - ' + errorText : '';
        throw new Error(`API Error ${response.status}: ${response.statusText}${suffix}`);
      }

      const data = await response.json();
      console.log('[web] Perplexity raw response', data);

      if (!data || typeof data !== 'object') {
        throw new Error('Invalid API response format');
      }

      const content = data.choices?.[0]?.message?.content;
      // Try multiple citation shapes used by Perplexity/SDKs
      const rootCitations = Array.isArray(data?.citations) ? data.citations : [];
      const msgCitations = Array.isArray(data?.choices?.[0]?.message?.citations)
        ? data.choices[0].message.citations
        : [];
      const choiceCitations = Array.isArray(data?.choices?.[0]?.citations)
        ? data.choices[0].citations
        : [];
      const citationsAny = rootCitations.length ? rootCitations : (msgCitations.length ? msgCitations : choiceCitations);
      // Normalize to list of {id,title?,url?}
      const citationsNorm = (Array.isArray(citationsAny) ? citationsAny : []).map((c, i) => {
        if (typeof c === 'string') return { id: i + 1, url: c };
        if (c && typeof c === 'object') {
          return {
            id: c.id ?? i + 1,
            url: c.url || c.source || c.link || '',
            title: c.title || c.name || c.site || ''
          };
        }
        return null;
      }).filter((x) => x && (x.url || x.title));
      console.log('[web] Derived citations', { rootCitations, msgCitations, choiceCitations, citationsNorm });

      if (!content || typeof content !== 'string') {
        throw new Error('No valid response content received from API');
      }

      setResults({
        query: trimmedQuery,
        response: content.trim(),
        timestamp: new Date(),
        citations: citationsNorm
      });

      notify({ message: 'Search completed', kind: 'success' });
    } catch (error) {
      console.error('Search error:', error);

      let errorMessage = 'An unexpected error occurred';
      if (error.name === 'AbortError') {
        errorMessage = 'Request timed out. Please try again.';
      } else if (error.message) {
        errorMessage = error.message;
      }

      notify({ message: `Search failed: ${errorMessage}`, kind: 'error' });
      setResults({ error: errorMessage });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };

  return (
    <div className="webPage">
      <h2>Web Search with Perplexity AI</h2>

      {!hasApiKey && (
        <div className="apiKeyWarning">
          <p>⚠️ Perplexity API key not configured. Go to <a href="#/preferences">Preferences</a> to add it.</p>
        </div>
      )}

      <div className="webSearchSection">
        <div className="webSearchInputContainer">
          <textarea
            className="input searchInput"
            placeholder="Ask your question or describe what you're looking for..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyPress={handleKeyPress}
            rows={3}
            disabled={isLoading}
          />
          <button
            className="btn btn-primary"
            onClick={handleSearch}
            disabled={isLoading || !query.trim() || !hasApiKey}
          >
            {isLoading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </div>

      {results && !results.error && (
        <div className="resultsSection">
          <h3>Results for: "{results.query}"</h3>
          <div
            className="resultContent aiMarkdown webMarkdown"
            dangerouslySetInnerHTML={{ __html: marked.parse(results.response || '') }}
          />
          <div className="resultActions">
            <button
              className="btn"
              disabled={savingNote}
              onClick={() => {
                if (savingNote) return;
                const raw = results?.response || '';
                const title = String(results?.query || '').slice(0, 120);
                setSavingNote(true);
                Meteor.call('notes.insert', { title, content: raw }, (err, noteId) => {
                  setSavingNote(false);
                  if (err) {
                    notify({ message: err?.reason || err?.message || 'Failed to create note', kind: 'error' });
                    return;
                  }
                  notify({ message: 'Note created', kind: 'success' });
                });
              }}
            >
              {savingNote ? 'Saving…' : 'Transform into Note'}
            </button>
          </div>
          {Array.isArray(results?.citations) && results.citations.length > 0 ? (
            <div className="resultCitations">
              <h4>Sources</h4>
              <ol>
                {results.citations.map((c) => (
                  <li key={String(c?.id || c?.url || c?.title || Math.random())}>
                    {c?.title ? <span className="srcTitle">{c.title}</span> : null}
                    {c?.url ? (
                      <a className="srcLink" href={c.url} target="_blank" rel="noreferrer noopener">
                        {c.url}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          <div className="resultMeta">
            Search performed on {results?.timestamp?.toLocaleString()}
          </div>
        </div>
      )}

      {results?.error && (
        <div className="errorSection">
          <p>❌ Error: {results?.error}</p>
        </div>
      )}
    </div>
  );
};
