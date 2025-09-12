import React from 'react';
import { Meteor } from 'meteor/meteor';
import { notify } from '/imports/ui/utils/notify.js';

export const ImportSettings = () => {
  const [arrInput, setArrInput] = React.useState(() => {
    try {
      return localStorage.getItem('budget.arr') || '';
    } catch (e) {
       
      console.warn('[budget][ui] Failed to read localStorage budget.arr', e);
      return '';
    }
  });
  const saveArr = () => {
    try {
      localStorage.setItem('budget.arr', String(arrInput || ''));
    } catch (e) {
       
      console.warn('[budget][ui] Failed to write localStorage budget.arr', e);
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
          onClick={() => {
            Meteor.call('budget.testPennylaneApi', (err, res) => {
              if (err) {
                 
                console.error('budget.testPennylaneApi failed', err);
                notify({ message: `Pennylane API failed: ${err?.reason || err?.message || 'error'}`, kind: 'error' });
                return;
              }
               
              console.log('[pennylane][test] sample:', res?.sample);
              notify({ message: `Pennylane OK (HTTP ${res?.status ?? '200'})`, kind: 'success' });
            });
          }}
        >
          Test Pennylane API
        </button>
      </div>
    </div>
  );
};

export default ImportSettings;


