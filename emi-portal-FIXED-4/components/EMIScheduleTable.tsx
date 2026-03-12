'use client';

import { useState } from 'react';
import { EMISchedule } from '@/lib/types';
import { format, differenceInDays, addDays } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import toast from 'react-hot-toast';
import { calculateSingleEmiFine } from '@/lib/fineCalc';

interface Props {
  emis: EMISchedule[];
  isAdmin?: boolean;
  nextUnpaidNo?: number;
  onRefresh?: () => void;
  defaultFineAmount?: number;
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(n);
}

export default function EMIScheduleTable({ emis, isAdmin, nextUnpaidNo, onRefresh, defaultFineAmount = 450 }: Props) {
  const supabase = createClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fineOverride, setFineOverride] = useState('');
  const [dateOverride, setDateOverride] = useState('');
  const [saving, setSaving] = useState(false);

  const paidCount = emis.filter(e => e.status === 'APPROVED').length;

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
              const today = new Date();
              const dueDate = new Date(emi.due_date);
              const isOverdue = emi.status === 'UNPAID' && dueDate < today;
              const isNext = emi.emi_no === nextUnpaidNo;
              const editing = editingId === emi.id;

              // Fine: auto-calculate with monthly reset, show max(DB, calculated)
              const autoFine = isOverdue ? calculateSingleEmiFine(emi.due_date, defaultFineAmount) : 0;
              const displayFine = Math.max(autoFine, emi.fine_amount || 0);
              const finePaid = emi.fine_paid_amount || 0;
              const fineRemaining = Math.max(0, displayFine - finePaid);

              // Fine start date = due_date + 1 day
              const fineStartDate = addDays(dueDate, 1);
              const overdueDays = isOverdue ? differenceInDays(today, dueDate) : 0;

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
                      <div>
                        <span className={`num text-sm ${isOverdue ? 'text-danger font-medium' : ''}`}>
                          {format(dueDate, 'd MMM yyyy')}
                          {isOverdue && ' \u26A0'}
                        </span>
                        {isOverdue && (
                          <p className="text-[10px] text-danger mt-0.5">
                            Overdue by {overdueDays} day{overdueDays !== 1 ? 's' : ''}
                          </p>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="num font-medium">{fmt(emi.amount)}</td>
                  <td>
                    {editing ? (
                      <input type="number" value={fineOverride}
                        onChange={e => setFineOverride(e.target.value)}
                        placeholder={String(emi.fine_amount || 0)}
                        className="input py-1 px-2 text-xs w-24" />
                    ) : displayFine > 0 ? (
                      <div>
                        <span className="num text-xs font-semibold text-danger">{fmt(fineRemaining > 0 ? fineRemaining : displayFine)}</span>
                        {finePaid > 0 && (
                          <p className="text-[10px] text-success mt-0.5">Paid: {fmt(finePaid)}</p>
                        )}
                        {isOverdue && (
                          <p className="text-[10px] text-danger/70 mt-0.5">
                            From {format(fineStartDate, 'd MMM')}
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-ink-muted text-xs">{'\u2014'}</span>
                    )}
                  </td>
                  <td>
                    {emi.status === 'APPROVED' && <span className="badge-blue">{'\u2713'} Paid</span>}
                    {emi.status === 'PENDING_APPROVAL' && <span className="badge-yellow">{'\u23F3'} Pending</span>}
                    {emi.status === 'UNPAID' && <span className={`badge ${isOverdue ? 'badge-red' : 'badge-gray'}`}>{isOverdue ? 'Overdue' : 'Unpaid'}</span>}
                  </td>
                  <td className="num text-xs text-ink-muted">
                    {emi.paid_at ? format(new Date(emi.paid_at), 'd MMM yy') : '\u2014'}
                  </td>
                  <td className="text-xs text-ink-muted">{emi.mode || '\u2014'}</td>
                  {isAdmin && (
                    <td className="text-right">
                      {editing ? (
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => saveEdit(emi)} disabled={saving} className="btn-success text-xs px-2 py-1">
                            {saving ? '\u2026' : 'Save'}
                          </button>
                          <button onClick={() => setEditingId(null)} className="btn-secondary text-xs px-2 py-1">Cancel</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 justify-end">
                          {emi.status === 'UNPAID' && (
                            <button
                              onClick={() => { setEditingId(emi.id); setFineOverride(''); setDateOverride(''); }}
                              className="btn-ghost text-xs px-2 py-1"
                            >{'\u270F'}</button>
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
