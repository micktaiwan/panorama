import { useState, useEffect, useCallback, useRef } from 'react';
import { files as api, getApiBaseUrl } from '../../services/api';
import type { FileDoc } from '../../types';
import './FilesList.css';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function FilesList() {
  const [items, setItems] = useState<FileDoc[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await api.list();
    setItems(res.files);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      await api.upload(file);
      load();
    } catch (err) {
      console.error('Upload error:', err);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (id: string) => {
    await api.delete(id);
    load();
  };

  const handleDownload = (file: FileDoc) => {
    const token = localStorage.getItem('panoramix-token');
    const url = `${getApiBaseUrl()}/files/${file._id}/download`;
    // Open download in new window with auth
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    // Use fetch for auth'd download
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = file.originalName;
        link.click();
        URL.revokeObjectURL(blobUrl);
      });
  };

  const mimeIcon = (mime: string) => {
    if (mime.startsWith('image/')) return 'img';
    if (mime.startsWith('video/')) return 'vid';
    if (mime.includes('pdf')) return 'pdf';
    if (mime.includes('spreadsheet') || mime.includes('excel')) return 'xls';
    if (mime.includes('document') || mime.includes('word')) return 'doc';
    return 'file';
  };

  return (
    <div className="files-container">
      <div className="files-toolbar">
        <h2>Fichiers</h2>
        <label className="btn-primary upload-btn">
          {isUploading ? 'Upload...' : '+ Fichier'}
          <input ref={fileInputRef} type="file" hidden onChange={handleUpload} disabled={isUploading} />
        </label>
      </div>

      <div className="files-list">
        {items.map(file => (
          <div key={file._id} className="file-card">
            <div className="file-icon">{mimeIcon(file.mimeType)}</div>
            <div className="file-info">
              <strong>{file.name}</strong>
              <span className="file-meta">{file.originalName} &middot; {formatSize(file.size)}</span>
            </div>
            <div className="file-actions">
              <button className="btn-small" onClick={() => handleDownload(file)}>Télécharger</button>
              <button className="btn-small btn-danger" onClick={() => handleDelete(file._id)}>Supprimer</button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="empty">Aucun fichier</p>}
      </div>
    </div>
  );
}
