import React, { useState, useEffect, useRef } from 'react';
import { parseHashRoute, navigateTo } from '/imports/ui/router.js';
import { NotesPanel } from './NotesPanel/NotesPanel.jsx';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import './NotesPage.css';

export const NotesPage = () => {
  const panelRef = useRef(null);
  const [pendingNavHash, setPendingNavHash] = useState(null);
  const skipNavGuardRef = useRef(false);
  const dirtyCountRef = useRef(0);

  // Navigation guard: warn before leaving with unsaved notes
  useEffect(() => {
    const onHashChange = () => {
      if (skipNavGuardRef.current) {
        skipNavGuardRef.current = false;
        return;
      }
      if (dirtyCountRef.current > 0 && !window.location.hash.startsWith('#/notes')) {
        const newHash = window.location.hash;
        setPendingNavHash(newHash);
        skipNavGuardRef.current = true;
        window.location.hash = '#/notes';
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (dirtyCountRef.current > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Open note from URL hash (#/notes/:noteId) — on mount and on hash changes
  useEffect(() => {
    const tryOpenFromHash = () => {
      const route = parseHashRoute();
      if (route.name === 'notes' && route.noteId) {
        panelRef.current?.openNote(route.noteId);
      }
    };

    // Initial open (panel queues if notes not loaded yet)
    tryOpenFromHash();

    // Also listen for hash changes within #/notes (deep links)
    const onHashChange = () => {
      if (window.location.hash.startsWith('#/notes/')) {
        tryOpenFromHash();
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <div className="notes-page">
      <NotesPanel
        ref={panelRef}
        storageKey="notes"
        showFileOpen
        onDirtyCountChange={(count) => { dirtyCountRef.current = count; }}
        onTabClosed={(tabId) => {
          const route = parseHashRoute();
          if (route.name === 'notes' && route.noteId === tabId) {
            navigateTo({ name: 'notes' });
          }
        }}
      />

      <Modal
        open={!!pendingNavHash}
        onClose={() => setPendingNavHash(null)}
        title="Unsaved changes"
        icon={false}
        actions={[
          <button key="stay" className="btn btn-primary" onClick={() => setPendingNavHash(null)}>Stay</button>,
          <button key="leave" className="btn" onClick={() => {
            skipNavGuardRef.current = true;
            window.location.hash = pendingNavHash;
            setPendingNavHash(null);
          }}>Leave without saving</button>,
        ]}
      >
        <p>You have unsaved notes. Leave without saving?</p>
      </Modal>
    </div>
  );
};
