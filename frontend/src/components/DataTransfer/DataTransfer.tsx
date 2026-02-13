import { useRef, useState } from 'react';
import { dataTransfer } from '../../services/api';
import './DataTransfer.css';

export function DataTransfer() {
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasFile, setHasFile] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImport = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setImporting(true);
    setResult(null);
    setError(null);

    try {
      const res = await dataTransfer.importFile(file);
      setResult(res.stats);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
      setHasFile(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      await dataTransfer.exportData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="data-transfer">
      <h2>Import / Export</h2>

      <div className="transfer-actions">
        <div className="transfer-card">
          <h3>Import</h3>
          <p>Importer des données depuis un fichier Panorama (.ndjson.gz)</p>
          <div className="import-controls">
            <input
              ref={fileRef}
              type="file"
              accept=".gz,.ndjson,.json"
              disabled={importing}
              onChange={() => setHasFile(!!fileRef.current?.files?.length)}
            />
            <button onClick={handleImport} disabled={importing || !hasFile}>
              {importing ? 'Import en cours...' : 'Importer'}
            </button>
          </div>
        </div>

        <div className="transfer-card">
          <h3>Export</h3>
          <p>Exporter toutes vos données au format NDJSON compressé</p>
          <button onClick={handleExport} disabled={exporting}>
            {exporting ? 'Export en cours...' : 'Exporter mes données'}
          </button>
        </div>
      </div>

      {error && <div className="transfer-error">{error}</div>}

      {result && (
        <div className="transfer-result">
          <h3>Import terminé</h3>
          <div className="result-stats">
            <div><strong>{result.imported}</strong> documents importés</div>
            <div><strong>{result.skipped}</strong> ignorés</div>
            <div><strong>{result.errors}</strong> erreurs</div>
            <div><strong>{result.idMappings}</strong> IDs mappés</div>
          </div>
          {result.byCollection && Object.keys(result.byCollection).length > 0 && (
            <div className="result-details">
              <h4>Par collection</h4>
              <ul>
                {Object.entries(result.byCollection).sort().map(([coll, count]) => (
                  <li key={coll}><strong>{coll}</strong>: {count as number}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
