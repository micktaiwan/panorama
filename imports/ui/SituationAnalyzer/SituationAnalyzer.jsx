import React, { useEffect, useMemo, useState } from 'react';
import './SituationAnalyzer.css';
import { useTracker } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { SituationsCollection } from '/imports/api/situations/collections';
import { SituationActorsCollection } from '/imports/api/situationActors/collections';
import { SituationNotesCollection } from '/imports/api/situationNotes/collections';
import { SituationQuestionsCollection } from '/imports/api/situationQuestions/collections';
import { SituationSummariesCollection } from '/imports/api/situationSummaries/collections';
import { InlineEditable } from '/imports/ui/InlineEditable/InlineEditable.jsx';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { Notify } from '/imports/ui/components/Notify/Notify.jsx';
import { PeopleCollection } from '/imports/api/people/collections';
import { writeClipboard } from '/imports/ui/utils/clipboard.js';
import { setNotifyHandler } from '/imports/ui/utils/notify.js';

export const SituationAnalyzer = () => {
  const [selectedSituationId, setSelectedSituationId] = useState(() => {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem('sa_last_situation') || null;
  });
  const [deleteNoteId, setDeleteNoteId] = useState(null);
  const [deleteActorId, setDeleteActorId] = useState(null);
  const [deleteSituationOpen, setDeleteSituationOpen] = useState(false);
  const [genQLoading, setGenQLoading] = useState(false);
  const [extractActorsLoading, setExtractActorsLoading] = useState(false);
  const [genSummaryLoading, setGenSummaryLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const subsReady = useTracker(() => Meteor.subscribe('situations.all').ready(), []);
  const situations = useTracker(() => SituationsCollection.find({}, { sort: { updatedAt: -1 } }).fetch(), [subsReady]);
  const currentId = useMemo(() => selectedSituationId || (situations[0]?._id || null), [selectedSituationId, JSON.stringify(situations.map(s => s._id))]);

  useEffect(() => {
    if (!Array.isArray(situations)) return;
    const exists = selectedSituationId && situations.some(s => s._id === selectedSituationId);
    if (!exists && situations[0]?._id) {
      setSelectedSituationId(situations[0]._id);
    }
  }, [selectedSituationId, JSON.stringify(situations.map(s => s._id))]);

  useEffect(() => {
    if (currentId && typeof localStorage !== 'undefined') {
      localStorage.setItem('sa_last_situation', currentId);
    }
  }, [currentId]);

  const actorsReady = useTracker(() => currentId ? Meteor.subscribe('situationActors.forSituation', currentId).ready() : true, [currentId]);
  const notesReady = useTracker(() => currentId ? Meteor.subscribe('situationNotes.forSituation', currentId).ready() : true, [currentId]);
  const questionsReady = useTracker(() => currentId ? Meteor.subscribe('situationQuestions.forSituation', currentId).ready() : true, [currentId]);
  const summariesReady = useTracker(() => currentId ? Meteor.subscribe('situationSummaries.forSituation', currentId).ready() : true, [currentId]);

  const actors = useTracker(() => currentId ? SituationActorsCollection.find({ situationId: currentId }, { sort: { createdAt: 1 } }).fetch() : [], [actorsReady, currentId]);
  const notes = useTracker(() => currentId ? SituationNotesCollection.find({ situationId: currentId }, { sort: { createdAt: 1 } }).fetch() : [], [notesReady, currentId]);
  const questions = useTracker(() => currentId ? SituationQuestionsCollection.find({ situationId: currentId }).fetch() : [], [questionsReady, currentId]);
  const summary = useTracker(() => currentId ? SituationSummariesCollection.findOne({ situationId: currentId }) : null, [summariesReady, currentId]);
  const peopleReady = useTracker(() => Meteor.subscribe('people.all').ready(), []);
  const people = useTracker(() => PeopleCollection.find({}, { sort: { name: 1, lastName: 1 } }).fetch(), [peopleReady]);
  const [selectedPersonId, setSelectedPersonId] = useState('');

  const current = situations.find(s => s._id === currentId) || null;

  useEffect(() => {
    setNotifyHandler((t) => setToast(t));
    return () => setNotifyHandler(null);
  }, []);

  const addSituation = () => {
    Meteor.call('situations.insert', { title: 'New Situation' }, (err, res) => {
      if (err) { console.error('situations.insert failed', err); return; }
      if (res) setSelectedSituationId(res);
    });
  };

  const addActorFromPeople = () => {
    if (!currentId) return;
    const p = people.find(x => x._id === selectedPersonId);
    if (!p) return;
    const fullName = [p.name || '', p.lastName || ''].filter(Boolean).join(' ').trim() || (p.name || '');
    const role = p.role || '';
    Meteor.call('situationActors.insert', { situationId: currentId, personId: p._id, name: fullName, role }, () => {
      setSelectedPersonId('');
    });
  };

  const addNote = (actorId) => {
    if (!currentId) return;
    Meteor.call('situationNotes.insert', { situationId: currentId, actorId, content: '' });
  };

  const generateQuestions = () => {
    if (!currentId) return;
    setGenQLoading(true);
    Meteor.call('situations.generateQuestions', currentId, current?.description || '', (err) => {
      setGenQLoading(false);
      if (err) console.error('generateQuestions failed', err);
    });
  };

  const generateSummary = () => {
    if (!currentId) return;
    const allMd = (notes || []).map(n => n.content || '').filter(Boolean).join('\n\n');
    setGenSummaryLoading(true);
    Meteor.call('situations.generateSummary', currentId, current?.description || '', allMd, (err) => {
      setGenSummaryLoading(false);
      if (err) console.error('generateSummary failed', err);
    });
  };

  return (
    <div className="situationAnalyzer">
      <div className="headerRow">
        <h2>Situation Analyzer</h2>
        <button className="btn" onClick={addSituation}>New Situation</button>
        {currentId ? (
          <button className="btn ml8" onClick={() => setDeleteSituationOpen(true)}>Delete situation</button>
        ) : null}
        <select
          className="situationSelect"
          value={currentId || ''}
          onChange={e => setSelectedSituationId(e.target.value || null)}
        >
          {(situations || []).map(s => (
            <option key={s._id} value={s._id}>{s.title || '(untitled)'}</option>
          ))}
        </select>
      </div>

      {current ? (
        <div className="grid">
          <div className="col">
            <h3>Situation</h3>
            <div className="fieldRow">
              <label className="fieldLabel">Title</label>
              <InlineEditable
                value={current.title || ''}
                placeholder="Title"
                onSubmit={(v) => Meteor.call('situations.update', current._id, { title: v })}
                fullWidth
              />
            </div>
            <label className="descLabel">Description</label>
            <div className="descBox scrollArea">
              <InlineEditable
                value={current.description || ''}
                placeholder="Describe the situation"
                as="textarea"
                rows={6}
                inputClassName="descTextarea"
                onSubmit={(v) => Meteor.call('situations.update', current._id, { description: v })}
                fullWidth
              />
            </div>
            <div className="actionsRow">
              <button className="btn btn-primary" disabled={genQLoading} onClick={generateQuestions}>{genQLoading ? 'Loading...' : 'Generate questions'}</button>
            </div>
          </div>
          <div className="col">
            <h3>Actors</h3>
            <div className="actionsRow">
              <select
                value={selectedPersonId}
                onChange={(e) => setSelectedPersonId(e.target.value)}
                className="situationSelect"
              >
                <option value="">Select a person…</option>
                {(people || []).map(p => {
                  const label = [p.name || '', p.lastName || ''].filter(Boolean).join(' ').trim() || (p.name || '');
                  return <option key={p._id} value={p._id}>{label}</option>;
                })}
              </select>
              <button className="btn ml8" onClick={addActorFromPeople}>Add person</button>
              <button
                className="btn ml8"
                disabled={extractActorsLoading}
                onClick={() => {
                  if (!currentId) return;
                  setExtractActorsLoading(true);
                  Meteor.call('situations.extractActors', currentId, current?.description || '', (err) => {
                    setExtractActorsLoading(false);
                    if (err) {
                      console.error('situations.extractActors failed', err);
                      setToast({ message: 'Auto-detect failed', kind: 'error' });
                    } else {
                      setToast({ message: 'Actors updated', kind: 'success' });
                    }
                  });
                }}
              >
                {extractActorsLoading ? 'Loading...' : 'Auto-detect actors'}
              </button>
            </div>
            <ul className="list">
              {actors.map(a => (
                <li key={a._id} className="row">
                  <div className="actorHeader">
                    <div className="actorInline">
                      {a.personId ? (
                        <a href={`#/people/${a.personId}`} title="Open in People">{a.name || ''}</a>
                      ) : (
                        <span>{a.name || ''}</span>
                      )}
                      <span className="dot">·</span>
                      <span className="muted">{a.role || ''}</span>
                      <span className="dot">·</span>
                      <InlineEditable
                        value={a.situationRole || ''}
                        placeholder="situation role"
                        onSubmit={(v) => Meteor.call('situationActors.update', a._id, { situationRole: v })}
                      />
                      
                    </div>
                    <div className="actorActions">
                      <button
                        className="addNoteBtn"
                        aria-label="Add note"
                        title="Add note"
                        onClick={() => addNote(a._id)}
                      >
                        ＋
                      </button>
                      
                      {!a.personId && (
                        <button
                          className="linkBtn"
                          aria-label="Create person from actor"
                          title="Create person from actor"
                          onClick={() => {
                            const parts = String(a.name || '').trim().split(/\s+/);
                            const first = parts[0] || '';
                            const last = parts.slice(1).join(' ');
                            Meteor.call('people.insert', { name: first, lastName: last }, (err, pid) => {
                              if (err || !pid) { setToast({ message: 'Create person failed', kind: 'error' }); return; }
                              Meteor.call('situationActors.update', a._id, { personId: pid }, (e2) => {
                                if (e2) { setToast({ message: 'Link failed', kind: 'error' }); return; }
                                setToast({ message: 'Person created and linked', kind: 'success' });
                              });
                            });
                          }}
                        >
                          🔗
                        </button>
                      )}
                      <button className="deleteActorBtn" aria-label="Delete actor" title="Delete actor" onClick={() => setDeleteActorId(a._id)}>×</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <h3>Notes</h3>
            <ul className="list">
              {notes.map(n => (
                <li key={n._id} className="row block">
                  <div className="noteHeader">
                    {(() => { const a = actors.find(x => x._id === n.actorId); return <span className="noteActor">{a ? a.name : 'General'}</span>; })()}
                    <button
                      className="deleteNoteBtn"
                      aria-label="Delete note"
                      title="Delete note"
                      onClick={() => setDeleteNoteId(n._id)}
                    >
                      ×
                    </button>
                  </div>
                  <InlineEditable
                    value={n.content || ''}
                    placeholder="Markdown notes"
                    as="textarea"
                    rows={5}
                    onSubmit={(v) => Meteor.call('situationNotes.update', n._id, { content: v })}
                    fullWidth
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <p>No situation yet. Create one to get started.</p>
      )}

      {current ? (
        <div className="panel questionsPanel">
          <h3>Questions</h3>
          <div className="questionsBlock">
            {(questions || []).map(q => {
              const actor = actors.find(a => a._id === q.actorId);
              return (
                <div key={q._id} className="card">
                  <div className="cardHeader">
                    <span>{actor ? actor.name : '(unknown actor)'}</span>
                    <button
                      className="copyQuestionsBtn"
                      aria-label="Copy questions"
                      title="Copy questions"
                      onClick={() => {
                        const lines = (Array.isArray(q.questions) ? q.questions : [])
                          .map(item => (typeof item === 'string' ? item : (item && item.q) || ''))
                          .map(s => String(s || '').trim())
                          .filter(Boolean)
                          .map(s => `- ${s}`)
                          .join('\n');
                        if (lines) writeClipboard(lines);
                      }}
                    >
                      📋
                    </button>
                  </div>
                  <div className="questionsLines">
                    {(q.questions || []).map((item, idx) => (
                      <div key={idx} className="questionItem">
                        <div className="questionRow">
                          <InlineEditable
                            value={typeof item === 'string' ? item : (item.q || '')}
                            placeholder="Question"
                            onSubmit={(v) => {
                              const next = Array.isArray(q.questions) ? q.questions.slice() : [];
                              next[idx] = { q: v, r: (typeof item === 'object' && item && item.r) ? item.r : '' };
                              Meteor.call('situationQuestions.upsertForActor', q.situationId, q.actorId, next);
                            }}
                            fullWidth
                          />
                          <button
                            className="deleteQuestionBtn"
                            aria-label="Delete question"
                            title="Delete question"
                            onClick={() => {
                              const next = Array.isArray(q.questions) ? q.questions.slice() : [];
                              next.splice(idx, 1);
                              Meteor.call('situationQuestions.upsertForActor', q.situationId, q.actorId, next);
                            }}
                          >
                            ×
                          </button>
                        </div>
                        <div className="replyRow">
                          <InlineEditable
                            value={(typeof item === 'object' && item && item.r) ? item.r : ''}
                            placeholder="Réponse"
                            as="textarea"
                            rows={3}
                            onSubmit={(v) => {
                              const next = Array.isArray(q.questions) ? q.questions.slice() : [];
                              next[idx] = { q: (typeof item === 'string' ? item : (item.q || '')), r: v };
                              Meteor.call('situationQuestions.upsertForActor', q.situationId, q.actorId, next);
                            }}
                            fullWidth
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="actionsRow">
            <button className="btn btn-primary" disabled={genSummaryLoading} onClick={generateSummary}>{genSummaryLoading ? 'Loading...' : 'Generate summary'}</button>
          </div>
          <h3>Summary</h3>
          <div className="scrollArea markdown summaryBox">
            <div className="summaryText">{summary?.text || ''}</div>
          </div>
        </div>
      ) : null}

      <Modal
        open={!!deleteNoteId}
        onClose={() => setDeleteNoteId(null)}
        title="Delete note"
        actions={[
          <button key="cancel" className="btn" onClick={() => setDeleteNoteId(null)}>Cancel</button>,
          <button
            key="delete"
            className="btn ml8"
            onClick={() => {
              if (!deleteNoteId) return;
              const id = deleteNoteId;
              setDeleteNoteId(null);
              Meteor.call('situationNotes.remove', id, (err) => {
                if (err) console.error('situationNotes.remove failed', err);
              });
            }}
          >
            Delete
          </button>
        ]}
      >
        <p>Are you sure you want to delete this note? This action cannot be undone.</p>
      </Modal>

      <Modal
        open={deleteSituationOpen}
        onClose={() => setDeleteSituationOpen(false)}
        title="Delete situation"
        actions={[
          <button key="cancel" className="btn" onClick={() => setDeleteSituationOpen(false)}>Cancel</button>,
          <button
            key="delete"
            className="btn ml8"
            onClick={() => {
              const id = currentId;
              setDeleteSituationOpen(false);
              if (!id) return;
              Meteor.call('situations.remove', id, (err) => {
                if (err) { console.error('situations.remove failed', err); return; }
                setSelectedSituationId(null);
              });
            }}
          >
            Delete
          </button>
        ]}
      >
        <p>Delete this situation and all its actors, notes, questions and summary? This action cannot be undone.</p>
      </Modal>

      {toast ? (
        <Notify message={toast.message} kind={toast.kind || 'info'} onClose={() => setToast(null)} durationMs={3000} />
      ) : null}

      <Modal
        open={!!deleteActorId}
        onClose={() => setDeleteActorId(null)}
        title="Delete actor"
        actions={[
          <button key="cancel" className="btn" onClick={() => setDeleteActorId(null)}>Cancel</button>,
          <button
            key="delete"
            className="btn ml8"
            onClick={() => {
              if (!deleteActorId) return;
              const id = deleteActorId;
              setDeleteActorId(null);
              Meteor.call('situationActors.remove', id, (err) => {
                if (err) console.error('situationActors.remove failed', err);
              });
            }}
          >
            Delete
          </button>
        ]}
      >
        <p>Delete this actor and all their notes? This action cannot be undone.</p>
      </Modal>
    </div>
  );
};


