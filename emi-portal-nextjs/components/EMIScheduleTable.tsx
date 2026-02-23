'use client';

import { useState } from 'react';
import { EMISchedule } from '@/lib/types';
import { format } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import toast from 'react-hot-toast';

interface Props {
  emis: EMISchedule[];
  isAdmin?: boolean;
  nextUnpaidNo?: number;   // accepted but used only for highlighting — optional
  onRefresh?: () => void;
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(n);
}

export default function EMIScheduleTable({ emis, isAdmin, nextUnpaidNo, onRefresh }: Props) {
  const supabase = createClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fineOverride, setFineOverride] = useState('');
  const [dateOverride, setDateOverride] = useState('');
  const [saving, setSaving] = useState(false);

  const paidCount = emis.filter(e => e.status === 'APPROVED').length;

  async function waiveFine(emi: EMISchedule) {
    const { error } = await supabase
      .from('emi_schedule')
      .update({ fine_amount: 0, fine_waived: true })
      .eq('id', emi.id);
    if (error) toast.error(error.message);
    else { toast.success('Fine waived'); onRefresh?.(); }
  }

  async function saveEdit(emi: EMISchedule) {
    setSaving(true);
    const updates: Record<string, unknown> = {};
    if (fineOverride !== '') updates.fine_amount = parseFloat(fineOverride) || 0;
    if (dateOverride !== '') updates.due_date = dateOverride;
    const { error } = await supabase.from('emi_schedule').update(updates).eq('id', emi.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success('EMI updated'); setEditingId(null); onRefresh?.(); }
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-surface-4 bg-surface-2">
        <p className="text-xs font-bold text-ink-muted uppercase tracking-widest">EMI Schedule</p>
        <div className="flex gap-2 text-xs">
          <span className="badge-green">{paidCount} paid</span>
          <span className="badge-gray">{emis.length} total</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>Due Date</th>
              <th>Amount</th>
              <th>Fine</th>
              <th>Status</th>
              <th>Paid On</th>
              <th>Mode</th>
              {isAdmin && <th className="text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {emis.map(emi => {
              const isOverdue = emi.status === 'UNPAID' && new Date(emi.due_date) < new Date();
              const isNext = emi.emi_no === nextUnpaidNo;
              const editing = editingId === emi.id;
              return (
                <tr key={emi.id} className={isOverdue ? 'bg-danger-light/30' : isNext ? 'bg-brand-50/50' : ''}>
                  <td className="font-semibold text-ink">
                    #{emi.emi_no}
                    {isNext && <span className="ml-1 text-[9px] bg-success-light text-success border border-success-border px-1 py-0.5 rounded-full">NEXT</span>}
                  </td>
                  <td>
                    {editing ? (
                      <input type="date" value={dateOverride || emi.due_date}
                        onChange={e => setDateOverride(e.target.value)}
                        className="input py-1 px-2 text-xs w-36" />
                    ) : (
                      <span className={`num text-sm ${isOverdue ? 'text-danger font-medium' : ''}`}>
                        {format(new Date(emi.due_date), 'd MMM yyyy')}
                        {isOverdue && ' ⚠'}
                      </span>
                    )}
                  </td>
                  <td className="num font-medium">{fmt(emi.amount)}</td>
                  <td>
                    {editing ? (
                      <input type="number" value={fineOverride}
                        onChange={e => setFineOverride(e.target.value)}
                        placeholder={String(emi.fine_amount || 0)}
                        className="input py-1 px-2 text-xs w-24" />
                    ) : (
                      (emi.fine_amount ?? 0) > 0
                        ? <span className={`num text-xs font-semibold ${emi.fine_waived ? 'line-through text-ink-muted' : 'text-danger'}`}>{fmt(emi.fine_amount)}</span>
                        : <span className="text-ink-muted text-xs">—</span>
                    )}
                  </td>
                  <td>
                    {emi.status === 'APPROVED' && <span className="badge-blue">✓ Paid</span>}
                    {emi.status === 'PENDING_APPROVAL' && <span className="badge-yellow">⏳ Pending</span>}
                    {emi.status === 'UNPAID' && <span className={`badge ${isOverdue ? 'badge-red' : 'badge-gray'}`}>{isOverdue ? 'Overdue' : 'Unpaid'}</span>}
                  </td>
                  <td className="num text-xs text-ink-muted">
                    {emi.paid_at ? format(new Date(emi.paid_at), 'd MMM yy') : '—'}
                  </td>
                  <td className="text-xs text-ink-muted">{emi.mode || '—'}</td>
                  {isAdmin && (
                    <td className="text-right">
                      {editing ? (
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => saveEdit(emi)} disabled={saving} className="btn-success text-xs px-2 py-1">
                            {saving ? '…' : 'Save'}
                          </button>
                          <button onClick={() => setEditingId(null)} className="btn-secondary text-xs px-2 py-1">Cancel</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 justify-end">
                          {emi.status === 'UNPAID' && (
                            <>
                              <button
                                onClick={() => { setEditingId(emi.id); setFineOverride(''); setDateOverride(''); }}
                                className="btn-ghost text-xs px-2 py-1"
                              >✏</button>
                              {(emi.fine_amount ?? 0) > 0 && !emi.fine_waived && (
                                <button onClick={() => waiveFine(emi)} className="btn-secondary text-xs px-2 py-1">Waive Fine</button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
