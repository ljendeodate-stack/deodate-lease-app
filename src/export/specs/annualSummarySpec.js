/**
 * @fileoverview Declarative spec for Sheet 2 — Annual Summary.
 *
 * Cross-sheet SUMIF/COUNTIF formulas reference the Lease Schedule tab.
 */

import { C, FMT, TOTAL_BASE, ds, hdrStyle } from './styleTokens.js';
import { colLetter } from '../engine/registry.js';

const SUMMARY_HEADERS = [
  'Period Start', 'Period End', 'Lease Year', 'Months',
  'Base Rent Applied', 'Total NNN',
  'Total Monthly Obligation', '% of Grand Total',
];

/**
 * Build the Annual Summary sheet spec.
 *
 * @param {object[]} rows        — processed data rows
 * @param {number}   chargeCount — number of charges
 * @param {number}   otCount     — number of one-time item columns
 * @param {object}   L           — layout from computeLayout()
 * @returns {object} sheet spec
 */
export function buildAnnualSummarySpec(rows, chargeCount, otCount, L) {
  const years = [...new Set(
    rows.map((r) => r.leaseYear ?? r['Year #']).filter(Boolean)
  )].sort((a, b) => a - b);

  const firstLedger = L.FIRST_DATA_ROW;
  const lastLedger  = L.FIRST_DATA_ROW + rows.length - 1;

  const totalMonthlyLetter = colLetter(L.TOTAL_MONTHLY);
  const nnnLetter          = colLetter(L.TOTAL_NNN_COL);

  const LS       = "'Lease Schedule'";
  const Dabs     = `${LS}!$D$${firstLedger}:$D$${lastLedger}`;
  const Fabs     = `${LS}!$F$${firstLedger}:$F$${lastLedger}`;
  const Nabs_nnn = `${LS}!$${nnnLetter}$${firstLedger}:$${nnnLetter}$${lastLedger}`;
  const Nabs     = `${LS}!$${totalMonthlyLetter}$${firstLedger}:$${totalMonthlyLetter}$${lastLedger}`;

  const yearDateMap    = {};
  const yearMonthCount = {};
  for (const row of rows) {
    const y = row.leaseYear ?? row['Year #'];
    if (!y) continue;
    if (!yearDateMap[y]) yearDateMap[y] = { start: row.periodStart, end: row.periodEnd };
    else yearDateMap[y].end = row.periodEnd;
    yearMonthCount[y] = (yearMonthCount[y] || 0) + 1;
  }

  const totRow = years.length + 2;
  const cells  = [];

  // Header row (row 1)
  SUMMARY_HEADERS.forEach((h, ci) => {
    cells.push({ col: ci, row: 1, cell: { t: 's', v: h, s: hdrStyleLocal(C.headerBlue) } });
  });

  // Data rows
  years.forEach((year, idx) => {
    const r    = idx + 2;
    const fill = idx % 2 === 0 ? C.rowEven : C.rowOdd;
    const dates = yearDateMap[year] ?? {};

    cells.push({ col: 0, row: r, cell: dateCell(dates.start ?? null, fill) });
    cells.push({ col: 1, row: r, cell: dateCell(dates.end ?? null, fill) });
    cells.push({ col: 2, row: r, cell: intCell(year, fill, C.fcInput) });
    cells.push({ col: 3, row: r, cell: xSheetCell(`COUNTIF(${Dabs},C${r})`,          12, FMT.int,      fill) });
    cells.push({ col: 4, row: r, cell: xSheetCell(`SUMIF(${Dabs},C${r},${Fabs})`,     0, FMT.currency, fill) });
    cells.push({ col: 5, row: r, cell: xSheetCell(`SUMIF(${Dabs},C${r},${Nabs_nnn})`, 0, FMT.currency, fill) });
    cells.push({ col: 6, row: r, cell: xSheetCell(`SUMIF(${Dabs},C${r},${Nabs})`,     0, FMT.currency, fill) });
    cells.push({ col: 7, row: r, cell: fmlaCell(`IF(G${totRow}=0,0,G${r}/G${totRow})`, 0, FMT.pct, fill) });
  });

  // Totals row
  const lastRow = totRow - 1;
  const gsum    = (letter) => `SUM(${letter}2:${letter}${lastRow})`;
  const TB      = totalBaseStyle();
  const TBL     = { ...TB, alignment: { horizontal: 'left', vertical: 'middle' } };

  cells.push({ col: 0, row: totRow, cell: { t: 's', v: 'GRAND TOTAL', s: TBL } });
  cells.push({ col: 1, row: totRow, cell: { t: 's', v: '', s: TB } });
  cells.push({ col: 2, row: totRow, cell: { t: 's', v: '', s: TB } });
  cells.push({ col: 3, row: totRow, cell: { t: 'n', v: 0, f: gsum('D'), s: { ...TB, numFmt: FMT.int } } });
  cells.push({ col: 4, row: totRow, cell: { t: 'n', v: 0, f: gsum('E'), s: { ...TB, numFmt: FMT.currency } } });
  cells.push({ col: 5, row: totRow, cell: { t: 'n', v: 0, f: gsum('F'), s: { ...TB, numFmt: FMT.currency } } });
  cells.push({ col: 6, row: totRow, cell: { t: 'n', v: 0, f: gsum('G'), s: { ...TB, numFmt: FMT.currency } } });
  cells.push({ col: 7, row: totRow, cell: { t: 's', v: '100.0%', s: TB } });

  return {
    sheetName: 'Annual Summary',
    lastCol: 7,
    lastRow: totRow,
    frozenPane: { ySplit: 1 },
    colWidths: [13, 13, 16, 9, 22, 16, 26, 16],
    rowHeights: [{ hpt: 40 }],
    sections: { main: { cells } },
  };
}

// ── Inline cell helpers ─────────────────────────────────────────────────────

function hdrStyleLocal(bg) {
  return hdrStyle(bg);
}

function dsLocal(fill, numFmt, extra = {}) {
  return ds(fill, numFmt, extra);
}

function dateCell(isoStr, fill) {
  if (!isoStr) {
    return { t: 's', v: '', s: dsLocal(fill, FMT.text, { align: 'center', fontColor: C.fcCalc }) };
  }
  const p = isoStr.split('-');
  if (p.length !== 3) {
    return { t: 's', v: isoStr, s: dsLocal(fill, FMT.text, { align: 'center', fontColor: C.fcCalc }) };
  }
  const d     = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  const epoch = new Date(1899, 11, 30);
  const serial = Math.round((d.getTime() - epoch.getTime()) / 86400000);
  return { t: 'n', v: serial, s: dsLocal(fill, FMT.date, { align: 'center', fontColor: C.fcCalc }) };
}

function intCell(v, fill, fontColor = C.fcCalc) {
  return { t: 'n', v: v ?? 0, s: dsLocal(fill, FMT.int, { align: 'center', fontColor }) };
}

function xSheetCell(formula, fallback, fmt, fill) {
  return { t: 'n', v: fallback ?? 0, f: formula, s: dsLocal(fill, fmt, { fontColor: C.fcCrossSheet }) };
}

function fmlaCell(formula, fallback, fmt, fill) {
  return { t: 'n', v: fallback ?? 0, f: formula, s: dsLocal(fill, fmt, { fontColor: C.fcCalc }) };
}

function totalBaseStyle() {
  return TOTAL_BASE;
}
