import { useState, useEffect, useCallback } from 'react';
import { budget as api } from '../../services/api';
import type { BudgetLine, BudgetSummary } from '../../types';
import './BudgetView.css';

function formatAmount(cents: number): string {
  const abs = Math.abs(cents / 100);
  const sign = cents < 0 ? '-' : '';
  return `${sign}${abs.toFixed(2)} €`;
}

const DEPARTMENTS = ['', 'tech', 'product', 'parked', 'other'] as const;
const DEPT_LABELS: Record<string, string> = { '': 'Non classé', tech: 'Tech', product: 'Produit', parked: 'En attente', other: 'Autre' };

export function BudgetView() {
  const [lines, setLines] = useState<BudgetLine[]>([]);
  const [summary, setSummary] = useState<BudgetSummary[]>([]);
  const [view, setView] = useState<'lines' | 'summary'>('lines');
  const [filterDept, setFilterDept] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({ date: '', vendor: '', amountCents: '', category: '', notes: '' });

  const load = useCallback(async () => {
    const [lRes, sRes] = await Promise.all([
      api.list({ department: filterDept || undefined }),
      api.summary(),
    ]);
    setLines(lRes.lines);
    setSummary(sRes.summary);
  }, [filterDept]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!form.date || !form.vendor.trim() || !form.amountCents) return;
    await api.create({
      date: form.date,
      vendor: form.vendor,
      amountCents: Math.round(Number(form.amountCents) * 100),
      category: form.category,
      notes: form.notes,
    });
    setForm({ date: '', vendor: '', amountCents: '', category: '', notes: '' });
    setIsCreating(false);
    load();
  };

  const handleSetDept = async (line: BudgetLine, dept: string) => {
    await api.setDepartment(line._id, dept);
    load();
  };

  const handleDelete = async (id: string) => {
    await api.delete(id);
    load();
  };

  // Group summary by month
  const monthGroups = summary.reduce<Record<string, BudgetSummary[]>>((acc, s) => {
    (acc[s._id.month] ||= []).push(s);
    return acc;
  }, {});

  return (
    <div className="budget-container">
      <div className="budget-toolbar">
        <h2>Budget</h2>
        <div className="budget-controls">
          <button className={`btn-tab ${view === 'lines' ? 'active' : ''}`} onClick={() => setView('lines')}>Lignes</button>
          <button className={`btn-tab ${view === 'summary' ? 'active' : ''}`} onClick={() => setView('summary')}>Résumé</button>
          <select value={filterDept} onChange={e => setFilterDept(e.target.value)}>
            <option value="">Tous départements</option>
            {DEPARTMENTS.filter(d => d).map(d => <option key={d} value={d}>{DEPT_LABELS[d]}</option>)}
          </select>
          <button className="btn-primary" onClick={() => setIsCreating(true)}>+ Ligne</button>
        </div>
      </div>

      {isCreating && (
        <div className="budget-form">
          <div className="form-row">
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            <input placeholder="Fournisseur *" value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} />
            <input placeholder="Montant (€) *" type="number" step="0.01" value={form.amountCents} onChange={e => setForm(f => ({ ...f, amountCents: e.target.value }))} />
          </div>
          <div className="form-row">
            <input placeholder="Catégorie" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
            <input placeholder="Notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="form-actions">
            <button className="btn-primary" onClick={handleCreate}>Créer</button>
            <button className="btn-secondary" onClick={() => setIsCreating(false)}>Annuler</button>
          </div>
        </div>
      )}

      {view === 'summary' && (
        <div className="budget-summary">
          {Object.entries(monthGroups).sort(([a], [b]) => b.localeCompare(a)).map(([month, items]) => {
            const total = items.reduce((s, i) => s + i.totalCents, 0);
            return (
              <div key={month} className="summary-month">
                <div className="summary-header">
                  <strong>{month}</strong>
                  <span className={`summary-total ${total < 0 ? 'negative' : ''}`}>{formatAmount(total)}</span>
                  <span className="summary-count">{items.reduce((s, i) => s + i.count, 0)} lignes</span>
                </div>
                <div className="summary-depts">
                  {items.map(i => (
                    <span key={i._id.department || 'none'} className="dept-chip">
                      {DEPT_LABELS[i._id.department] || 'Non classé'}: {formatAmount(i.totalCents)}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          {summary.length === 0 && <p className="empty">Aucune donnée</p>}
        </div>
      )}

      {view === 'lines' && (
        <div className="budget-lines">
          <table className="budget-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Fournisseur</th>
                <th>Catégorie</th>
                <th className="amount-col">Montant</th>
                <th>Département</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(line => (
                <tr key={line._id}>
                  <td>{line.date}</td>
                  <td>{line.vendor}</td>
                  <td>{line.category || '-'}</td>
                  <td className={`amount-col ${line.amountCents < 0 ? 'negative' : 'positive'}`}>{formatAmount(line.amountCents)}</td>
                  <td>
                    <select value={line.department} onChange={e => handleSetDept(line, e.target.value)} className="dept-select">
                      {DEPARTMENTS.map(d => <option key={d} value={d}>{DEPT_LABELS[d]}</option>)}
                    </select>
                  </td>
                  <td><button className="btn-small btn-danger" onClick={() => handleDelete(line._id)}>X</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {lines.length === 0 && <p className="empty">Aucune ligne de budget</p>}
        </div>
      )}
    </div>
  );
}
