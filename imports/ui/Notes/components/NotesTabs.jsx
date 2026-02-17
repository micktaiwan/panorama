import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import './NotesTabs.css';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { navigateTo } from '/imports/ui/router.js';

const SortableTab = ({ tab, isActive, isDirty, onClick, onContextMenu, onClose, isEditing, inputRef, editingTitle, setEditingTitle, onSubmit, onKeyDown }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: tab?.id || 'fallback-id',
    disabled: isEditing // Disable dragging while editing
  });

  // Defensive check: if tab.id is undefined, don't render the component
  if (!tab?.id) {
    return null;
  }
  const style = { transform: CSS.Transform.toString(transform), transition };
  const isFileTab = tab.type === 'file';

  const handleClick = (e) => {
    if (e.metaKey || e.ctrlKey) {
      // Cmd-Click or Ctrl-Click: open project (only for note tabs)
      if (!isFileTab && tab.note?.projectId) {
        e.preventDefault();
        navigateTo({ name: 'project', projectId: tab.note.projectId });
      }
    } else {
      // Normal click: switch to tab
      onClick();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || (e.key === ' ' && !isEditing)) {
      e.preventDefault();
      handleClick(e);
    }
  };
  
  return (
    <div
      ref={setNodeRef}
      style={style}
      key={tab.id}
      className={`note-tab ${isActive ? 'active' : ''} ${isFileTab ? 'file-tab' : ''} ${tab.note?.claudeProjectId ? 'claude-project' : ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={onContextMenu}
      role="tab"
      tabIndex={0}
      title={isFileTab ? tab.filePath : undefined}
    >
      <div
        className="tab-draggable"
        {...attributes}
        {...listeners}
      >
      {isEditing ? (
        <input
          ref={inputRef}
          className="tab-title-edit"
          value={editingTitle}
          onChange={(e) => setEditingTitle(e.target.value)}
          onBlur={onSubmit}
          onKeyDown={onKeyDown}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="tab-title">{isDirty ? (<span className="tab-dirty" aria-label="Unsaved changes" />) : null}{isFileTab && <span className="tab-file-icon">F</span>}{tab.note?.claudeProjectId && <svg className="tab-claude-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm2.5 6.5L6.5 8 4.5 6.5M8 9.5h3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}{tab.title}</span>
      )}
      </div>
      <button
        className="tab-close"
        aria-label="Close tab"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose(e);
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        type="button"
      >
        ×
      </button>
    </div>
  );
};
SortableTab.propTypes = {
  tab: PropTypes.shape({
    id: PropTypes.string,
    title: PropTypes.string,
    type: PropTypes.oneOf(['note', 'file']),
    filePath: PropTypes.string,
    note: PropTypes.shape({
      projectId: PropTypes.string,
      claudeProjectId: PropTypes.string
    })
  }),
  isActive: PropTypes.bool,
  isDirty: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
  onContextMenu: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  isEditing: PropTypes.bool,
  inputRef: PropTypes.any,
  editingTitle: PropTypes.string,
  setEditingTitle: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  onKeyDown: PropTypes.func.isRequired,
};

export const NotesTabs = ({ openTabs, activeTabId, onTabClick, onTabClose, onTabRename, onTabsReorder, dirtySet, onTabDelete, onCloseOthers, onCloseAll, onCreateNote, isCreatingNote = false, onOpenFile, onBackToList }) => {
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, tabId: null });
  const [editingTab, setEditingTab] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [confirmClose, setConfirmClose] = useState(null); // { type: 'others'|'all', tabId?: string, dirtyCount: number }
  const inputRef = useRef(null);
  const [order, setOrder] = useState([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 5 } }));

  useEffect(() => {
    const ids = openTabs.map(t => t.id);
    const uniqueIds = [...new Set(ids)];

    // Warn if duplicates detected (should never happen with our deduplication)
    if (ids.length !== uniqueIds.length) {
      console.error('[NotesTabs] Duplicate tab IDs detected:', ids);
      console.error('[NotesTabs] This should not happen - check deduplication in NotesPage');
    }

    setOrder(ids);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTabs.length, openTabs.map(t => t.id).join(',')]);

  const handleContextMenu = (e, tabId) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      tabId
    });
  };

  const handleRename = (tabId) => {
    const tab = openTabs.find(t => t.id === tabId);
    if (tab) {
      setEditingTab(tabId);
      setEditingTitle(tab.title);
      setContextMenu({ visible: false, x: 0, y: 0, tabId: null });
    }
  };

  const handleDeleteRequest = (tabId, e) => {
    setContextMenu({ visible: false, x: 0, y: 0, tabId: null });
    if (e?.shiftKey) {
      onTabDelete?.(tabId);
    } else {
      setConfirmDeleteId(tabId);
    }
  };

  const requestCloseOthers = (tabId) => {
    setContextMenu({ visible: false, x: 0, y: 0, tabId: null });
    const toClose = openTabs.filter(t => t.id !== tabId).map(t => t.id);
    const dirtyCount = toClose.filter(id => dirtySet?.has(id)).length;
    if (dirtyCount > 0) setConfirmClose({ type: 'others', tabId, dirtyCount });
    else onCloseOthers?.(tabId);
  };

  const requestCloseAll = () => {
    setContextMenu({ visible: false, x: 0, y: 0, tabId: null });
    const toClose = openTabs.map(t => t.id);
    const dirtyCount = toClose.filter(id => dirtySet?.has(id)).length;
    if (dirtyCount > 0) setConfirmClose({ type: 'all', dirtyCount });
    else onCloseAll?.();
  };

  const handleRenameSubmit = () => {
    if (editingTab && editingTitle.trim()) {
      onTabRename(editingTab, editingTitle);
    }
    setEditingTab(null);
    setEditingTitle('');
  };

  const handleRenameCancel = () => {
    setEditingTab(null);
    setEditingTitle('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      handleRenameCancel();
    }
  };

  // Define inside but eslint prefers outside; acceptable in this context
  const onDragEnd = (event) => {
    const { active, over } = event;
    if (!active || !over || active.id === over.id) return;
    const oldIndex = order.indexOf(active.id);
    const newIndex = order.indexOf(over.id);
    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next);
    if (typeof onTabsReorder === 'function') onTabsReorder(next);
  };

  useEffect(() => {
    if (editingTab && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingTab]);

  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenu({ visible: false, x: 0, y: 0, tabId: null });
    };

    if (contextMenu.visible) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu.visible]);

  if (openTabs.length === 0) return null;

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={horizontalListSortingStrategy}>
          <div className="notes-tabs">
            {onBackToList && (
              <button className="notes-back-button" onClick={onBackToList} title="Back to notes list" type="button">
                &#x2190;
              </button>
            )}
            {openTabs.map(tab => (
              <SortableTab
                key={tab.id}
                tab={tab}
                isActive={activeTabId === tab.id}
                isDirty={!!dirtySet?.has(tab.id)}
                onClick={() => onTabClick(tab.id)}
                onContextMenu={(e) => handleContextMenu(e, tab.id)}
                onClose={(e) => { e.stopPropagation(); onTabClose(tab.id); }}
                isEditing={editingTab === tab.id}
                inputRef={inputRef}
                editingTitle={editingTitle}
                setEditingTitle={setEditingTitle}
                onSubmit={handleRenameSubmit}
                onKeyDown={handleKeyDown}
              />
            ))}
            <button
              className="new-note-button"
              onClick={onCreateNote}
              disabled={isCreatingNote}
              title={isCreatingNote ? "Creating note..." : "Create new note"}
              type="button"
            >
              {isCreatingNote ? "..." : "+"}
            </button>
            {onOpenFile && (
              <button
                className="new-note-button open-file-button"
                onClick={onOpenFile}
                title="Open file from disk"
                type="button"
              >
                F
              </button>
            )}
          </div>
        </SortableContext>
      </DndContext>

      {contextMenu.visible && (() => {
        const ctxTab = openTabs.find(t => t.id === contextMenu.tabId);
        const isFile = ctxTab?.type === 'file';
        return (
          <div
            className="tab-context-menu"
            style={{
              position: 'fixed',
              left: contextMenu.x,
              top: contextMenu.y,
              zIndex: 1000
            }}
          >
            {!isFile && <button className="context-menu-item" onClick={() => handleRename(contextMenu.tabId)} type="button">Rename</button>}
            <button className="context-menu-item" onClick={() => { setContextMenu({ visible: false, x: 0, y: 0, tabId: null }); onTabClose(contextMenu.tabId); }} type="button">Close</button>
            <button className="context-menu-item" onClick={() => requestCloseOthers(contextMenu.tabId)} type="button">Close Other</button>
            <button className="context-menu-item" onClick={requestCloseAll} type="button">Close All</button>
            {!isFile && <button className="context-menu-item" onClick={() => handleDeleteRequest(contextMenu.tabId)} type="button">Delete</button>}
          </div>
        );
      })()}

      <Modal
        open={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        title="Delete note?"
        actions={[
          <button key="cancel" className="btn" type="button" onClick={() => setConfirmDeleteId(null)}>Cancel</button>,
          <button key="delete" className="btn btn-primary" type="button" onClick={() => { onTabDelete?.(confirmDeleteId); setConfirmDeleteId(null); }}>Delete</button>,
        ]}
      >
        This will permanently delete this note. This action cannot be undone.
      </Modal>

      <Modal
        open={!!confirmClose}
        onClose={() => setConfirmClose(null)}
        title="Close tabs?"
        actions={[
          <button key="cancel" className="btn" type="button" onClick={() => setConfirmClose(null)}>Cancel</button>,
          <button
            key="proceed"
            className="btn btn-primary"
            type="button"
            onClick={() => {
              if (confirmClose?.type === 'others') onCloseOthers?.(confirmClose.tabId);
              else if (confirmClose?.type === 'all') onCloseAll?.();
              setConfirmClose(null);
            }}
          >
            Close ({confirmClose?.dirtyCount} unsaved)
          </button>,
        ]}
      >
        {confirmClose?.dirtyCount > 1 ? 'Some tabs have unsaved changes. Close them anyway?' : 'One tab has unsaved changes. Close it anyway?'}
      </Modal>
    </>
  );
};

NotesTabs.propTypes = {
  openTabs: PropTypes.array.isRequired,
  activeTabId: PropTypes.string,
  onTabClick: PropTypes.func.isRequired,
  onTabClose: PropTypes.func.isRequired,
  onTabRename: PropTypes.func.isRequired,
  onTabsReorder: PropTypes.func,
  dirtySet: PropTypes.instanceOf(Set),
  onTabDelete: PropTypes.func,
  onCloseOthers: PropTypes.func,
  onCloseAll: PropTypes.func,
  onCreateNote: PropTypes.func,
  isCreatingNote: PropTypes.bool,
  onOpenFile: PropTypes.func,
  onBackToList: PropTypes.func,
};
