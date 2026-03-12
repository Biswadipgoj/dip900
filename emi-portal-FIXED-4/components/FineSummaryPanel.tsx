'use client';

import { EMISchedule } from '@/lib/types';
import { getPerEmiFineBreakdown } from '@/lib/fineCalc';
import { format } from 'date-fns';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(n);
}

interface Props {
  emis: EMISchedule[];
  defaultFineAmount?: number;
  weeklyIncrement?: number;
  onClose: () => void;
}

export default function FineSummaryPanel({ emis, defaultFineAmount = 450, weeklyIncrement = 25, onClose }: Props) {
  const breakdown = getPerEmiFineBreakdown(emis, defaultFineAmount, weeklyIncrement);
  const totalFineRemaining = breakdown.reduce((s, r) => s + r.fineRemaining, 0);
  const totalFinePaid = breakdown.reduce((s, r) => s + r.finePaid, 0);

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-surface-4 px-5 py-4 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-ink text-lg">⚠️ Fine Summary</h2>
            <p className="text-ink-muted text-xs mt-0.5">Auto-calculated: ₹{defaultFineAmount} base + ₹{weeklyIncrement}/week + monthly reset</p>
          </div>
          <button onClick={onClose} className="btn-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {breakdown.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-success font-semibold text-lg">✓ No Fine Due</p>
              <p className="text-ink-muted text-sm mt-1">All EMIs are on time or fines are fully paid.</p>
            </div>
          ) : (
            <>
              {/* Total summary */}
              <div className="card bg-danger-light border border-danger-border p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-danger">Total Fine Remaining</span>
                  <span className="num text-2xl font-bold text-danger">{fmt(totalFineRemaining)}</span>
                </div>
                {totalFinePaid > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-ink-muted">Already Paid</span>
                    <span className="num text-success font-medium">{fmt(totalFinePaid)}</span>
                  </div>
                )}
              </div>

              {/* Per-EMI breakdown */}
              <p className="text-xs font-bold text-ink-muted uppercase tracking-widest">Per-EMI Fine Breakdown</p>
              <div className="space-y-3">
                {breakdown.map(row => (
                  <div key={row.emi_no} className="card bg-surface-2 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-semibold text-ink">EMI #{row.emi_no}</span>
                        <span className="text-xs text-ink-muted ml-2">Due: {format(new Date(row.due_date), 'd MMM yyyy')}</span>
                      </div>
                      <span className="text-xs text-danger font-semibold bg-danger-light px-2 py-0.5 rounded-full border border-danger-border">
                        {row.daysOverdue} days overdue
                      </span>
                    </div>

                    <div className="h-px bg-surface-4" />

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-ink-muted">Base Fine (₹{defaultFineAmount})</p>
                        <p className="num font-semibold text-ink">{fmt(row.baseFineAmount)}</p>
                      </div>
                      <div>
                        <p className="text-ink-muted">Weekly Extra (₹{weeklyIncrement}/wk)</p>
                        <p className="num font-semibold text-ink">{fmt(row.weeklyFineAmount)}</p>
                      </div>
                    </div>

                    <div className="h-px bg-surface-4" />

                    <div className="flex justify-between text-sm">
                      <span className="text-ink-muted">Total Fine</span>
                      <span className="num font-bold text-danger">{fmt(row.totalFine)}</span>
                    </div>
                    {row.finePaid > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-success">Already Paid</span>
                        <span className="num font-medium text-success">-{fmt(row.finePaid)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-semibold">
                      <span className="text-danger">Remaining</span>
                      <span className="num text-danger">{fmt(row.fineRemaining)}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Formula explanation */}
              <div className="card bg-surface-2 p-4">
                <p className="text-xs font-bold text-ink-muted uppercase tracking-widest mb-2">How Fine is Calculated</p>
                <div className="text-xs text-ink-muted space-y-1">
                  <p>• Base fine of <span className="font-semibold text-ink">₹{defaultFineAmount}</span> applied on the day after EMI due date</p>
                  <p>• <span className="font-semibold text-ink">₹{weeklyIncrement}</span> added every 7 days if fine remains unpaid</p>
                  <p>• After 30 days: new ₹{defaultFineAmount} cycle starts (monthly reset)</p>
                  <p>• Per month: ₹{defaultFineAmount} + (4 × ₹{weeklyIncrement}) = <span className="font-semibold text-ink">₹{defaultFineAmount + 4 * weeklyIncrement}/month</span></p>
                </div>
              </div>
            </>
          )}

          <button onClick={onClose} className="btn-secondary w-full py-3">Close</button>
        </div>
      </div>
    </div>
  );
}
