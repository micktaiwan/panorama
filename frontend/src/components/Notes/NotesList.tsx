import { useEffect, useState, useCallback } from 'react';
import { notes as notesApi } from '../../services/api';
import { socketService } from '../../services/socket';
import type { Note } from '../../types';
import './NotesList.css';

export function NotesList() {
  const [notesList, setNotesList] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [editContent, setEditContent] = useState('');

  const loadNotes = useCallback(async () => {
    try {
      const { notes } = await notesApi.list();
      setNotesList(notes);
    } catch (err) {
      console.error('Load notes error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotes();
    socketService.subscribeNotes();

    const unsub1 = socketService.on('note:created', () => loadNotes());
    const unsub2 = socketService.on('note:updated', () => loadNotes());
    const unsub3 = socketService.on('note:deleted', () => loadNotes());
    const unsub4 = socketService.on('internal:connected', () => socketService.subscribeNotes());

    return () => {
      unsub1(); unsub2(); unsub3(); unsub4();
      socketService.unsubscribeNotes();
    };
  }, [loadNotes]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const { note } = await notesApi.create({ title: newTitle.trim() });
    setNewTitle('');
    setShowCreate(false);
    setSelectedNote(note);
    setEditContent(note.content);
  };

  const handleSelect = (note: Note) => {
    setSelectedNote(note);
    setEditContent(note.content);
  };

  const handleSave = async () => {
    if (!selectedNote) return;
    await notesApi.update(selectedNote._id, { content: editContent });
  };

  const handleDelete = async (id: string) => {
    await notesApi.delete(id);
    if (selectedNote?._id === id) {
      setSelectedNote(null);
      setEditContent('');
    }
  };

  if (loading) return <div className="notes-loading">Chargement...</div>;

  return (
    <div className="notes-layout">
      <div className="notes-sidebar">
        <div className="notes-sidebar-header">
          <h2>Notes</h2>
          <button className="btn-primary" onClick={() => setShowCreate(!showCreate)}>+</button>
        </div>

        {showCreate && (
          <form className="create-form-compact" onSubmit={handleCreate}>
            <input
              type="text"
              placeholder="Titre"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              autoFocus
            />
          </form>
        )}

        <ul className="notes-items">
          {notesList.map(note => (
            <li
              key={note._id}
              className={`note-item ${selectedNote?._id === note._id ? 'active' : ''}`}
              onClick={() => handleSelect(note)}
            >
              <span className="note-title">{note.title || 'Sans titre'}</span>
              <span className="note-date">
                {new Date(note.updatedAt).toLocaleDateString('fr-FR')}
              </span>
              <button
                className="delete-btn"
                onClick={e => { e.stopPropagation(); handleDelete(note._id); }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="notes-editor">
        {selectedNote ? (
          <>
            <div className="editor-header">
              <h3>{selectedNote.title || 'Sans titre'}</h3>
              <button className="btn-save" onClick={handleSave}>Sauvegarder</button>
            </div>
            <textarea
              className="editor-textarea"
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              placeholder="Contenu de la note (Markdown)..."
            />
          </>
        ) : (
          <div className="editor-empty">
            Sélectionnez ou créez une note
          </div>
        )}
      </div>
    </div>
  );
}
