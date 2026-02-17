import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Meteor } from 'meteor/meteor';
import { ProseMirrorEditor } from '/imports/ui/Notes/components/ProseMirrorEditor/ProseMirrorEditor.jsx';
import { notify } from '/imports/ui/utils/notify.js';
import './DiskFileEditor.css';

const basename = (filePath) => {
  const parts = filePath.split('/');
  return parts[parts.length - 1];
};

const shortenPath = (filePath, maxLen = 60) => {
  if (filePath.length <= maxLen) return filePath;
  const parts = filePath.split('/');
  if (parts.length <= 3) return filePath;
  return `.../${parts.slice(-3).join('/')}`;
};

export const DiskFileEditor = ({ filePath, onClose, onDirtyChange }) => {
  const [content, setContent] = useState(null);
  const [baselineContent, setBaselineContent] = useState(null);
  const [mtime, setMtime] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef(null);
  const contentRef = useRef(null);

  const dirty = content !== null && baselineContent !== null && content !== baselineContent;

  useEffect(() => {
    onDirtyChange?.(dirty);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  const loadFile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await Meteor.callAsync('diskFile.read', filePath);
      setContent(result.content);
      setBaselineContent(result.content);
      contentRef.current = result.content;
      setMtime(result.mtime);
    } catch (err) {
      setError(err.reason || err.message || 'Failed to read file');
    } finally {
      setLoading(false);
    }
  }, [filePath]);

  useEffect(() => {
    loadFile();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // Check for external changes on window focus
  useEffect(() => {
    const handleFocus = async () => {
      if (!mtime) return;
      try {
        const result = await Meteor.callAsync('diskFile.read', filePath);
        if (result.mtime !== mtime && result.content !== baselineContent) {
          // File changed on disk
          if (!dirty) {
            // No local changes, reload silently
            setContent(result.content);
            setBaselineContent(result.content);
            contentRef.current = result.content;
            setMtime(result.mtime);
          } else {
            notify({ message: 'File changed on disk. Save will overwrite.', kind: 'info' });
          }
        }
      } catch {
        // File may have been deleted, ignore
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [filePath, mtime, baselineContent, dirty]);

  const handleSave = useCallback(async () => {
    const toSave = contentRef.current ?? content;
    if (toSave === null || toSave === undefined) return;
    setSaving(true);
    try {
      const result = await Meteor.callAsync('diskFile.write', filePath, toSave);
      setBaselineContent(toSave);
      setMtime(result.mtime);
      notify({ message: 'File saved', kind: 'success' });
    } catch (err) {
      notify({ message: `Save failed: ${err.reason || err.message}`, kind: 'error' });
    } finally {
      setSaving(false);
    }
  }, [filePath, content]);

  const handleChange = useCallback((md) => {
    setContent(md);
    contentRef.current = md;
  }, []);

  if (loading) {
    return (
      <div className="disk-file-editor">
        <div className="disk-file-editor-loading">Loading file...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="disk-file-editor">
        <div className="disk-file-editor-header">
          <span className="disk-file-editor-name">{basename(filePath)}</span>
          {onClose && (
            <button className="btn btn-small" onClick={onClose} type="button">Close</button>
          )}
        </div>
        <div className="disk-file-editor-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="disk-file-editor">
      <div className="disk-file-editor-header">
        <div className="disk-file-editor-title">
          <span className="disk-file-editor-badge">F</span>
          <span className="disk-file-editor-name">{basename(filePath)}</span>
          <span className="disk-file-editor-path" title={filePath}>{shortenPath(filePath)}</span>
          {dirty && <span className="disk-file-editor-dirty">unsaved</span>}
        </div>
        <div className="disk-file-editor-actions">
          <button
            className="btn btn-small"
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          {onClose && (
            <button className="btn btn-small" onClick={onClose} type="button">Close</button>
          )}
        </div>
      </div>
      <div className="disk-file-editor-body">
        <ProseMirrorEditor
          ref={editorRef}
          key={filePath}
          content={content ?? ''}
          onChange={handleChange}
          onSave={handleSave}
          shouldFocus
        />
      </div>
    </div>
  );
};
