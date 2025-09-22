import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import './NotesTabs.css';
import { Modal } from '/imports/ui/components/Modal/Modal.jsx';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { navigateTo } from '/imports/ui/router.js';

const SortableTab = ({ tab, isActive, isDirty, onClick, onContextMenu, onClose, isEditing, inputRef, editingTitle, setEditingTitle, onSubmit, onKeyDown }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: tab.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  
  const handleClick = (e) => {
    if (e.metaKey || e.ctrlKey) {
      // Cmd-Click or Ctrl-Click: open project
      if (tab.note?.projectId) {
        e.preventDefault();
        navigateTo({ name: 'project', projectId: tab.note.projectId });
      }
    } else {
      // Normal click: switch to tab
      onClick();
    }
  };
  
  return (
    <button
      ref={setNodeRef}
      style={style}
      key={tab.id}
      className={`note-tab ${isActive ? 'active' : ''}`}
      onClick={handleClick}
      onContextMenu={onContextMenu}
      type="button"
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
        <span className="tab-title">{isDirty ? (<span className="tab-dirty" aria-label="Unsaved changes" />) : null}{tab.title}</span>
      )}
      <button
        className="tab-close"
        aria-label="Close tab"
        onClick={onClose}
        type="button"
      >
        ×
      </button>
    </button>
  );
};
SortableTab.propTypes = {
  tab: PropTypes.shape({ 
    id: PropTypes.string.isRequired, 
    title: PropTypes.string,
    note: PropTypes.shape({
      projectId: PropTypes.string
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

export const NotesTabs = ({ openTabs, activeTabId, onTabClick, onTabClose, onTabRename, onTabsReorder, dirtySet, onTabDelete, onCloseOthers, onCloseAll }) => {
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, tabId: null });
  const [editingTab, setEditingTab] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [confirmClose, setConfirmClose] = useState(null); // { type: 'others'|'all', tabId?: string, dirtyCount: number }
  const inputRef = useRef(null);
  const [order, setOrder] = useState([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 5 } }));

  useEffect(() => {
    setOrder(openTabs.map(t => t.id));
  }, [JSON.stringify(openTabs.map(t => t.id))]);

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

  const handleDeleteRequest = (tabId) => {
    setContextMenu({ visible: false, x: 0, y: 0, tabId: null });
    setConfirmDeleteId(tabId);
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
      onTabRename(editingTab, editingTitle.trim());
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
          </div>
        </SortableContext>
      </DndContext>

      {contextMenu.visible && (
        <div
          className="tab-context-menu"
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 1000
          }}
        >
          <button className="context-menu-item" onClick={() => handleRename(contextMenu.tabId)} type="button">Rename</button>
          <button className="context-menu-item" onClick={() => requestCloseOthers(contextMenu.tabId)} type="button">Close Other</button>
          <button className="context-menu-item" onClick={requestCloseAll} type="button">Close All</button>
          <button className="context-menu-item" onClick={() => handleDeleteRequest(contextMenu.tabId)} type="button">Delete</button>
        </div>
      )}

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
};
