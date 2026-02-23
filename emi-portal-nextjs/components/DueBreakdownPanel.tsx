'use client';

import { DueBreakdown } from '@/lib/types';
import { format } from 'date-fns';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(n);
}

export default function DueBreakdownPanel({ breakdown }: { breakdown: DueBreakdown }) {
  if (!breakdown || !breakdown.next_emi_no) return null;

  return (
    <div className="card p-5 border-l-4 border-brand-400 bg-brand-50/50">
      <p className="text-xs font-bold text-ink-muted uppercase tracking-widest mb-4">Next Payment Due</p>
      <div className="space-y-2.5">
        {(breakdown.selected_emi_amount ?? breakdown.next_emi_amount ?? 0) > 0 && (
          <Row label={`EMI #${breakdown.next_emi_no}`} value={fmt(breakdown.selected_emi_amount ?? breakdown.next_emi_amount ?? 0)} />
        )}
        {breakdown.first_emi_charge_due > 0 && (
          <Row label="1st EMI Charge ⭐" value={fmt(breakdown.first_emi_charge_due)} accent="warning" />
        )}
        {breakdown.fine_due > 0 && (
          <Row label="Late Fine ⚠️" value={fmt(breakdown.fine_due)} accent="danger" />
        )}
        <div className="h-px bg-surface-4 my-1" />
        <div className="flex justify-between items-center">
          <span className="font-bold text-ink text-base">Total Payable</span>
          <span className="num font-bold text-2xl text-brand-600">{fmt(breakdown.total_payable)}</span>
        </div>
        {breakdown.next_emi_due_date && (
          <p className={`text-xs mt-1 ${breakdown.is_overdue ? 'text-danger font-medium' : 'text-ink-muted'}`}>
            Due: {format(new Date(breakdown.next_emi_due_date), 'd MMMM yyyy')}
            {breakdown.is_overdue && ' — OVERDUE'}
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: 'warning' | 'danger' }) {
  const cls = accent === 'warning' ? 'text-warning' : accent === 'danger' ? 'text-danger' : 'text-ink';
  return (
    <div className="flex justify-between text-sm">
      <span className={accent ? cls : 'text-ink-muted'}>{label}</span>
      <span className={`num font-medium ${cls}`}>{value}</span>
    </div>
  );
}
