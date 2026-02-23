'use client';

import { useState, useEffect } from 'react';
import { Customer, EMISchedule, DueBreakdown } from '@/lib/types';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';

interface PaymentModalProps {
  customer: Customer;
  emis: EMISchedule[];
  breakdown: DueBreakdown;
  onClose: () => void;
  onSubmitted: () => void;
  isAdmin?: boolean;
}

const UPI_ID = 'biswajit.khanra82@axl';
const UPI_NAME = 'TelePoint';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(n);
}

export default function PaymentModal({ customer, emis, breakdown, onClose, onSubmitted, isAdmin }: PaymentModalProps) {
  const router = useRouter();
  const unpaidEmis = emis.filter(e => e.status === 'UNPAID');
  const defaultEmiNo = breakdown.next_emi_no ?? unpaidEmis[0]?.emi_no;

  const [selectedEmiNo, setSelectedEmiNo] = useState<number>(defaultEmiNo ?? 0);
  const [mode, setMode] = useState<'CASH' | 'UPI'>('CASH');
  const [retailerPin, setRetailerPin] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [showReceipt, setShowReceipt] = useState(false);
  const [receiptId, setReceiptId] = useState('');

  const selectedEmi = unpaidEmis.find(e => e.emi_no === selectedEmiNo);
  const emiAmount = selectedEmi?.amount ?? 0;
  const fineAmount = breakdown.fine_due;
  const firstEmiCharge = breakdown.first_emi_charge_due;
  const totalPayable = emiAmount + fineAmount + firstEmiCharge;

  // Generate QR when UPI selected — uses correct UPI ID
  useEffect(() => {
    if (mode === 'UPI' && totalPayable > 0) {
      import('qrcode').then(QRCode => {
        const tn = `EMI${selectedEmiNo}_${customer.imei.slice(-6)}`;
        const upiStr = `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(UPI_NAME)}&am=${totalPayable}&tn=${tn}&cu=INR`;
        QRCode.toDataURL(upiStr, { width: 240, margin: 2, color: { dark: '#1e293b', light: '#ffffff' } })
          .then(setQrDataUrl);
      }).catch(() => {});
    } else {
      setQrDataUrl('');
    }
  }, [mode, totalPayable, selectedEmiNo, customer.imei]);

  async function handleSubmit() {
    if (!selectedEmi) { toast.error('Select an EMI to pay'); return; }
    if (!isAdmin && !retailerPin.trim()) { toast.error('Retailer PIN required'); return; }

    setLoading(true);
    try {
      const endpoint = isAdmin ? '/api/payments/approve-direct' : '/api/payments/submit';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customer.id,
          emi_ids: [selectedEmi.id],
          emi_nos: [selectedEmi.emi_no],
          mode,
          notes: notes || null,
          retail_pin: isAdmin ? undefined : retailerPin,
          total_emi_amount: emiAmount,
          fine_amount: fineAmount,
          first_emi_charge_amount: firstEmiCharge,
          total_amount: totalPayable,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to process payment');
      } else {
        toast.success(isAdmin ? '✅ Payment recorded & approved!' : '📋 Payment request submitted — pending approval');
        // Store receipt ID for navigation
        if (data.request_id) {
          setReceiptId(data.request_id);
          setShowReceipt(true);
        } else {
          onSubmitted();
          onClose();
        }
      }
    } finally {
      setLoading(false);
    }
  }

  // Receipt screen shown after successful payment
  if (showReceipt && receiptId) {
    const now = new Date();
    return (
      <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) { onSubmitted(); onClose(); } }}>
        <div className="modal-panel max-w-sm mx-auto animate-scale-in">
          {/* Receipt header */}
          <div className="bg-brand-500 px-6 py-5 text-center">
            <div className="text-4xl mb-2">{isAdmin ? '✅' : '📋'}</div>
            <h2 className="text-ink font-bold text-xl font-display">
              {isAdmin ? 'Payment Approved' : 'Request Submitted'}
            </h2>
            <p className="text-brand-200 text-sm mt-1">
              {isAdmin ? 'Payment recorded successfully' : 'Awaiting admin approval'}
            </p>
          </div>

          {/* Receipt body */}
          <div className="p-6 space-y-3">
            <div className="card bg-surface-2 p-4 space-y-2.5">
              <Row label="Customer" value={customer.customer_name} bold />
              <Row label="IMEI" value={customer.imei} mono />
              <Row label="Mobile" value={customer.mobile} mono />
              {customer.model_no && <Row label="Model" value={customer.model_no} />}
              <div className="divider !my-2" />
              <Row label={`EMI #${selectedEmiNo}`} value={fmt(emiAmount)} bold />
              {firstEmiCharge > 0 && <Row label="1st EMI Charge" value={fmt(firstEmiCharge)} />}
              {fineAmount > 0 && <Row label="Late Fine" value={fmt(fineAmount)} danger />}
              <div className="divider !my-2" />
              <div className="flex justify-between items-center">
                <span className="font-bold text-ink text-base">Total Paid</span>
                <span className="font-mono font-bold text-xl text-brand-600">{fmt(totalPayable)}</span>
              </div>
              <Row label="Mode" value={mode} />
              <Row label="Date & Time" value={format(now, 'd MMM yyyy, h:mm a')} mono />
              <Row label="Ref #" value={receiptId.slice(0, 8).toUpperCase()} mono />
            </div>

            {/* Share receipt on WhatsApp */}
            <button
              onClick={() => {
                const msg = [
                  `🧾 *TelePoint EMI Receipt*`,
                  ``,
                  `👤 ${customer.customer_name}`,
                  `📱 ${customer.mobile}`,
                  `📦 ${customer.model_no || 'Device'}`,
                  `🔢 IMEI: ${customer.imei}`,
                  ``,
                  `💳 EMI #${selectedEmiNo}: ${fmt(emiAmount)}`,
                  ...(firstEmiCharge > 0 ? [`⭐ 1st EMI Charge: ${fmt(firstEmiCharge)}`] : []),
                  ...(fineAmount > 0 ? [`⚠️ Fine: ${fmt(fineAmount)}`] : []),
                  `💰 *Total Paid: ${fmt(totalPayable)}*`,
                  `🏷️ Mode: ${mode}`,
                  `📅 ${format(now, 'd MMM yyyy, h:mm a')}`,
                  ...(isAdmin ? [] : [`⏳ Status: Pending Approval`]),
                  ``,
                  `— TelePoint EMI Portal`,
                ].join('\n');
                window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
              }}
              className="btn w-full py-3 bg-green-500 hover:bg-green-600 text-white"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              Share Receipt on WhatsApp
            </button>

            {/* View full receipt */}
            <button
              onClick={() => { window.open(`/receipt/${receiptId}`, '_blank'); }}
              className="btn-secondary w-full py-2.5"
            >
              🧾 View / Print Full Receipt
            </button>

            <button onClick={() => { onSubmitted(); onClose(); }} className="btn-ghost w-full py-2.5">
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Main payment modal
  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-surface-4 px-5 py-4 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-ink text-lg">{isAdmin ? 'Record Payment' : 'Submit Payment'}</h2>
            <p className="text-ink-muted text-xs mt-0.5">{customer.customer_name} · {customer.imei}</p>
          </div>
          <button onClick={onClose} className="btn-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Alerts */}
          {breakdown.popup_first_emi_charge && (
            <div className="alert-warning flex items-start gap-3">
              <span className="text-xl mt-0.5">⭐</span>
              <div>
                <p className="font-semibold text-warning text-sm">1st EMI Charge Pending</p>
                <p className="text-warning/70 text-xs mt-0.5">{fmt(firstEmiCharge)} will be added to total</p>
              </div>
            </div>
          )}
          {breakdown.popup_fine_due && (
            <div className="alert-danger flex items-start gap-3">
              <span className="text-xl mt-0.5">⚠️</span>
              <div>
                <p className="font-semibold text-danger text-sm">Late Fine: {fmt(fineAmount)}</p>
                <p className="text-danger/70 text-xs mt-0.5">EMI overdue — fine applies</p>
              </div>
            </div>
          )}

          {/* EMI selector */}
          <div>
            <label className="label">Select EMI to Pay *</label>
            {unpaidEmis.length === 0 ? (
              <div className="alert-success text-center py-4">
                <p className="text-success font-semibold">✓ All EMIs are paid or pending approval</p>
              </div>
            ) : (
              <div className="space-y-2">
                {unpaidEmis.map(emi => {
                  const isNext = emi.emi_no === breakdown.next_emi_no;
                  const isOverdue = new Date(emi.due_date) < new Date();
                  const sel = selectedEmiNo === emi.emi_no;
                  return (
                    <button
                      key={emi.id}
                      type="button"
                      onClick={() => setSelectedEmiNo(emi.emi_no)}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 text-left transition-all ${
                        sel ? 'border-brand-400 bg-brand-50' : 'border-surface-4 hover:border-brand-300 hover:bg-surface-2'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          sel ? 'bg-brand-500 border-brand-500' : 'border-surface-4'
                        }`}>
                          {sel && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5"><path d="M20 6L9 17l-5-5"/></svg>}
                        </div>
                        <div>
                          <span className={`text-sm font-semibold ${sel ? 'text-brand-700' : 'text-ink'}`}>EMI #{emi.emi_no}</span>
                          {isNext && <span className="ml-2 text-[10px] bg-success-light text-success border border-success-border px-1.5 py-0.5 rounded-full font-bold">NEXT DUE</span>}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="num text-sm font-semibold text-ink">{fmt(emi.amount)}</p>
                        <p className={`text-xs ${isOverdue ? 'text-danger font-medium' : 'text-ink-muted'}`}>
                          {format(new Date(emi.due_date), 'd MMM yyyy')}{isOverdue && ' ⚠'}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Mode selector */}
          <div>
            <label className="label">Payment Mode</label>
            <div className="flex gap-2">
              {(['CASH', 'UPI'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                    mode === m
                      ? m === 'CASH'
                        ? 'border-success bg-success-light text-success'
                        : 'border-info bg-info-light text-info'
                      : 'border-surface-4 text-ink-muted hover:border-surface-3'
                  }`}
                >
                  {m === 'CASH' ? '💵 Cash' : '📱 UPI'}
                </button>
              ))}
            </div>
          </div>

          {/* UPI QR Code */}
          {mode === 'UPI' && (
            <div className="card bg-surface-2 p-4">
              {qrDataUrl ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="bg-white p-3 rounded-xl shadow-sm border border-surface-4">
                    <img src={qrDataUrl} alt="UPI QR" className="w-48 h-48" />
                  </div>
                  <div className="text-center">
                    <p className="num font-bold text-xl text-ink">{fmt(totalPayable)}</p>
                    <p className="text-xs text-ink-muted mt-1">UPI ID: <span className="num font-semibold text-ink">{UPI_ID}</span></p>
                    <p className="text-xs text-ink-muted">{UPI_NAME}</p>
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(UPI_ID).then(() => toast.success('UPI ID copied!'))}
                    className="btn-secondary text-xs px-3 py-1.5"
                  >
                    Copy UPI ID
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-center h-24 text-ink-muted text-sm">
                  <svg className="animate-spin mr-2" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity="0.25"/><path d="M12 2a10 10 0 010 20"/></svg>
                  Generating QR code…
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="label">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Any notes about this payment…" className="input resize-none" />
          </div>

          {/* Retail PIN */}
          {!isAdmin && (
            <div>
              <label className="label">Retail PIN *</label>
              <input type="password" value={retailerPin} onChange={e => setRetailerPin(e.target.value)}
                placeholder="Enter your 4–6 digit Retail PIN" inputMode="numeric"
                className="input" autoComplete="off" />
              <p className="text-xs text-ink-muted mt-1">Separate from your login password</p>
            </div>
          )}

          {/* Breakdown */}
          <div className="card bg-surface-2 p-4 space-y-2.5">
            <p className="text-xs font-bold text-ink-muted uppercase tracking-widest mb-3">Payment Summary</p>
            {emiAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-ink-muted">EMI #{selectedEmiNo}</span>
                <span className="num font-medium text-ink">{fmt(emiAmount)}</span>
              </div>
            )}
            {firstEmiCharge > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-warning">1st EMI Charge</span>
                <span className="num font-medium text-warning">{fmt(firstEmiCharge)}</span>
              </div>
            )}
            {fineAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-danger">Late Fine</span>
                <span className="num font-medium text-danger">{fmt(fineAmount)}</span>
              </div>
            )}
            <div className="h-px bg-surface-4" />
            <div className="flex items-center justify-between">
              <span className="font-bold text-ink">Total Payable</span>
              <span className="num text-2xl font-bold text-brand-600">{fmt(totalPayable)}</span>
            </div>
            <p className="text-[11px] text-ink-muted">
              {isAdmin ? '→ Will be instantly approved' : '→ Sent to admin for approval'}
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pb-1">
            <button onClick={onClose} className="btn-secondary flex-1 py-3">Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={loading || !selectedEmi || unpaidEmis.length === 0}
              className="btn-primary flex-1 py-3"
            >
              {loading ? 'Processing…' : isAdmin ? '✓ Record Payment' : '→ Submit Request'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold, mono, danger }: { label: string; value: string; bold?: boolean; mono?: boolean; danger?: boolean }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-ink-muted">{label}</span>
      <span className={`${bold ? 'font-semibold' : ''} ${mono ? 'num' : ''} ${danger ? 'text-danger' : 'text-ink'}`}>{value}</span>
    </div>
  );
}
