/**
 * @fileoverview Period-to-monthly-row expander.
 *
 * Replicates n8n nodes:
 *   - "Expand Periods to Monthly Rows" (expansion + deduplication + sort)
 *   - "Code in JavaScript" (numeric validation / re-emission of monthlyRent)
 *   - "Calculate Year and Month Numbers" (Month # and Year # assignment)
 *
 * Input:  normalised period rows from parser.js
 *         { periodStart: Date, periodEnd: Date, monthlyRent: number }[]
 *
 * Output: monthly rows ready for calculator.js
 *         { date: string, periodEnd: string|null, monthlyRent: number,
 *           year: number, 'Month #': number, 'Year #': number }[]
 *
 * No UI dependencies. All functions are pure.
 */

import {
  addMonthsAnchored,
  countMonthsInclusive,
  toISOLocal,
} from './yearMonth.js';

/**
 * Expand an array of period rows into individual monthly anchor rows.
 * Handles deduplication by date (Flaw 5 fix: warns rather than silently dropping).
 *
 * @param {{ periodStart: Date, periodEnd: Date, monthlyRent: number }[]} periodRows
 *   Parsed, normalised period rows from parser.js.
 * @returns {{
 *   rows: { date: string, periodEnd: string|null, monthlyRent: number, year: number, 'Month #': number, 'Year #': number }[],
 *   duplicateDates: string[]
 * }}
 *   rows           - Monthly rows sorted ascending by date, with sequence numbers assigned.
 *   duplicateDates - ISO date strings that appeared more than once (Flaw 5 surface).
 *   warnings       - Descriptions of dropped rows (never silently filtered).
 *
 * @n8nNode "Expand Periods to Monthly Rows" + "Code in JavaScript" + "Calculate Year and Month Numbers"
 */
export function expandPeriods(periodRows) {
  const rawMonthlyRecords = [];
  const warnings = [];

  for (let i = 0; i < periodRows.length; i++) {
    const { periodStart, periodEnd, monthlyRent } = periodRows[i];
    if (!periodStart || !periodEnd) {
      warnings.push(`Period row ${i + 1}: skipped — missing ${!periodStart ? 'start date' : 'end date'}.`);
      continue;
    }

    // Numeric validation — mirrors "Code in JavaScript" node
    const parsedRent = typeof monthlyRent === 'number' ? monthlyRent : parseFloat(String(monthlyRent));
    if (isNaN(parsedRent)) {
      warnings.push(`Period row ${i + 1}: skipped — rent "${monthlyRent}" is not a valid number.`);
      continue;
    }

    const nMonths = countMonthsInclusive(periodStart, periodEnd);

    for (let k = 0; k < nMonths; k++) {
      const anchorDate = addMonthsAnchored(periodStart, k);
      const isLast = k === nMonths - 1;

      rawMonthlyRecords.push({
        date: toISOLocal(anchorDate),
        // Pass the explicit period end only on the last row so the calculator
        // can determine whether the final month is a true partial month.
        periodEnd: isLast ? toISOLocal(periodEnd) : null,
        monthlyRent: parsedRent,
        year: anchorDate.getFullYear(),
      });
    }
  }

  // --- Flaw 5 fix: detect duplicate dates before deduplication ---
  const dateCount = new Map();
  for (const r of rawMonthlyRecords) {
    dateCount.set(r.date, (dateCount.get(r.date) ?? 0) + 1);
  }
  const duplicateDates = Array.from(dateCount.entries())
    .filter(([, count]) => count > 1)
    .map(([date]) => date);

  // Deduplicate by date (last-write wins, matching n8n Map behaviour)
  const byDate = new Map();
  for (const r of rawMonthlyRecords) {
    byDate.set(r.date, r);
  }

  // Sort ascending
  const sorted = Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  // --- "Calculate Year and Month Numbers" node: itemIndex-based counters ---
  const rows = sorted.map((r, idx) => ({
    ...r,
    'Month #': idx + 1,
    'Year #': Math.floor(idx / 12) + 1,
  }));

  return { rows, duplicateDates, warnings };
}
