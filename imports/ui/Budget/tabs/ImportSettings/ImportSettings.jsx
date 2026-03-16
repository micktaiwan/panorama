import React from 'react';
import { Meteor } from 'meteor/meteor';


export const ImportSettings = () => {
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState(null); // { ok, message }
  const [arrInput, setArrInput] = React.useState(() => {
    try {
      return localStorage.getItem('budget.arr') || '';
    } catch (e) {
      console.error('[budget][ui] Failed to read localStorage budget.arr', e);
      return '';
    }
  });
  const saveArr = () => {
    try {
      localStorage.setItem('budget.arr', String(arrInput || ''));
    } catch (e) {
      console.error('[budget][ui] Failed to write localStorage budget.arr', e);
    }
  };
  return (
    <div className="panel">
      <h3>Settings</h3>
      <label>
        <span className="mr4">Current ARR (major units):</span>
        <input className="budgetSearch" style={{ width: 200 }} value={arrInput} onChange={(e) => setArrInput(e.target.value)} placeholder="e.g. 12000000" />
      </label>
      <button className="btn ml8" onClick={saveArr}>Save</button>
      <div className="mt12">
        <button
          className="btn"
          disabled={testing}
          onClick={() => {
            setTesting(true);
            setTestResult(null);
            Meteor.call('budget.testPennylaneApi', (err, res) => {
              setTesting(false);
              if (err) {
                console.error('budget.testPennylaneApi failed', err);
                setTestResult({ ok: false, message: err?.reason || err?.message || 'Unknown error' });
                return;
              }
              setTestResult({ ok: true, message: `OK — HTTP ${res?.status ?? '200'}, endpoint: ${res?.url || '?'}` });
            });
          }}
        >
          {testing ? 'Testing…' : 'Test Pennylane API'}
        </button>
        {testResult && (
          <span className="ml8" style={{ color: testResult.ok ? 'var(--green)' : 'var(--red)' }}>
            {testResult.ok ? '✓' : '✗'} {testResult.message}
          </span>
        )}
      </div>
    </div>
  );
};

export default ImportSettings;


