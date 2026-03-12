/**
 * CLIENT-SIDE FINE CALCULATOR
 * Mirrors the DB function calculate_and_apply_fines()
 *
 * RULES (from master prompt):
 *   1. Base Fine: ₹450 applied on the day AFTER the EMI due date
 *   2. Weekly Escalation: +₹25 every 7 days within the same month
 *   3. Monthly Reset: After every 30 days, another ₹450 base fine + weekly cycle resets
 *
 * Formula: For N complete months overdue: 550 × N
 *   Month 1: 450 + (4 × 25) = 550
 *   Month 2: 550 + 550 = 1100
 *   Month 3: 550 + 550 + 550 = 1650
 *
 * Partial month examples (day 1 of being overdue):
 *   Day 1  → ₹450
 *   Day 7  → ₹475   (450 + 1×25)
 *   Day 14 → ₹500   (450 + 2×25)
 *   Day 21 → ₹525   (450 + 3×25)
 *   Day 28 → ₹550   (450 + 4×25)
 *   Day 31 → ₹1000  (550 + 450)  — new month, new base fine
 *   Day 37 → ₹1025  (550 + 475)
 *   Day 60 → ₹1100  (550 + 550)
 *   Day 61 → ₹1550  (1100 + 450) — month 3 starts
 */

import { EMISchedule } from './types';

const DEFAULT_BASE_FINE = 450;
const DEFAULT_WEEKLY_INCREMENT = 25;
const DAYS_PER_MONTH = 30;

/**
 * Calculate fine for a single overdue EMI with monthly reset
 */
export function calculateSingleEmiFine(
  dueDate: string,
  baseFine: number = DEFAULT_BASE_FINE,
  weeklyIncrement: number = DEFAULT_WEEKLY_INCREMENT,
): number {
  const due = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);

  if (today <= due) return 0;

  const daysOverdue = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  if (daysOverdue <= 0) return 0;

  // Monthly fine cycle: each 30-day period = baseFine + 4 weeks × weeklyIncrement
  const finePerMonth = baseFine + (4 * weeklyIncrement); // 450 + 100 = 550

  const completedMonths = Math.floor(daysOverdue / DAYS_PER_MONTH);
  const remainingDays = daysOverdue % DAYS_PER_MONTH;

  // Completed months: each full 30-day cycle = finePerMonth
  let total = completedMonths * finePerMonth;

  // Partial current month: base fine + weekly escalation
  if (remainingDays > 0) {
    const weeksInCurrent = Math.floor(remainingDays / 7);
    total += baseFine + (weeksInCurrent * weeklyIncrement);
  }

  return total;
}

/**
 * Get a detailed breakdown of fine for display
 */
export function getFineBreakdown(
  dueDate: string,
  baseFine: number = DEFAULT_BASE_FINE,
  weeklyIncrement: number = DEFAULT_WEEKLY_INCREMENT,
): { total: number; daysOverdue: number; completedMonths: number; weeksInCurrent: number; baseFineTotal: number; weeklyFineTotal: number } {
  const due = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);

  const daysOverdue = Math.max(0, Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
  if (daysOverdue <= 0) return { total: 0, daysOverdue: 0, completedMonths: 0, weeksInCurrent: 0, baseFineTotal: 0, weeklyFineTotal: 0 };

  const completedMonths = Math.floor(daysOverdue / DAYS_PER_MONTH);
  const remainingDays = daysOverdue % DAYS_PER_MONTH;
  const weeksInCurrent = remainingDays > 0 ? Math.floor(remainingDays / 7) : 0;

  const baseFineTotal = (completedMonths + (remainingDays > 0 ? 1 : 0)) * baseFine;
  const weeklyFineTotal = (completedMonths * 4 + weeksInCurrent) * weeklyIncrement;
  const total = baseFineTotal + weeklyFineTotal;

  return { total, daysOverdue, completedMonths, weeksInCurrent, baseFineTotal, weeklyFineTotal };
}

/**
 * Calculate total unpaid fine across all overdue UNPAID EMIs
 */
export function calculateTotalFineFromEmis(
  emis: EMISchedule[],
  baseFine: number = DEFAULT_BASE_FINE,
  weeklyIncrement: number = DEFAULT_WEEKLY_INCREMENT,
): number {
  let totalFine = 0;

  for (const emi of emis) {
    if (emi.status !== 'UNPAID') continue;
    if (emi.fine_waived) continue;

    const calculatedFine = calculateSingleEmiFine(emi.due_date, baseFine, weeklyIncrement);
    if (calculatedFine <= 0) continue;

    const effectiveFine = Math.max(calculatedFine, emi.fine_amount || 0);
    const alreadyPaid = emi.fine_paid_amount || 0;
    const remaining = Math.max(0, effectiveFine - alreadyPaid);

    totalFine += remaining;
  }

  return totalFine;
}

/**
 * Get per-EMI fine breakdown for display in Fine Summary panel
 */
export function getPerEmiFineBreakdown(
  emis: EMISchedule[],
  baseFine: number = DEFAULT_BASE_FINE,
  weeklyIncrement: number = DEFAULT_WEEKLY_INCREMENT,
): Array<{
  emi_no: number;
  due_date: string;
  daysOverdue: number;
  baseFineAmount: number;
  weeklyFineAmount: number;
  totalFine: number;
  finePaid: number;
  fineRemaining: number;
}> {
  const result = [];

  for (const emi of emis) {
    if (emi.status !== 'UNPAID') continue;
    if (emi.fine_waived) continue;

    const bd = getFineBreakdown(emi.due_date, baseFine, weeklyIncrement);
    if (bd.total <= 0) continue;

    const effectiveFine = Math.max(bd.total, emi.fine_amount || 0);
    const finePaid = emi.fine_paid_amount || 0;

    result.push({
      emi_no: emi.emi_no,
      due_date: emi.due_date,
      daysOverdue: bd.daysOverdue,
      baseFineAmount: bd.baseFineTotal,
      weeklyFineAmount: bd.weeklyFineTotal,
      totalFine: effectiveFine,
      finePaid,
      fineRemaining: Math.max(0, effectiveFine - finePaid),
    });
  }

  return result;
}
