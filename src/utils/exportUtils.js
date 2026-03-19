/**
 * @fileoverview Professional XLSX export with full formatting and live formulas.
 *
 * The column layout is now DYNAMIC — driven by the charge category registry
 * in chargeCategories.js. Columns only appear when a charge category has data.
 * Adding a new category requires only a registry entry; this file adapts automatically.
 *
 * Row layout — Lease Schedule tab:
 *   Row  1        : title (merged)
 *   Row  2        : subtitle (merged)
 *   Row  3        : generated date (merged)
 *   Row  4        : blank
 *   Rows 5–N      : assumptions block (dynamic, depends on active categories)
 *   Row  N+1      : blank separator
 *   Row  N+2      : column headers
 *   Row  N+3+     : monthly data rows
 *
 * Color conventions:
 *   Blue  (fcInput)     = hard-coded user inputs
 *   Black (fcCalc)      = formula outputs / engine-calculated values
 *   Green (fcCrossSheet)= cross-sheet formulas (Annual Summary)
 *   Navy  (fcTotal)     = totals row
 *   Red-pink fill       = NNN/obligation columns
 *   Amber fill          = abatement period rows
 */

import XLSX from 'xlsx-js-style';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import Papa from 'papaparse';
import {
  CHARGE_CATEGORIES,
  getActiveCategories,
  buildColumnLayout,
  colIndexToLetter,
} from '../engine/chargeCategories.js';

// ===========================================================================
// Colour palette
// ===========================================================================

const C = {
  headerNavy:   '1F3864',
  headerBlue:   '17375E',
  headerPurple: '3D1C6E',
  subheader:    'D6DCE4',
  totalBg:      'BDD7EE',
  amber:        'FFF2CC',
  rowEven:      'FFFFFF',
  rowOdd:       'DEEAF1',
  note:         'F2F2F2',
  white:        'FFFFFF',
  assumpLabel:  'EBF3FB',
  softRedPink:  'FFB6C1',

  fcInput:      '0000FF',   // blue  — hard-coded inputs
  fcCalc:       '000000',   // black — formula / calculated values
  fcCrossSheet: '375623',   // dark green — cross-sheet references
  fcTotal:      '1F3864',   // navy — totals row
};

// ===========================================================================
// Shared style building blocks
// ===========================================================================

const FONT    = { name: 'Calibri', sz: 11 };
const FONT_B  = { ...FONT, bold: true };
const FONT_SM = { ...FONT, sz: 10 };

const THIN_BORDER = {
  top:    { style: 'thin', color: { rgb: 'C8C8C8' } },
  bottom: { style: 'thin', color: { rgb: 'C8C8C8' } },
  left:   { style: 'thin', color: { rgb: 'C8C8C8' } },
  right:  { style: 'thin', color: { rgb: 'C8C8C8' } },
};

function hdrStyle(bg = C.headerNavy) {
  return {
    font:      { ...FONT_B, color: { rgb: C.white } },
    fill:      { patternType: 'solid', fgColor: { rgb: bg } },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    border: {
      top:    { style: 'thin',   color: { rgb: '000000' } },
      bottom: { style: 'medium', color: { rgb: '000000' } },
      left:   { style: 'thin',   color: { rgb: '000000' } },
      right:  { style: 'thin',   color: { rgb: '000000' } },
    },
  };
}

const TOTAL_BASE = {
  font:      { ...FONT_B, color: { rgb: C.fcTotal } },
  fill:      { patternType: 'solid', fgColor: { rgb: C.totalBg } },
  alignment: { horizontal: 'right', vertical: 'middle' },
  border: {
    top:    { style: 'double', color: { rgb: C.fcTotal } },
    bottom: { style: 'thin',   color: { rgb: C.fcTotal } },
    left:   { style: 'thin',   color: { rgb: 'C8C8C8' } },
    right:  { style: 'thin',   color: { rgb: 'C8C8C8' } },
  },
};

function ds(fill, numFmt, extra = {}) {
  let fontDef;
  if (extra.italic) {
    fontDef = { ...FONT_SM, italic: true, color: { rgb: '555555' } };
  } else {
    const base = extra.bold ? FONT_B : (extra.small ? FONT_SM : FONT);
    fontDef    = extra.fontColor
      ? { ...base, color: { rgb: extra.fontColor } }
      : base;
  }
  return {
    font:      fontDef,
    fill:      { patternType: 'solid', fgColor: { rgb: fill } },
    alignment: { horizontal: extra.align ?? 'right', vertical: 'middle', ...(extra.wrap ? { wrapText: true } : {}) },
    numFmt,
    border:    THIN_BORDER,
  };
}

// ===========================================================================
// Number formats
// ===========================================================================

const FMT = {
  date:     'mm/dd/yyyy',
  currency: '$#,##0.00',
  sf:       '$#,##0.0000',
  int:      '#,##0',
  pct:      '0.00%',
  factor:   '0.0000',
  text:     '@',
  otc:      '$#,##0.00;;"-"',
};

// ===========================================================================
// Low-level worksheet helpers
// ===========================================================================

function col(n) {
  let s = '';
  let i = n + 1;
  while (i > 0) {
    const r = (i - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

function a(c, r) { return `${col(c)}${r}`; }
function sc(ws, c, r, cell) { ws[a(c, r)] = cell; }
function setRef(ws, maxC, maxR) { ws['!ref'] = `A1:${col(maxC)}${maxR}`; }

function toSerial(isoStr) {
  if (!isoStr) return null;
  const p = isoStr.split('-');
  if (p.length !== 3) return null;
  const d     = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  const epoch = new Date(1899, 11, 30);
  return Math.round((d.getTime() - epoch.getTime()) / 86400000);
}

function parseOtcDateSerial(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d     = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  const epoch = new Date(1899, 11, 30);
  return Math.round((d.getTime() - epoch.getTime()) / 86400000);
}

// ===========================================================================
// Cell factories
// ===========================================================================

function cInput(v, fmt, fill, bold = false) {
  return { t: 'n', v: v ?? 0, s: ds(fill, fmt, { bold, fontColor: C.fcInput }) };
}

function cCalc(v, fmt, fill, bold = false) {
  return { t: 'n', v: v ?? 0, s: ds(fill, fmt, { bold, fontColor: C.fcCalc }) };
}

function cFmla(formula, fallback, fmt, fill, bold = false) {
  return { t: 'n', v: fallback ?? 0, f: formula, s: ds(fill, fmt, { bold, fontColor: C.fcCalc }) };
}

function cFmlaInput(formula, fallback, fmt, fill) {
  return { t: 'n', v: fallback ?? 0, f: formula, s: ds(fill, fmt, { fontColor: C.fcInput }) };
}

function cXSheet(formula, fallback, fmt, fill) {
  return { t: 'n', v: fallback ?? 0, f: formula, s: ds(fill, fmt, { fontColor: C.fcCrossSheet }) };
}

function cDate(isoStr, fill) {
  const serial = toSerial(isoStr);
  if (serial === null) {
    return { t: 's', v: isoStr ?? '', s: ds(fill, FMT.text, { align: 'center', fontColor: C.fcCalc }) };
  }
  return { t: 'n', v: serial, s: ds(fill, FMT.date, { align: 'center', fontColor: C.fcCalc }) };
}

function cInt(v, fill, bold = false, fontColor = C.fcCalc) {
  return { t: 'n', v: v ?? 0, s: ds(fill, FMT.int, { align: 'center', bold, fontColor }) };
}

function cText(v, fill, bold = false, align = 'left', fontColor = C.fcCalc) {
  return { t: 's', v: String(v ?? ''), s: ds(fill, FMT.text, { align, bold, fontColor }) };
}

function cHdr(label, bg) {
  return { t: 's', v: label, s: hdrStyle(bg) };
}

function cTotal(formula, fallback, numFmt) {
  return { t: 'n', v: fallback ?? 0, f: formula, s: { ...TOTAL_BASE, numFmt } };
}

function cTotalLabel(text) {
  return { t: 's', v: text, s: { ...TOTAL_BASE, alignment: { horizontal: 'left', vertical: 'middle' } } };
}

function cBlankTotal() {
  return { t: 's', v: '', s: TOTAL_BASE };
}

// ===========================================================================
// Assumptions computation
// ===========================================================================

function computeAssumptions(rows, params, activeCategories) {
  const nnnMode = params.nnnMode ?? 'individual';
  const isAgg   = nnnMode === 'aggregate';

  if (!rows || !rows.length) {
    const result = {
      leaseName: params.leaseName || '',
      nnnMode,
      squareFootage: 0, commencementDate: null, expirationDate: null,
      year1BaseRent: 0, annualEscRate: 0, anniversaryMonth: 1,
      fullAbatementMonths: 0, abatementPartialFactor: 1,
      categories: {},
    };
    if (isAgg) {
      result.nnnAggYear1 = 0;
      result.nnnAggEscRate = 0;
    }
    for (const cat of activeCategories) {
      result.categories[cat.key] = { year1: 0, escRate: 0 };
    }
    return result;
  }

  const firstRow = rows[0];
  const lastRow  = rows[rows.length - 1];
  const year1BaseRent = firstRow.scheduledBaseRent ?? 0;

  const year2Row = rows.find((r) => (r.leaseYear ?? r['Year #']) === 2);
  let annualEscRate = 0;
  if (year2Row && year1BaseRent > 0) {
    annualEscRate = (year2Row.scheduledBaseRent ?? 0) / year1BaseRent - 1;
  }

  const fullAbatementMonths    = rows.filter((r) => r.isAbatementRow).length;
  const boundaryRow            = rows.find((r) => r.prorationBasis === 'abatement-boundary');
  const abatementPartialFactor = boundaryRow
    ? (boundaryRow.baseRentProrationFactor ?? 1)
    : 1;

  const result = {
    leaseName:             String(params.leaseName || ''),
    nnnMode,
    squareFootage:         Number(params.squareFootage) || 0,
    commencementDate:      firstRow.periodStart ?? null,
    expirationDate:        lastRow.periodEnd    ?? null,
    year1BaseRent,
    annualEscRate,
    anniversaryMonth:      1,
    fullAbatementMonths,
    abatementPartialFactor,
    categories: {},
  };

  // In aggregate mode, store aggregate NNN values
  if (isAgg) {
    result.nnnAggYear1   = Number(params.nnnAggregate?.year1)  || 0;
    result.nnnAggEscRate = (Number(params.nnnAggregate?.escPct) || 0) / 100;
  }

  // Per-category assumption values
  for (const cat of activeCategories) {
    result.categories[cat.key] = {
      year1:   Number(params[cat.paramKey]?.year1)  || 0,
      escRate: (Number(params[cat.paramKey]?.escPct) || 0) / 100,
    };
  }

  return result;
}

// ===========================================================================
// Sheet 1 — Monthly Ledger
// ===========================================================================

// ---------------------------------------------------------------------------
// Title block (rows 1–3)
// ---------------------------------------------------------------------------

function buildTitleBlock(ws, filename, lastCol) {
  const titleName = (filename || 'Lease Schedule')
    .replace(/\.[^/.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());
  const title = `${titleName} — Obligation Analysis`;

  sc(ws, 0, 1, {
    t: 's', v: title,
    s: {
      font:      { name: 'Calibri', sz: 20, bold: true, color: { rgb: C.headerNavy } },
      fill:      { patternType: 'solid', fgColor: { rgb: 'DEEAF1' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      numFmt:    FMT.text,
    },
  });

  sc(ws, 0, 2, {
    t: 's', v: 'DEODATE Lease Schedule Engine — Full Obligation Analysis',
    s: {
      font:      { name: 'Calibri', sz: 11, italic: true, color: { rgb: '375623' } },
      fill:      { patternType: 'solid', fgColor: { rgb: C.assumpLabel } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      numFmt:    FMT.text,
    },
  });

  const today = new Date();
  const pad   = (n) => String(n).padStart(2, '0');
  sc(ws, 0, 3, {
    t: 's', v: `Generated: ${pad(today.getMonth() + 1)}/${pad(today.getDate())}/${today.getFullYear()}`,
    s: {
      font:      { name: 'Calibri', sz: 10, color: { rgb: '555555' } },
      fill:      { patternType: 'solid', fgColor: { rgb: C.note } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      numFmt:    FMT.text,
    },
  });

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: lastCol } },
  ];
}

// ---------------------------------------------------------------------------
// Dynamic assumption block writer
// Returns { lastRow, cellMap } where cellMap maps keys to '$C$N' addresses
// ---------------------------------------------------------------------------

function buildAssumptionsBlock(ws, assump, activeCategories) {
  const labelStyle = {
    font:      { ...FONT_B, color: { rgb: '1F3864' } },
    fill:      { patternType: 'solid', fgColor: { rgb: C.assumpLabel } },
    alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
    border: {
      top:    { style: 'thin', color: { rgb: 'B0B0B0' } },
      bottom: { style: 'thin', color: { rgb: 'B0B0B0' } },
      left:   { style: 'thin', color: { rgb: 'B0B0B0' } },
      right:  { style: 'thin', color: { rgb: 'B0B0B0' } },
    },
    numFmt: FMT.text,
  };

  const vFill = C.white;
  const assumpBorder = {
    top:    { style: 'thin', color: { rgb: 'B0B0B0' } },
    bottom: { style: 'thin', color: { rgb: 'B0B0B0' } },
    left:   { style: 'thin', color: { rgb: 'B0B0B0' } },
    right:  { style: 'thin', color: { rgb: 'B0B0B0' } },
  };
  const row = (r, label, cell) => {
    sc(ws, 1, r, { t: 's', v: label, s: labelStyle });
    sc(ws, 2, r, { ...cell, s: { ...cell.s, border: assumpBorder } });
  };

  const cellMap = {};
  let r = 5; // start at row 5

  // Fixed assumptions (always present)
  row(r, 'Rentable SF', cInput(assump.squareFootage, FMT.int, vFill));
  cellMap.squareFootage = `$C$${r}`;
  r++;

  row(r, 'Lease Commencement Date', cDate(assump.commencementDate, vFill));
  cellMap.commencementDate = `$C$${r}`;
  r++;

  row(r, 'Lease Expiration Date', cDate(assump.expirationDate, vFill));
  cellMap.expirationDate = `$C$${r}`;
  r++;

  row(r, 'Year 1 Monthly Base Rent', cInput(assump.year1BaseRent, FMT.currency, vFill));
  cellMap.year1BaseRent = `$C$${r}`;
  r++;

  row(r, 'Annual Base Rent Escalation Rate (%)', cInput(assump.annualEscRate, FMT.pct, vFill));
  cellMap.annualEscRate = `$C$${r}`;
  r++;

  row(r, 'Lease Anniversary Month', cInput(assump.anniversaryMonth, FMT.int, vFill));
  cellMap.anniversaryMonth = `$C$${r}`;
  r++;

  row(r, 'Abatement Full-Month Count', cInput(assump.fullAbatementMonths, FMT.int, vFill));
  cellMap.abatementMonths = `$C$${r}`;
  r++;

  row(r, 'Abatement Partial-Month Proration Factor', cInput(assump.abatementPartialFactor, FMT.factor, vFill));
  cellMap.abatementPartialFactor = `$C$${r}`;
  r++;

  // NNN aggregate assumptions (if aggregate mode)
  if (assump.nnnMode === 'aggregate') {
    row(r, 'NNN Combined Year 1 Monthly Amount', cInput(assump.nnnAggYear1 ?? 0, FMT.currency, vFill));
    cellMap.nnnAgg_year1 = `$C$${r}`;
    r++;
    row(r, 'NNN Combined Annual Escalation Rate (%)', cInput(assump.nnnAggEscRate ?? 0, FMT.pct, vFill));
    cellMap.nnnAgg_escRate = `$C$${r}`;
    r++;
  }

  // Per-category assumptions (only for active categories)
  for (const cat of activeCategories) {
    const catData = assump.categories[cat.key] ?? { year1: 0, escRate: 0 };
    row(r, cat.assumptionLabels.year1, cInput(catData.year1, FMT.currency, vFill));
    cellMap[`${cat.key}_year1`] = `$C$${r}`;
    r++;
    row(r, cat.assumptionLabels.escRate, cInput(catData.escRate, FMT.pct, vFill));
    cellMap[`${cat.key}_escRate`] = `$C$${r}`;
    r++;
  }

  return { lastRow: r - 1, cellMap };
}

// ---------------------------------------------------------------------------
// Main ledger builder
// ---------------------------------------------------------------------------

function buildLedger(rows, assump, otLabels, columns, activeCategories, cellMap, headerRow, firstDataRow, filename) {
  const ws = {};

  const LAST_COL = columns[columns.length - 1].index;
  const FDR      = firstDataRow;
  const HDR      = headerRow;
  const lastData = FDR + rows.length - 1;
  const totRow   = lastData + 1;
  const noteRow  = totRow + 2;

  // Build lookup maps from column layout
  const colByKey = {};
  for (const c of columns) colByKey[c.key] = c;

  const nnnCols         = columns.filter((c) => c.group === 'nnn');
  const otherChargeCols = columns.filter((c) => c.group === 'otherCharge');
  const otCols          = columns.filter((c) => c.group === 'oneTime');

  const sumRng = (ci) => `SUM(${col(ci)}${FDR}:${col(ci)}${lastData})`;

  // ── Title block ────────────────────────────────────────────────────────
  buildTitleBlock(ws, filename, LAST_COL);

  // ── Assumptions block ──────────────────────────────────────────────────
  buildAssumptionsBlock(ws, assump, activeCategories);

  // ── Header row ─────────────────────────────────────────────────────────
  columns.forEach((c) => sc(ws, c.index, HDR, cHdr(c.header, C.headerNavy)));

  // ── Data rows ──────────────────────────────────────────────────────────
  rows.forEach((row, idx) => {
    const r = FDR + idx;

    const rowFill = row.isAbatementRow
      ? C.amber
      : idx % 2 === 0 ? C.rowEven : C.rowOdd;
    const nnnFill = C.softRedPink;

    const lm = row.leaseMonth ?? row['Month #'] ?? 0;
    const ly = row.leaseYear  ?? row['Year #']  ?? 0;

    // Fixed prefix columns
    sc(ws, colByKey.periodStart.index, r, cDate(row.periodStart, rowFill));
    sc(ws, colByKey.periodEnd.index,   r, cDate(row.periodEnd,   rowFill));
    sc(ws, colByKey.monthNum.index,    r, cInt(lm, rowFill, false, C.fcCalc));
    sc(ws, colByKey.yearNum.index,     r, cInt(ly, rowFill, false, C.fcCalc));

    const yearCol = colByKey.yearNum.letter;

    // Scheduled Base Rent: formula referencing assumption cells
    sc(ws, colByKey.scheduledBaseRent.index, r, cFmla(
      `${cellMap.year1BaseRent}*(1+${cellMap.annualEscRate})^(${yearCol}${r}-1)`,
      row.scheduledBaseRent ?? 0,
      FMT.currency,
      rowFill,
    ));

    // Base Rent Applied: abatement formula
    const monthCol = colByKey.monthNum.letter;
    const sbrCol   = colByKey.scheduledBaseRent.letter;
    sc(ws, colByKey.baseRentApplied.index, r, cFmla(
      `IF(${monthCol}${r}<=${cellMap.abatementMonths},0,IF(${monthCol}${r}=${cellMap.abatementMonths}+1,${sbrCol}${r}*${cellMap.abatementPartialFactor},${sbrCol}${r}))`,
      row.baseRentApplied ?? 0,
      FMT.currency,
      nnnFill,
    ));

    // NNN charge columns
    if (assump.nnnMode === 'aggregate' && colByKey.nnnAggregate) {
      // Single aggregate NNN column
      sc(ws, colByKey.nnnAggregate.index, r, cFmla(
        `${cellMap.nnnAgg_year1}*(1+${cellMap.nnnAgg_escRate})^(${yearCol}${r}-1)`,
        row.nnnAggregateAmount ?? 0,
        FMT.currency,
        nnnFill,
      ));
    } else {
      // Individual NNN columns
      for (const nnnCol of nnnCols) {
        const cat = nnnCol.catDef;
        if (!cat) continue;
        const y1Cell  = cellMap[`${cat.key}_year1`];
        const escCell = cellMap[`${cat.key}_escRate`];
        sc(ws, nnnCol.index, r, cFmla(
          `${y1Cell}*(1+${escCell})^(${yearCol}${r}-1)`,
          row[cat.amountField] ?? 0,
          FMT.currency,
          nnnFill,
        ));
      }
    }

    // Other Charge columns (security, otherItems, etc.)
    for (const ocCol of otherChargeCols) {
      const cat = ocCol.catDef;
      if (!cat) continue;
      const y1Cell  = cellMap[`${cat.key}_year1`];
      const escCell = cellMap[`${cat.key}_escRate`];
      sc(ws, ocCol.index, r, cFmla(
        `${y1Cell}*(1+${escCell})^(${yearCol}${r}-1)`,
        row[cat.amountField] ?? 0,
        FMT.currency,
        nnnFill,
      ));
    }

    // Total NNN: sum of all NNN group columns
    const totalNNNCol = colByKey.totalNNN;
    if (nnnCols.length > 0) {
      const nnnFormula = nnnCols.map((c) => `${c.letter}${r}`).join('+');
      const nnnFallback = nnnCols.reduce((sum, c) => {
        if (c.catDef) return sum + (row[c.catDef.amountField] ?? 0);
        // aggregate column
        return sum + (row.nnnAggregateAmount ?? 0);
      }, 0);
      sc(ws, totalNNNCol.index, r, cFmla(nnnFormula, nnnFallback, FMT.currency, nnnFill));
    } else {
      sc(ws, totalNNNCol.index, r, cCalc(0, FMT.currency, nnnFill));
    }

    // One-time item columns
    const otAmounts = row.oneTimeItemAmounts ?? {};
    for (const otCol of otCols) {
      const amt = Number(otAmounts[otCol.otLabel] ?? 0);
      sc(ws, otCol.index, r, cInput(amt, FMT.currency, rowFill));
    }

    // Total Monthly Obligation: Base Rent Applied + Total NNN + Other Charges + OT
    const tmCol = colByKey.totalMonthly;
    const baseRentLetter = colByKey.baseRentApplied.letter;
    const totalNNNLetter = totalNNNCol.letter;
    const otherTerms = otherChargeCols.map((c) => `+${c.letter}${r}`).join('');
    const otTerms    = otCols.map((c) => `+${c.letter}${r}`).join('');
    sc(ws, tmCol.index, r, cFmla(
      `${baseRentLetter}${r}+${totalNNNLetter}${r}${otherTerms}${otTerms}`,
      row.totalMonthlyObligation ?? 0,
      FMT.currency,
      rowFill,
    ));

    // Effective $/SF
    const tmLetter = tmCol.letter;
    sc(ws, colByKey.effSF.index, r, cFmla(
      `IF(${cellMap.squareFootage}=0,0,${tmLetter}${r}/${cellMap.squareFootage})`,
      row.effectivePerSF ?? 0,
      FMT.sf,
      rowFill,
    ));

    // Remaining balances
    sc(ws, colByKey.obligRem.index, r, cFmla(
      `SUM(${tmLetter}${r}:${tmLetter}${lastData})`,
      row.totalObligationRemaining ?? 0,
      FMT.currency,
      rowFill,
    ));

    sc(ws, colByKey.baseRem.index, r, cFmla(
      `SUM(${baseRentLetter}${r}:${baseRentLetter}${lastData})`,
      row.totalBaseRentRemaining ?? 0,
      FMT.currency,
      rowFill,
    ));

    sc(ws, colByKey.nnnRem.index, r, cFmla(
      `SUM(${totalNNNLetter}${r}:${totalNNNLetter}${lastData})`,
      row.totalNNNRemaining ?? 0,
      FMT.currency,
      rowFill,
    ));

    // Other Charges Remaining = future Other Charge cols + future OT cols
    const otherChargesSumParts = [
      ...otherChargeCols.map((c) => `SUM(${c.letter}${r}:${c.letter}${lastData})`),
      ...otCols.map((c) => `SUM(${c.letter}${r}:${c.letter}${lastData})`),
    ];
    sc(ws, colByKey.otherRem.index, r, cFmla(
      otherChargesSumParts.length > 0 ? otherChargesSumParts.join('+') : '0',
      row.totalOtherChargesRemaining ?? 0,
      FMT.currency,
      rowFill,
    ));
  });

  // ── Totals row ──────────────────────────────────────────────────────────
  sc(ws, 0, totRow, cTotalLabel('TOTAL'));
  // Blank cells for non-summable fixed columns
  for (let ci = 1; ci <= 3; ci++) sc(ws, ci, totRow, cBlankTotal());

  // Sum for every column from scheduledBaseRent through all charge/OT columns
  const summableCols = columns.filter((c) =>
    c.group !== 'fixed' || c.key === 'scheduledBaseRent' || c.key === 'baseRentApplied'
  );
  for (const c of summableCols) {
    if (c.key === 'periodStart' || c.key === 'periodEnd' || c.key === 'monthNum' || c.key === 'yearNum') continue;
    if (c.key === 'effSF' || c.key === 'obligRem' || c.key === 'baseRem' || c.key === 'nnnRem' || c.key === 'otherRem') {
      sc(ws, c.index, totRow, cBlankTotal());
    } else {
      sc(ws, c.index, totRow, cTotal(sumRng(c.index), 0, FMT.currency));
    }
  }

  // ── Footnotes ───────────────────────────────────────────────────────────
  const noteStyle = {
    font:      { ...FONT_SM, italic: true, color: { rgb: '555555' } },
    fill:      { patternType: 'solid', fgColor: { rgb: C.note } },
    alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
    numFmt:    FMT.text,
  };

  const tmColName   = `col ${colByKey.totalMonthly.letter}`;
  const nnnColLabel = colByKey.totalNNN.letter;
  const nnnColNames = nnnCols.map((c) => `${c.header} (${c.letter})`).join(' + ');
  const otherColNames = otherChargeCols.map((c) => `${c.header} (${c.letter})`).join(' + ');

  const notes = [
    `\u2460 Total NNN (col ${nnnColLabel}) = ${nnnColNames || 'N/A'}. Other Charges (${otherColNames || 'none'}) are NOT included in NNN.`,
    `\u2461 Total Monthly Obligation (${tmColName}) = Base Rent Applied + Total NNN + Other Charges${otCols.length > 0 ? ' + one-time charge columns (blue)' : ''}.`,
    `\u2462 Remaining: Obligation = SUM of future Total Monthly Obligation. Base Rent / NNN / Other Charges = tail-sums of their respective columns.`,
    `\u2463 NNN escalation: Year 1 Monthly Amounts in assumption cells are compounded annually by their escalation rates. Charge columns are live formulas \u2014 edit assumptions to recalculate.`,
    `\u2464 Color guide: Blue text = direct user inputs (incl. one-time charge event cells) | Black text = formula outputs | Red-pink fill = NNN/obligation columns | Amber rows = abatement periods.`,
  ];
  notes.forEach((txt, i) => {
    sc(ws, 0, noteRow + i, { t: 's', v: txt, s: noteStyle });
  });

  // ── Sheet metadata ──────────────────────────────────────────────────────
  ws['!cols'] = columns.map((c) => ({ wch: c.width }));

  const assumpRowCount = assump.nnnMode === 'aggregate'
    ? 8 + 2 + activeCategories.length * 2  // fixed + aggregate pair + category pairs
    : 8 + activeCategories.length * 2;     // fixed + category pairs
  ws['!rows'] = [
    { hpt: 36 },                                          // row 1 — title
    { hpt: 16 },                                          // row 2 — subtitle
    { hpt: 14 },                                          // row 3 — generated date
    {},                                                    // row 4 — blank
    ...Array(assumpRowCount).fill({ hpt: 18 }),           // assumption rows
    {},                                                    // blank separator
    { hpt: 44 },                                           // header
  ];

  ws['!views']      = [{ state: 'frozen', xSplit: 4, ySplit: HDR }];
  ws['!autofilter'] = { ref: `A${HDR}:${col(LAST_COL)}${HDR}` };

  setRef(ws, LAST_COL, noteRow + 4);
  return ws;
}

// ===========================================================================
// Sheet 2 — Annual Summary
// ===========================================================================

const SUMMARY_HEADERS = [
  'Period Start', 'Period End', 'Lease Year', 'Months',
  'Base Rent Applied', 'Total NNN',
  'Total Monthly Obligation', '% of Grand Total',
];

function buildAnnualSummary(rows, columns, firstDataRow) {
  const ws = {};
  const years = [...new Set(
    rows.map((r) => r.leaseYear ?? r['Year #']).filter(Boolean)
  )].sort((a, b) => a - b);

  const firstLedger = firstDataRow;
  const lastLedger  = firstDataRow + rows.length - 1;

  // Find column letters from the layout
  const colByKey = {};
  for (const c of columns) colByKey[c.key] = c;

  const yearColLetter     = colByKey.yearNum.letter;
  const baseRentLetter    = colByKey.baseRentApplied.letter;
  const totalNNNLetter    = colByKey.totalNNN.letter;
  const totalMonthlyLetter = colByKey.totalMonthly.letter;

  const LS   = "'Lease Schedule'";
  const Dabs = `${LS}!$${yearColLetter}$${firstLedger}:$${yearColLetter}$${lastLedger}`;
  const Fabs = `${LS}!$${baseRentLetter}$${firstLedger}:$${baseRentLetter}$${lastLedger}`;
  const Labs = `${LS}!$${totalNNNLetter}$${firstLedger}:$${totalNNNLetter}$${lastLedger}`;
  const Nabs = `${LS}!$${totalMonthlyLetter}$${firstLedger}:$${totalMonthlyLetter}$${lastLedger}`;

  // Build year → {start, end} date map and month count from row data
  const yearDateMap    = {};
  const yearMonthCount = {};
  for (const row of rows) {
    const y = row.leaseYear ?? row['Year #'];
    if (!y) continue;
    if (!yearDateMap[y]) yearDateMap[y] = { start: row.periodStart, end: row.periodEnd };
    else yearDateMap[y].end = row.periodEnd;
    yearMonthCount[y] = (yearMonthCount[y] || 0) + 1;
  }

  SUMMARY_HEADERS.forEach((h, ci) => sc(ws, ci, 1, cHdr(h, C.headerBlue)));

  const totGref = `G${years.length + 2}`;

  years.forEach((year, idx) => {
    const r       = idx + 2;
    const fill    = idx % 2 === 0 ? C.rowEven : C.rowOdd;
    const dates   = yearDateMap[year] ?? {};
    const Cr      = `C${r}`;

    sc(ws, 0, r, cDate(dates.start, fill));
    sc(ws, 1, r, cDate(dates.end, fill));
    sc(ws, 2, r, cInt(year, fill, false, C.fcInput));
    sc(ws, 3, r, cXSheet(`COUNTIF(${Dabs},${Cr})`,                 12, FMT.int,      fill));
    sc(ws, 4, r, cXSheet(`SUMIF(${Dabs},${Cr},${Fabs})`,            0, FMT.currency, fill));
    sc(ws, 5, r, cXSheet(`SUMIF(${Dabs},${Cr},${Labs})`,            0, FMT.currency, fill));
    sc(ws, 6, r, cXSheet(`SUMIF(${Dabs},${Cr},${Nabs})`,            0, FMT.currency, fill));
    sc(ws, 7, r, cFmla(`IF(${totGref}=0,0,G${r}/${totGref})`,      0, FMT.pct,      fill));
  });

  const totRow  = years.length + 2;
  const lastRow = totRow - 1;
  const gsum    = (letter) => `SUM(${letter}2:${letter}${lastRow})`;

  sc(ws, 0, totRow, cTotalLabel('GRAND TOTAL'));
  sc(ws, 1, totRow, cBlankTotal());
  sc(ws, 2, totRow, cBlankTotal());
  sc(ws, 3, totRow, cTotal(gsum('D'), 0, FMT.int));
  sc(ws, 4, totRow, cTotal(gsum('E'), 0, FMT.currency));
  sc(ws, 5, totRow, cTotal(gsum('F'), 0, FMT.currency));
  sc(ws, 6, totRow, cTotal(gsum('G'), 0, FMT.currency));
  sc(ws, 7, totRow, { t: 's', v: '100.0%', s: TOTAL_BASE });

  ws['!cols']  = [{ wch: 13 }, { wch: 13 }, { wch: 16 }, { wch: 9 }, { wch: 22 }, { wch: 16 }, { wch: 26 }, { wch: 16 }];
  ws['!rows']  = [{ hpt: 40 }];
  ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
  setRef(ws, 7, totRow);
  return ws;
}

// ===========================================================================
// Sheet 3 — Audit Trail
// ===========================================================================

function buildAuditTrail(rows, activeCategories) {
  const ws = {};

  // Build dynamic headers: fixed prefix + 2 columns per active category
  const fixedHeaders = [
    'Period Start', 'Month #',
    'Period Factor', 'Proration Factor', 'Proration Basis',
  ];
  const catHeaders = [];
  const catWidths  = [];
  for (const cat of activeCategories) {
    const shortLabel = cat.displayLabel.length > 5
      ? cat.displayLabel.substring(0, 5)
      : cat.displayLabel;
    catHeaders.push(`${shortLabel} Esc Year`, `${shortLabel} Active`);
    catWidths.push(13, 11);
  }
  const headers = [...fixedHeaders, ...catHeaders];
  const widths  = [13, 9, 14, 16, 20, ...catWidths];

  headers.forEach((h, ci) => sc(ws, ci, 1, cHdr(h, C.headerPurple)));

  rows.forEach((row, idx) => {
    const r    = idx + 2;
    const fill = idx % 2 === 0 ? C.rowEven : C.rowOdd;

    sc(ws, 0, r, cDate(row.periodStart, fill));
    sc(ws, 1, r, cInt(row.leaseMonth ?? row['Month #'] ?? 0, fill, false, C.fcInput));
    sc(ws, 2, r, cInput(row.periodFactor            ?? 1, FMT.factor, fill));
    sc(ws, 3, r, cInput(row.baseRentProrationFactor ?? 1, FMT.factor, fill));
    sc(ws, 4, r, cText(row.prorationBasis ?? '', fill, false, 'center', C.fcInput));

    let ci = 5;
    for (const cat of activeCategories) {
      sc(ws, ci,     r, cInt(row[cat.escYearsField] ?? 0, fill, false, C.fcInput));
      sc(ws, ci + 1, r, cText(String(row[cat.activeField] ?? ''), fill, false, 'center', C.fcInput));
      ci += 2;
    }
  });

  ws['!cols']  = widths.map((w) => ({ wch: w }));
  ws['!rows']  = [{ hpt: 40 }];
  ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
  setRef(ws, headers.length - 1, rows.length + 1);
  return ws;
}

// ===========================================================================
// Public exports
// ===========================================================================

export function exportToXLSX(rows, params = {}, filename = 'lease-schedule') {
  const wb = XLSX.utils.book_new();
  wb.Props = {
    Title:       'Lease Schedule',
    Author:      'DEODATE Lease Schedule Engine',
    CreatedDate: new Date(),
  };

  const nnnMode = params.nnnMode ?? 'individual';

  // Determine which charge categories are active based on data and params
  const activeCategories = getActiveCategories(rows, params, nnnMode);

  // Compute assumption values
  const assump = computeAssumptions(rows, params, activeCategories);

  // Derive OT labels from processed rows (authoritative source)
  const seenLabels = new Set();
  const otLabels = [];
  for (const row of rows) {
    for (const [lbl, amt] of Object.entries(row.oneTimeItemAmounts ?? {})) {
      if (amt > 0 && !seenLabels.has(lbl)) {
        seenLabels.add(lbl);
        otLabels.push(lbl);
      }
    }
  }

  // Build dynamic column layout
  const columns = buildColumnLayout(activeCategories, otLabels, nnnMode);

  // Compute dynamic row positions based on assumptions block size
  const dummyWs = {};
  const { lastRow: assumpLastRow, cellMap } = buildAssumptionsBlock(dummyWs, assump, activeCategories);
  const headerRow    = assumpLastRow + 2;  // 1 blank separator row
  const firstDataRow = headerRow + 1;

  // Build sheets
  XLSX.utils.book_append_sheet(
    wb,
    buildLedger(rows, assump, otLabels, columns, activeCategories, cellMap, headerRow, firstDataRow, filename),
    'Lease Schedule',
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildAnnualSummary(rows, columns, firstDataRow),
    'Annual Summary',
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildAuditTrail(rows, activeCategories),
    'Audit Trail',
  );

  const xlsxBytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

  // Unzip the XLSX package to inject data validation
  const unzipped = unzipSync(new Uint8Array(xlsxBytes));

  const sheetKey = 'xl/worksheets/sheet1.xml';
  if (unzipped[sheetKey]) {
    let xml = strFromU8(unzipped[sheetKey]);
    const lastDataRow = firstDataRow + rows.length - 1;
    const dvXml =
      `<dataValidations count="1">` +
      `<dataValidation type="list" sqref="I5" showDropDown="0" ` +
      `showErrorMessage="0" showInputMessage="0">` +
      `<formula1>$A${firstDataRow}:$A${lastDataRow}</formula1>` +
      `</dataValidation></dataValidations>`;
    if (xml.includes('<ignoredErrors')) {
      xml = xml.replace('<ignoredErrors', dvXml + '<ignoredErrors');
    } else {
      xml = xml.replace('</worksheet>', dvXml + '</worksheet>');
    }
    unzipped[sheetKey] = strToU8(xml);
  }

  // Rezip and trigger download
  const rezipped = zipSync(unzipped);
  const blob = new Blob([rezipped], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `${filename}.xlsx`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportToCSV(rows, params = {}, filename = 'lease-schedule') {
  const nnnMode = params.nnnMode ?? 'individual';
  const activeCategories = getActiveCategories(rows, params, nnnMode);

  // Build dynamic CSV columns
  const baseCols = [
    { key: 'periodStart',              label: 'Period Start' },
    { key: 'periodEnd',                label: 'Period End' },
    { key: 'leaseYear',                label: 'Lease Year #' },
    { key: 'leaseMonth',               label: 'Lease Month #' },
    { key: 'scheduledBaseRent',        label: 'Scheduled Base Rent ($)' },
    { key: 'baseRentApplied',          label: 'Base Rent Applied ($)' },
  ];

  // NNN columns based on mode
  const nnnCsvCols = [];
  if (nnnMode === 'aggregate') {
    nnnCsvCols.push({ key: 'nnnAggregateAmount', label: 'NNN Combined ($)' });
  } else {
    for (const cat of activeCategories.filter((c) => c.group === 'nnn')) {
      nnnCsvCols.push({ key: cat.amountField, label: `${cat.displayLabel} ($)` });
    }
  }

  // Other charge columns
  const otherCsvCols = activeCategories
    .filter((c) => c.group === 'otherCharge')
    .map((cat) => ({ key: cat.amountField, label: `${cat.displayLabel} ($)` }));

  const tailCols = [
    { key: 'oneTimeChargesAmount',       label: 'One-time Charges ($)' },
    { key: 'totalMonthlyObligation',     label: 'Total Monthly Obligation ($)' },
    { key: 'effectivePerSF',             label: 'Effective $/SF' },
    { key: 'totalObligationRemaining',   label: 'Total Obligation Remaining ($)' },
    { key: 'totalBaseRentRemaining',     label: 'Base Rent Remaining ($)' },
    { key: 'totalNNNRemaining',          label: 'NNN Remaining ($)' },
    { key: 'totalOtherChargesRemaining', label: 'Other Charges Remaining ($)' },
  ];

  const COLS = [...baseCols, ...nnnCsvCols, ...otherCsvCols, ...tailCols];

  const data = rows.map((row) => {
    const obj = {};
    for (const c of COLS) obj[c.label] = row[c.key] ?? '';
    return obj;
  });

  const csv  = Papa.unparse(data);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
