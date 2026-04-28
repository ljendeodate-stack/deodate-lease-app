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
import { renderLeaseScheduleWorksheet } from '../export/builders/renderLeaseScheduleWorksheet.js';
import { renderSheet } from '../export/engine/sheetWriter.js';
import { buildExportModel } from '../export/model/buildExportModel.js';
import { resolveLeaseScheduleLayout } from '../export/resolvers/resolveLeaseScheduleLayout.js';
import { buildAnnualSummarySpec } from '../export/specs/annualSummarySpec.js';
import { buildAuditTrailSpec } from '../export/specs/auditTrailSpec.js';
import { buildLegacyLeaseScheduleSpec } from '../export/specs/legacyLeaseScheduleSpec.js';
import {
  C as THEME_C,
  DEODATE_THEME as THEME_DEF,
  emphasisLabelStyle as themeEmphasisLabelStyle,
  emphasisValueStyle as themeEmphasisValueStyle,
  metadataStyle as themeMetadataStyle,
  panelDashStyle as themePanelDashStyle,
  panelInputStyle as themePanelInputStyle,
  panelLabelStyle as themePanelLabelStyle,
  panelSectionStyle as themePanelSectionStyle,
  panelTierStyle as themePanelTierStyle,
  panelTitleFillStyle as themePanelTitleFillStyle,
  panelValueStyle as themePanelValueStyle,
  scenarioSheetTitleStyle as themeScenarioSheetTitleStyle,
  subtitleCellStyle as themeSubtitleCellStyle,
  titleCellStyle as themeTitleCellStyle,
} from '../export/specs/styleTokens.js';
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
  headerNavy: THEME_C.headerNavy,
  headerBlue: THEME_C.headerBlue,
  headerPurple: THEME_C.headerPurple,
  subheader: THEME_C.subheader,
  totalBg: THEME_C.totalBg,
  amber: THEME_C.amber,
  rowEven: THEME_C.rowEven,
  rowOdd: THEME_C.rowOdd,
  note: THEME_C.note,
  white: THEME_C.white,
  assumpLabel: THEME_C.assumpLabel,
  softRedPink: THEME_C.softRedPink,

  fcInput:      '0000FF',   // blue  — hard-coded inputs
  fcCalc:       '000000',   // black — formula / calculated values
  fcCrossSheet: '375623',   // dark green — cross-sheet references
  fcTotal:      '1F3864',   // navy — totals row
};

C.inputFill = THEME_C.inputFill;
C.fcInput = THEME_C.fcInput;
C.fcCalc = THEME_C.fcCalc;
C.fcCrossSheet = THEME_C.fcCrossSheet;
C.fcTotal = THEME_C.fcTotal;
C.savingsFill = THEME_C.savingsFill;
C.savingsText = THEME_C.savingsText;
C.obligFill = THEME_C.obligFill;
C.obligText = THEME_C.obligText;

// ===========================================================================
// Shared style building blocks
// ===========================================================================

const FONT    = { name: 'Calibri', sz: 11 };
const FONT_B  = { ...FONT, bold: true };
const FONT_SM = { ...FONT, sz: 10 };

FONT.name = THEME_DEF.fonts.body;
FONT_B.name = THEME_DEF.fonts.body;
FONT_SM.name = THEME_DEF.fonts.body;

const THIN_BORDER = {
  top:    { style: 'thin', color: { rgb: 'C8C8C8' } },
  bottom: { style: 'thin', color: { rgb: 'C8C8C8' } },
  left:   { style: 'thin', color: { rgb: 'C8C8C8' } },
  right:  { style: 'thin', color: { rgb: 'C8C8C8' } },
};

const PANEL_BORDER = {
  top:    { style: 'medium', color: { rgb: '1F3864' } },
  bottom: { style: 'medium', color: { rgb: '1F3864' } },
  left:   { style: 'medium', color: { rgb: '1F3864' } },
  right:  { style: 'medium', color: { rgb: '1F3864' } },
};

Object.values(THIN_BORDER).forEach((edge) => { edge.color.rgb = THEME_C.border; });
Object.values(PANEL_BORDER).forEach((edge) => { edge.color.rgb = THEME_C.border; });

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

function toUint8Array(xlsxBytes) {
  if (xlsxBytes instanceof Uint8Array) return xlsxBytes;
  if (xlsxBytes instanceof ArrayBuffer) return new Uint8Array(xlsxBytes);
  return new Uint8Array(xlsxBytes);
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

    // Period factor: proration for partial first/last months.
    // Evaluates to 1 for full calendar months; fractional for boundary months.
    const psCol  = colByKey.periodStart.letter;
    const peCol  = colByKey.periodEnd.letter;
    const pfExpr = `IF(${peCol}${r}>=EDATE(${psCol}${r},1)-1,1,MAX(0,(${peCol}${r}-${psCol}${r}+1)/DAY(EOMONTH(${peCol}${r},0))))`;

    // Scheduled Base Rent: formula referencing assumption cells
    sc(ws, colByKey.scheduledBaseRent.index, r, cFmla(
      `${cellMap.year1BaseRent}*(1+${cellMap.annualEscRate})^(${yearCol}${r}-1)`,
      row.scheduledBaseRent ?? 0,
      FMT.currency,
      rowFill,
    ));

    const freeRentMonthRange = '$H$20:$H$29';
    const abatementMonthRange = '$H$6:$H$15';
    const abatementAmountRange = '$I$6:$I$15';

    // Base Rent Applied: dynamic concession tables drive free-rent and abatement math.
    const monthCol = colByKey.monthNum.letter;
    const sbrCol   = colByKey.scheduledBaseRent.letter;
    sc(ws, colByKey.baseRentApplied.index, r, cFmla(
      `IF(COUNTIF(${freeRentMonthRange},${monthCol}${r})>0,0,MAX(0,${sbrCol}${r}-SUMIF(${abatementMonthRange},${monthCol}${r},${abatementAmountRange})))*${pfExpr}`,
      row.baseRentApplied ?? 0,
      FMT.currency,
      nnnFill,
    ));

    // NNN charge columns
    if (assump.nnnMode === 'aggregate' && colByKey.nnnAggregate) {
      // Single aggregate NNN column
      sc(ws, colByKey.nnnAggregate.index, r, cFmla(
        `(${cellMap.nnnAgg_year1}*(1+${cellMap.nnnAgg_escRate})^(${yearCol}${r}-1))*${pfExpr}`,
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
          `(${y1Cell}*(1+${escCell})^(${yearCol}${r}-1))*${pfExpr}`,
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
        `(${y1Cell}*(1+${escCell})^(${yearCol}${r}-1))*${pfExpr}`,
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
    'Concession Type', 'Concession Trigger', 'Concession Detail', 'Concession Amount',
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
  const widths  = [13, 9, 14, 16, 20, 16, 16, 28, 16, ...catWidths];

  headers.forEach((h, ci) => sc(ws, ci, 1, cHdr(h, C.headerPurple)));

  rows.forEach((row, idx) => {
    const r    = idx + 2;
    const fill = idx % 2 === 0 ? C.rowEven : C.rowOdd;

    sc(ws, 0, r, cDate(row.periodStart, fill));
    sc(ws, 1, r, cInt(row.leaseMonth ?? row['Month #'] ?? 0, fill, false, C.fcInput));
    sc(ws, 2, r, cInput(row.periodFactor            ?? 1, FMT.factor, fill));
    sc(ws, 3, r, cInput(row.baseRentProrationFactor ?? 1, FMT.factor, fill));
    sc(ws, 4, r, cText(row.prorationBasis ?? '', fill, false, 'center', C.fcInput));
    sc(ws, 5, r, cText(row.concessionType ?? '', fill, false, 'center', C.fcInput));
    sc(ws, 6, r, cText(row.concessionTriggerDate ?? row.concessionEndDate ?? '', fill, false, 'center', C.fcInput));
    sc(
      ws,
      7,
      r,
      cText(
        row.concessionLabel
          ?? row.concessionAssumptionNote
          ?? (
            row.concessionStartDate || row.concessionEndDate
              ? `${row.concessionStartDate ?? ''}${row.concessionEndDate ? ` -> ${row.concessionEndDate}` : ''}`
              : ''
          ),
        fill,
        false,
        'left',
        C.fcInput,
      ),
    );
    sc(ws, 8, r, cInput(row.abatementAmount ?? 0, FMT.currency, fill));

    let ci = 9;
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


// ===========================================================================
// Scenario panel helpers (writeScenarioParams, writeCurrentRemainingObligations,
// writeRenegotiationPanel, writeExitPanel)
// All use 1-indexed row numbers that match Excel row numbers.
// ===========================================================================

// ---------------------------------------------------------------------------
// Scenario parameter cells (E–F, rows 12 / 22 / 23)
//   F12 = NPV Discount Rate   (0.07 default)
//   F22 = Free Rent (months)  (0 default)
//   F23 = TI ($ per SF)       (0 default)
// These sit in the assumptions area cols E–F which are otherwise empty.
// ---------------------------------------------------------------------------

function writeScenarioParams(ws, concessionRefs, LS = '') {
  const lStyle = themePanelLabelStyle(THIN_BORDER);
  // Rows 9 and 10 are used for Free Rent / TI inputs so they do not collide
  // with the Renegotiation panel (rows 13–30) whose Base-Case column (F) would
  // otherwise overwrite $F$22 and $F$23 with dash text cells → #VALUE!
  sc(ws, 4, 9, { t: 's', v: 'Free Rent (Lease Schedule)', s: lStyle });
  sc(ws, 5, 9, {
    t: 'n',
    v: 0,
    f: `${LS}${concessionRefs.freeRentTotal}`,
    s: themePanelValueStyle(FMT.currency, { fill: C.white, fontColor: THEME_C.fcCrossSheet, border: THIN_BORDER }),
  });
  sc(ws, 4, 10, { t: 's', v: 'Abatement (Lease Schedule)', s: lStyle });
  sc(ws, 5, 10, {
    t: 'n',
    v: 0,
    f: `${LS}${concessionRefs.abatementTotal}`,
    s: themePanelValueStyle(FMT.currency, { fill: C.white, fontColor: THEME_C.fcCrossSheet, border: THIN_BORDER }),
  });
  sc(ws, 4, 11, { t: 's', v: 'TI ($ per SF)', s: lStyle });
  sc(ws, 5, 11, { t: 'n', v: 0, s: themePanelInputStyle(FMT.currency, { fill: C.white, border: THIN_BORDER }) });
  sc(ws, 4, 12, { t: 's', v: 'NPV Discount Rate', s: lStyle });
  sc(ws, 5, 12, { t: 'n', v: 0.07, s: themePanelInputStyle(FMT.pct, { fill: C.white, border: THIN_BORDER }) });
}

// ---------------------------------------------------------------------------
// Current Remaining Obligations table (E4:F8)
// ---------------------------------------------------------------------------

function writeCurrentRemainingObligations(ws, cr, LS = '') {
  const { OBLIG, BASE, NNN: nnnCol, OTC, LAST, FDR } = cr;
  const hdrS = themePanelSectionStyle(C.headerNavy, 12);
  const lblS = themePanelLabelStyle(PANEL_BORDER);
  // E4: section header (E4:F4 merged)
  sc(ws, 4, 4, { t: 's', v: 'Current Remaining Obligations:', s: hdrS });
  sc(ws, 5, 4, { t: 's', v: '',                              s: hdrS });
  ws['!merges'].push({ s: { r: 3, c: 4 }, e: { r: 3, c: 5 } });

  [
    [5, 'Total Remaining Obligation:', OBLIG],
    [6, 'Remaining Base Rent:',        BASE],
    [7, 'Remaining Nets:',             nnnCol],
    [8, 'Remaining Other Charges:',    OTC],
  ].forEach(([r, label, lookupCol]) => {
    sc(ws, 4, r, { t: 's', v: label, s: lblS });
    sc(ws, 5, r, cFmla(
      legacyNearestPriorLookup(
        '$I$5',
        `${LS}$A$${FDR}:$A$${LAST}`,
        `${LS}${lookupCol}$${FDR}:${lookupCol}$${LAST}`,
        `${LS}$A$${FDR}`,
        `${LS}${lookupCol}$${FDR}`,
      ),
      0, FMT.currency, C.white,
    ));
  });
}

// ---------------------------------------------------------------------------
// Shared panel cell factories
// ---------------------------------------------------------------------------

function pSectionHdr(v) {
  return {
    t: 's', v,
    s: themePanelSectionStyle(C.headerNavy, 12),
  };
}

function pSectionHdrEmpty() {
  return {
    t: 's', v: '',
    s: themePanelTitleFillStyle(),
  };
}

function pTierLbl(v) {
  return {
    t: 's', v,
    s: themePanelTierStyle(C.headerBlue),
  };
}

function pRowLbl(v) {
  return {
    t: 's', v,
    s: themePanelLabelStyle(PANEL_BORDER),
  };
}

function pPct(v) {
  return {
    t: 'n', v,
    s: themePanelInputStyle(FMT.pct, { fill: THEME_C.labelFill, align: 'center', border: PANEL_BORDER }),
  };
}

function pDash() {
  return {
    t: 's', v: '-',
    s: themePanelDashStyle(C.white),
  };
}

function legacyNearestPriorLookup(lookupCell, dateRange, returnRange, firstDateCell, firstReturnCell) {
  return `IF(${lookupCell}<${firstDateCell},${firstReturnCell},LOOKUP(${lookupCell},${dateRange},${returnRange}))`;
}

// Green-emphasis cells for savings rows
const SAVINGS_GREEN_FILL = THEME_C.savingsFill;
const SAVINGS_GREEN_FONT = THEME_C.savingsText;

// Light-red emphasis for obligation severity (Exit panel — Remaining Obligation FV)
const OBLIG_RED_FILL = THEME_C.obligFill;
const OBLIG_RED_FONT = THEME_C.obligText;

function pSavingsLabel(v) {
  return {
    t: 's', v,
    s: themeEmphasisLabelStyle('savings'),
  };
}

function pSavingsDash() {
  return {
    t: 's', v: '-',
    s: themeEmphasisValueStyle('savings', FMT.text, 'center'),
  };
}

function pSavingsRow(formula, fallback, fmt) {
  return {
    t: 'n', v: fallback ?? 0, f: formula,
    s: themeEmphasisValueStyle('savings', fmt),
  };
}

function pObligLabel(v) {
  return {
    t: 's', v,
    s: themeEmphasisLabelStyle('obligation'),
  };
}

function pObligRow(formula, fallback, fmt) {
  return {
    t: 'n', v: fallback ?? 0, f: formula,
    s: themeEmphasisValueStyle('obligation', fmt),
  };
}

/** Panel data cell with formula — uses PANEL_BORDER for visual grouping */
function pFmla(formula, fallback, fmt, fill = C.white) {
  return {
    t: 'n', v: fallback ?? 0, f: formula,
    s: themePanelValueStyle(fmt, { fill, align: 'right', fontColor: THEME_C.fcCalc, border: PANEL_BORDER }),
  };
}

// ---------------------------------------------------------------------------
// Renegotiation Scenario panel (E13:I30)
// ---------------------------------------------------------------------------

function writeRenegotiationPanel(ws, cr, LS = '') {
  const { TMO, BRENT, SBRENT, TNNN, LAST, FDR, SF_ADDR, FREE_RENT_TOTAL, ABATEMENT_TOTAL } = cr;
  const AR  = `${LS}$A$${FDR}:$A$${LAST}`;
  // Dynamic column references — resolved from the actual Lease Schedule layout
  const BR  = `${LS}$${BRENT}$${FDR}:$${BRENT}$${LAST}`;   // Base Rent Applied (FV/NPV discount)
  const SR  = `${LS}$${SBRENT}$${FDR}:$${SBRENT}$${LAST}`; // Scheduled Base Rent (snapshot lookup)
  const NR  = `${LS}$${TNNN}$${FDR}:$${TNNN}$${LAST}`;
  const TR  = `${LS}$${TMO}$${FDR}:$${TMO}$${LAST}`;
  const ER  = SR;
  const LR  = NR;
  const npvPeriod =
    `(YEAR(${LS}$A$${FDR}:$A$${LAST})-YEAR($I$5))*12+(MONTH(${LS}$A$${FDR}:$A$${LAST})-MONTH($I$5))+1`;

  // Base-case FV/NPV of total monthly obligation from analysis date forward
  const fvBase  = `SUMPRODUCT((${AR}>=$I$5)*${TR})`;
  const npvBase = `SUMPRODUCT((${AR}>=$I$5)*${TR}/(1+$F$12/12)^(${npvPeriod}))`;
  // FV/NPV of base rent only (used to compute tier discounts)
  const fvBrent  = `SUMPRODUCT((${AR}>=$I$5)*${BR})`;
  const npvBrent = `SUMPRODUCT((${AR}>=$I$5)*${BR}/(1+$F$12/12)^(${npvPeriod}))`;
  // Tier FV = base FV - discount% * base-rent FV
  const fvTier  = (discountCell) => `(${fvBase})-${discountCell}*(${fvBrent})`;
  const npvTier = (discountCell) => `(${npvBase})-${discountCell}*(${npvBrent})`;

  // §8.1: $/SF resolves from the shared squareFootage assumption
  const SF = `${LS}${SF_ADDR}`;

  const dateCell = (f) => ({
    t: 'n', v: 0, f,
    s: themePanelValueStyle(FMT.date, { fill: C.white, align: 'center', fontColor: THEME_C.fcCalc, border: PANEL_BORDER }),
  });
  const infoCell = (v) => ({
    t: 's', v,
    s: themePanelValueStyle(FMT.text, { fill: C.white, align: 'left', fontColor: THEME_C.fcCalc, border: PANEL_BORDER }),
  });

  // Row 13: section header (E13:I13 merged) + date echo
  sc(ws, 4, 13, pSectionHdr('SCENARIO COMPARISON — Renegotiation'));
  for (let c = 5; c <= 6; c++) sc(ws, c, 13, pSectionHdrEmpty());
  ws['!merges'].push({ s: { r: 12, c: 4 }, e: { r: 12, c: 6 } });
  sc(ws, 7, 13, infoCell('Effective Date of Analysis:'));
  sc(ws, 8, 13, dateCell('$I$5'));

  // Row 14: tier labels
  sc(ws, 5, 14, pTierLbl('Base Case'));
  sc(ws, 6, 14, pTierLbl('Modest'));
  sc(ws, 7, 14, pTierLbl('Material'));
  sc(ws, 8, 14, pTierLbl('Significant'));

  // Row 15: discount rates (blue inputs)
  sc(ws, 4, 15, pRowLbl('% Discount'));
  [5, 6, 7, 8].forEach((c, i) => sc(ws, c, 15, pPct([0, 0.1, 0.2, 0.3][i])));

  // Row 16: Monthly Base Rent — INDEX/MATCH approximate lookup (legacy-compatible).
  // Using Scheduled Base Rent (pre-abatement) ensures the scenario discount math starts
  // from the contractual rate, not from zero during abatement months.
  // FV/NPV computations still use BRENT (applied).
  sc(ws, 4, 16, pRowLbl('Monthly Base Rent'));
  sc(ws, 5, 16, cFmla(
    legacyNearestPriorLookup('$I$5', AR, ER, `${LS}$A$${FDR}`, `${LS}$${SBRENT}$${FDR}`),
    0,
    FMT.currency,
    C.white,
  ));
  sc(ws, 6, 16, cFmla('$F$16*(1-G15)', 0, FMT.currency, C.white));
  sc(ws, 7, 16, cFmla('$F$16*(1-H15)', 0, FMT.currency, C.white));
  sc(ws, 8, 16, cFmla('$F$16*(1-I15)', 0, FMT.currency, C.white));

  // Row 17: Base $/PSF
  sc(ws, 4, 17, pRowLbl('Base/$PSF'));
  [5, 6, 7, 8].forEach((c, i) => {
    const col_ = ['F', 'G', 'H', 'I'][i];
    sc(ws, c, 17, pFmla(`IF(${SF}=0,0,${col_}16/${SF})`, 0, FMT.sf));
  });

  // Row 18: Additional Rent (Total NNN from analysis date row)
  sc(ws, 4, 18, pRowLbl('Additional Rent'));
  sc(ws, 5, 18, cFmla(
    legacyNearestPriorLookup('$I$5', AR, LR, `${LS}$A$${FDR}`, `${LS}$${TNNN}$${FDR}`),
    0,
    FMT.currency,
    C.white,
  ));
  sc(ws, 6, 18, cFmla('F18', 0, FMT.currency, C.white));
  sc(ws, 7, 18, cFmla('G18', 0, FMT.currency, C.white));
  sc(ws, 8, 18, cFmla('H18', 0, FMT.currency, C.white));

  // Row 19: Total Occupancy Cost
  sc(ws, 4, 19, pRowLbl('Total Occupancy Cost'));
  [5, 6, 7, 8].forEach((c, i) => {
    const col_ = ['F', 'G', 'H', 'I'][i];
    sc(ws, c, 19, pFmla(`${col_}16+${col_}18`, 0, FMT.currency));
  });

  // Row 20: Effective $/PSF
  sc(ws, 4, 20, pRowLbl('Effective $/PSF'));
  [5, 6, 7, 8].forEach((c, i) => {
    const col_ = ['F', 'G', 'H', 'I'][i];
    sc(ws, c, 20, pFmla(`IF(${SF}=0,0,${col_}19/${SF})`, 0, FMT.sf));
  });

  // Row 21: Lease Obligation FV (from analysis date forward) — light-red emphasis (obligation severity)
  // Base case = sum of TMO; tiers = TMO sum minus discount% applied to base rent sum
  sc(ws, 4, 21, pObligLabel('Lease Obligation (FV)'));
  sc(ws, 5, 21, pObligRow(fvBase, 0, FMT.currency));
  sc(ws, 6, 21, pObligRow(fvTier('G15'), 0, FMT.currency));
  sc(ws, 7, 21, pObligRow(fvTier('H15'), 0, FMT.currency));
  sc(ws, 8, 21, pObligRow(fvTier('I15'), 0, FMT.currency));

  // Row 22: Gross Savings vs Base (green emphasis — savings row)
  sc(ws, 4, 22, pSavingsLabel('Gross Savings vs Base ($)'));
  sc(ws, 5, 22, pSavingsDash());
  sc(ws, 6, 22, pSavingsRow('F21-G21', 0, FMT.currency));
  sc(ws, 7, 22, pSavingsRow('F21-H21', 0, FMT.currency));
  sc(ws, 8, 22, pSavingsRow('F21-I21', 0, FMT.currency));

  // Row 23: (+)Free Rent — references $F$9 (Free Rent months input, moved out of panel area)
  sc(ws, 4, 23, pRowLbl('(+)Free Rent'));
  sc(ws, 5, 23, pDash());
  sc(ws, 6, 23, pFmla(`${LS}${FREE_RENT_TOTAL}*(1-G15)`, 0, FMT.currency));
  sc(ws, 7, 23, pFmla(`${LS}${FREE_RENT_TOTAL}*(1-H15)`, 0, FMT.currency));
  sc(ws, 8, 23, pFmla(`${LS}${FREE_RENT_TOTAL}*(1-I15)`, 0, FMT.currency));

  // Row 24: (+)TI — references $F$10 (TI per SF input, moved out of panel area) × Lease Schedule SF
  sc(ws, 4, 24, pRowLbl('(+)Abatement'));
  sc(ws, 5, 24, pDash());
  sc(ws, 6, 24, pFmla(`${LS}${ABATEMENT_TOTAL}*(1-G15)`, 0, FMT.currency));
  sc(ws, 7, 24, pFmla(`${LS}${ABATEMENT_TOTAL}*(1-H15)`, 0, FMT.currency));
  sc(ws, 8, 24, pFmla(`${LS}${ABATEMENT_TOTAL}*(1-I15)`, 0, FMT.currency));

  // Row 25: Total Savings From Base (green emphasis — savings row)
  sc(ws, 4, 25, pRowLbl('(+)TI'));
  sc(ws, 5, 25, pDash());
  sc(ws, 6, 25, pFmla(`$F$11*${SF}`, 0, FMT.currency));
  sc(ws, 7, 25, pFmla(`$F$11*${SF}`, 0, FMT.currency));
  sc(ws, 8, 25, pFmla(`$F$11*${SF}`, 0, FMT.currency));

  // Row 26: NPV
  sc(ws, 4, 26, pSavingsLabel('Total Savings From Base'));
  sc(ws, 5, 26, pSavingsDash());
  sc(ws, 6, 26, pSavingsRow('SUM(G22:G25)', 0, FMT.currency));
  sc(ws, 7, 26, pSavingsRow('SUM(H22:H25)', 0, FMT.currency));
  sc(ws, 8, 26, pSavingsRow('SUM(I22:I25)', 0, FMT.currency));

  // Row 27: NPV Savings vs Base
  sc(ws, 4, 27, pRowLbl('NPV'));
  sc(ws, 5, 27, pFmla(npvBase, 0, FMT.currency));
  sc(ws, 6, 27, pFmla(npvTier('G15'), 0, FMT.currency));
  sc(ws, 7, 27, pFmla(npvTier('H15'), 0, FMT.currency));
  sc(ws, 8, 27, pFmla(npvTier('I15'), 0, FMT.currency));

  // Row 28: % Savings vs Base
  sc(ws, 4, 28, pRowLbl('NPV Savings vs Base'));
  sc(ws, 5, 28, pDash());
  sc(ws, 6, 28, pFmla('F27-G27', 0, FMT.currency));
  sc(ws, 7, 28, pFmla('F27-H27', 0, FMT.currency));
  sc(ws, 8, 28, pFmla('F27-I27', 0, FMT.currency));

  // Row 29: Full-Lease FV (no date filter — all months)
  // Base = SUM(TMO); tiers = SUM(TMO) - discount% * SUM(baseRent)
  const fullTMO   = `SUM(${LS}${TMO}${FDR}:${TMO}${LAST})`;
  const fullBRENT = `SUM(${LS}${BRENT}${FDR}:${BRENT}${LAST})`;
  sc(ws, 4, 29, pRowLbl('% Savings vs Base'));
  sc(ws, 5, 29, pDash());
  sc(ws, 6, 29, pFmla('IFERROR((F27-G27)/F27,0)', 0, FMT.pct));
  sc(ws, 7, 29, pFmla('IFERROR((F27-H27)/F27,0)', 0, FMT.pct));
  sc(ws, 8, 29, pFmla('IFERROR((F27-I27)/F27,0)', 0, FMT.pct));
  sc(ws, 4, 30, pRowLbl('Full-Lease FV (all months)'));
  sc(ws, 5, 30, pFmla(fullTMO, 0, FMT.currency));
  sc(ws, 6, 30, pFmla(`(${fullTMO})-G15*(${fullBRENT})`, 0, FMT.currency));
  sc(ws, 7, 30, pFmla(`(${fullTMO})-H15*(${fullBRENT})`, 0, FMT.currency));
  sc(ws, 8, 30, pFmla(`(${fullTMO})-I15*(${fullBRENT})`, 0, FMT.currency));

  // Row 30: §8.3 NNN cross-check — undiscounted future sum of totalNNN, identical across all columns
  const nnnCrossCheck = `SUMPRODUCT((${AR}>=$I$5)*${NR})`;
  sc(ws, 4, 31, pRowLbl('Cross-check: Future NNN'));
  sc(ws, 5, 31, pFmla(nnnCrossCheck, 0, FMT.currency));
  sc(ws, 6, 31, pFmla(nnnCrossCheck, 0, FMT.currency));
  sc(ws, 7, 31, pFmla(nnnCrossCheck, 0, FMT.currency));
  sc(ws, 8, 31, pFmla(nnnCrossCheck, 0, FMT.currency));
}

// ---------------------------------------------------------------------------
// Exit Scenario panel (E32:J49)
// ---------------------------------------------------------------------------

function writeExitPanel(ws, cr, LS = '') {
  const { TMO, BRENT, LAST, FDR, SF_ADDR, FREE_RENT_TOTAL, ABATEMENT_TOTAL } = cr;
  const SF = `${LS}${SF_ADDR}`;

  const dateCell = (f) => ({
    t: 'n', v: 0, f,
    s: themePanelValueStyle(FMT.date, { fill: C.white, align: 'center', fontColor: THEME_C.fcCalc, border: PANEL_BORDER }),
  });
  const infoCell = (v) => ({
    t: 's', v,
    s: themePanelValueStyle(FMT.text, { fill: C.white, align: 'left', fontColor: THEME_C.fcCalc, border: PANEL_BORDER }),
  });

  // Row 32: section header (E32:G32 merged) + date echo
  sc(ws, 4, 32, pSectionHdr('SCENARIO COMPARISON — Exit'));
  for (let c = 5; c <= 6; c++) sc(ws, c, 32, pSectionHdrEmpty());
  ws['!merges'].push({ s: { r: 31, c: 4 }, e: { r: 31, c: 6 } });
  sc(ws, 7, 32, infoCell('Effective Date of Analysis:'));
  sc(ws, 8, 32, dateCell('$I$5'));

  // Row 33: tier labels
  sc(ws, 5, 33, pTierLbl('Full Obligation'));
  sc(ws, 6, 33, pTierLbl('Mild Discount'));
  sc(ws, 7, 33, pTierLbl('Moderate Discount'));
  sc(ws, 8, 33, pTierLbl('Material Discount'));
  sc(ws, 9, 33, pTierLbl('Significant Discount'));

  // Row 34: % Buyout (blue inputs)
  sc(ws, 4, 34, pRowLbl('% Buyout'));
  [5, 6, 7, 8, 9].forEach((c, i) => sc(ws, c, 34, pPct([0, 0.2, 0.3, 0.4, 0.5][i])));

  // Row 35: Monthly Base Rent = $F$16 × (1 − buyout%) — same discount pattern as Renegotiation row 16
  sc(ws, 4, 35, pRowLbl('Monthly Base Rent'));
  [5, 6, 7, 8, 9].forEach((c, i) => {
    const col_ = ['F', 'G', 'H', 'I', 'J'][i];
    sc(ws, c, 35, pFmla(`$F$16*(1-${col_}34)`, 0, FMT.currency));
  });

  // Row 36: Base $/PSF
  sc(ws, 4, 36, pRowLbl('Base/$PSF'));
  [5, 6, 7, 8, 9].forEach((c, i) => {
    const col_ = ['F', 'G', 'H', 'I', 'J'][i];
    sc(ws, c, 36, pFmla(`IF(${SF}=0,0,${col_}35/${SF})`, 0, FMT.sf));
  });

  // Row 37: Additional Rent (references renegotiation F18)
  sc(ws, 4, 37, pRowLbl('Additional Rent'));
  sc(ws, 5, 37, cFmla('F18', 0, FMT.currency, C.white));
  [6, 7, 8].forEach((c) => sc(ws, c, 37, cFmla('F37', 0, FMT.currency, C.white)));

  // Row 38: Total Occupancy Cost
  sc(ws, 4, 38, pRowLbl('Total Occupancy Cost'));
  [5, 6, 7, 8, 9].forEach((c, i) => {
    const col_ = ['F', 'G', 'H', 'I', 'J'][i];
    sc(ws, c, 38, pFmla(`${col_}35+${col_}37`, 0, FMT.currency));
  });

  // Row 39: Effective $/PSF
  sc(ws, 4, 39, pRowLbl('Effective $/PSF'));
  [5, 6, 7, 8, 9].forEach((c, i) => {
    const col_ = ['F', 'G', 'H', 'I', 'J'][i];
    sc(ws, c, 39, pFmla(`IF(${SF}=0,0,${col_}38/${SF})`, 0, FMT.sf));
  });

  // Row 40: Remaining Obligation FV (= F21 * (1-buyout%)) — light-red emphasis (obligation severity)
  sc(ws, 4, 40, pObligLabel('Remaining Obligation (FV)'));
  sc(ws, 5, 40, pObligRow('F21', 0, FMT.currency));
  sc(ws, 6, 40, pObligRow('F40*(1-G34)', 0, FMT.currency));
  sc(ws, 7, 40, pObligRow('F40*(1-H34)', 0, FMT.currency));
  sc(ws, 8, 40, pObligRow('F40*(1-I34)', 0, FMT.currency));
  sc(ws, 9, 40, pObligRow('F40*(1-J34)', 0, FMT.currency));

  // Row 41: Gross Savings vs Base (green emphasis — savings row)
  sc(ws, 4, 41, pSavingsLabel('Gross Savings vs Base ($)'));
  sc(ws, 5, 41, pSavingsDash());
  sc(ws, 6, 41, pSavingsRow('F40-G40', 0, FMT.currency));
  sc(ws, 7, 41, pSavingsRow('F40-H40', 0, FMT.currency));
  sc(ws, 8, 41, pSavingsRow('F40-I40', 0, FMT.currency));
  sc(ws, 9, 41, pSavingsRow('F40-J40', 0, FMT.currency));

  // Row 42: (+)Free Rent — references $F$9 (Free Rent months input, moved out of panel area)
  sc(ws, 4, 42, pRowLbl('(+)Free Rent'));
  sc(ws, 5, 42, pDash());
  [6, 7, 8, 9].forEach((c, i) => {
    const col_ = ['G', 'H', 'I', 'J'][i];
    sc(ws, c, 42, pFmla(`${LS}${FREE_RENT_TOTAL}*(1-${col_}34)`, 0, FMT.currency));
  });

  // Row 43: (+)TI — references $F$10 (TI per SF input, moved out of panel area) × Lease Schedule SF
  sc(ws, 4, 43, pRowLbl('(+)Abatement'));
  sc(ws, 5, 43, pDash());
  [6, 7, 8, 9].forEach((c, i) => {
    const col_ = ['G', 'H', 'I', 'J'][i];
    sc(ws, c, 43, pFmla(`${LS}${ABATEMENT_TOTAL}*(1-${col_}34)`, 0, FMT.currency));
  });

  // Row 44: Total Savings From Base (green emphasis — savings row)
  sc(ws, 4, 44, pRowLbl('(+)TI'));
  sc(ws, 5, 44, pDash());
  [6, 7, 8, 9].forEach((c) => sc(ws, c, 44, pFmla(`$F$11*${SF}`, 0, FMT.currency)));

  // Row 45: NPV (= F26 * (1-buyout%))
  sc(ws, 4, 45, pSavingsLabel('Total Savings From Base'));
  sc(ws, 5, 45, pSavingsDash());
  [6, 7, 8, 9].forEach((c, i) => {
    const col_ = ['G', 'H', 'I', 'J'][i];
    sc(ws, c, 45, pSavingsRow(`SUM(${col_}41:${col_}44)`, 0, FMT.currency));
  });

  // Row 46: NPV Savings vs Base
  sc(ws, 4, 46, pRowLbl('NPV'));
  sc(ws, 5, 46, pFmla('F27', 0, FMT.currency));
  sc(ws, 6, 46, pFmla('F27*(1-G34)', 0, FMT.currency));
  sc(ws, 7, 46, pFmla('F27*(1-H34)', 0, FMT.currency));
  sc(ws, 8, 46, pFmla('F27*(1-I34)', 0, FMT.currency));
  sc(ws, 9, 46, pFmla('F27*(1-J34)', 0, FMT.currency));

  // Row 47: % Savings vs Base
  sc(ws, 4, 47, pRowLbl('NPV Savings vs Base'));
  sc(ws, 5, 47, pDash());
  [6, 7, 8, 9].forEach((c, i) => {
    const col_ = ['G', 'H', 'I', 'J'][i];
    sc(ws, c, 47, pFmla(`F46-${col_}46`, 0, FMT.currency));
  });

  // Row 48: Full-Lease FV (all months) — base = SUM(TMO); tiers = base*(1-buyout%)
  const fullTMO = `SUM(${LS}${TMO}${FDR}:${TMO}${LAST})`;
  sc(ws, 4, 48, pRowLbl('% Savings vs Base'));
  sc(ws, 5, 48, pDash());
  sc(ws, 6, 48, pFmla('IFERROR((F46-G46)/F46,0)', 0, FMT.pct));
  sc(ws, 7, 48, pFmla('IFERROR((F46-H46)/F46,0)', 0, FMT.pct));
  sc(ws, 8, 48, pFmla('IFERROR((F46-I46)/F46,0)', 0, FMT.pct));
  sc(ws, 9, 48, pFmla('IFERROR((F46-J46)/F46,0)', 0, FMT.pct));

  // Row 49: Simplified cross-check: Full Renegotiation FV × (1-buyout%)
  sc(ws, 4, 49, pRowLbl('Full-Lease FV (all months)'));
  sc(ws, 5, 49, pFmla(fullTMO, 0, FMT.currency));
  sc(ws, 6, 49, pFmla('F49*(1-G34)', 0, FMT.currency));
  sc(ws, 7, 49, pFmla('F49*(1-H34)', 0, FMT.currency));
  sc(ws, 8, 49, pFmla('F49*(1-I34)', 0, FMT.currency));
  sc(ws, 9, 49, pFmla('F49*(1-J34)', 0, FMT.currency));

  sc(ws, 4, 50, pRowLbl('Cross-check: Reneg FV x (1-buyout%)'));
  [5, 6, 7, 8, 9].forEach((c, i) => {
    const col_ = ['F', 'G', 'H', 'I', 'J'][i];
    sc(ws, c, 50, pFmla(`F30*(1-${col_}34)`, 0, FMT.currency));
  });
}

// ---------------------------------------------------------------------------
// Main ledger builder
// ---------------------------------------------------------------------------


// ===========================================================================
// Sheet 4 — Scenario Analysis
// ===========================================================================

function buildScenarioSheet(rows, otLabels, columns, firstDataRow, cellMap, leaseLayout) {
  const ws = {};
  ws['!merges'] = [];

  // Derive column positions from the dynamic layout (mirrors Lease Schedule sheet)
  const colByKey = {};
  for (const c of columns) colByKey[c.key] = c;
  const TOTAL_MONTHLY     = colByKey.totalMonthly.index;
  const OBLIG_REM         = colByKey.obligRem.index;
  const BASE_REM          = colByKey.baseRem.index;
  const NNN_REM           = colByKey.nnnRem.index;
  const OTHER_CHARGES_REM = colByKey.otherRem.index;
  const BASE_RENT_APPLIED  = colByKey.baseRentApplied.index;
  const SCHED_BASE_RENT    = colByKey.scheduledBaseRent.index;
  const TOTAL_NNN_COL      = colByKey.totalNNN.index;
  const FDR      = firstDataRow;
  const lastData = FDR + rows.length - 1;

  const colRefs = {
    TMO:    col(TOTAL_MONTHLY),
    OBLIG:  col(OBLIG_REM),
    BASE:   col(BASE_REM),
    NNN:    col(NNN_REM),
    OTC:    col(OTHER_CHARGES_REM),
    BRENT:  col(BASE_RENT_APPLIED),   // Base Rent Applied — used for FV/NPV discount math
    SBRENT: col(SCHED_BASE_RENT),     // Scheduled Base Rent — used for current-month snapshot
    TNNN:   col(TOTAL_NNN_COL),
    LAST:   lastData,
    FDR,
    FREE_RENT_TOTAL: leaseLayout?.freeRentTable?.totalAmountAddress ?? '$I$30',
    ABATEMENT_TOTAL: leaseLayout?.abatementTable?.totalAmountAddress ?? '$I$16',
  };

  const LS = "'Lease Schedule'!";

  // §8.1: Resolve SF from the shared assumption cell, not a hardcoded position
  const sfAddr = cellMap?.squareFootage ?? '$C$7';

  // Title (row 1, col E — merged E1:J1)
  sc(ws, 4, 1, {
    t: 's', v: 'DEODATE — Scenario Analysis',
    s: themeScenarioSheetTitleStyle(),
  });
  for (let c = 5; c <= 9; c++) {
    sc(ws, c, 1, {
      t: 's', v: '',
      s: themePanelTitleFillStyle(),
    });
  }
  ws['!merges'].push({ s: { r: 0, c: 4 }, e: { r: 0, c: 9 } });

  // §7: Analysis date input — I5 resolves to the shared analysisDate assumption
  sc(ws, 7, 5, {
    t: 's', v: 'Effective Date of Analysis:',
    s: themePanelLabelStyle(PANEL_BORDER, 'right'),
  });
  const analysisDateAddr = cellMap?.effectiveAnalysisDate ?? `A${FDR}`;
  const defaultAnalysisDate = rows[0]?.periodStart ?? rows[0]?.date ?? null;
  // §11: gentle yellow fill + blue input font for editable date
  sc(ws, 8, 5, {
    t: 'n',
    v: toSerial(defaultAnalysisDate) ?? 0,
    f: `${LS}${analysisDateAddr}`,
    s: themePanelInputStyle(FMT.date, { fill: THEME_C.labelFill, align: 'center', border: PANEL_BORDER }),
  });  // I5 resolves from the shared analysisDate assumption — user-overridable

  // Pass SF address through colRefs so panels use the semantic assumption
  colRefs.SF_ADDR = sfAddr;

  // Scenario params + panel blocks
  writeScenarioParams(ws, {
    freeRentTotal: colRefs.FREE_RENT_TOTAL,
    abatementTotal: colRefs.ABATEMENT_TOTAL,
  }, LS);
  writeCurrentRemainingObligations(ws, colRefs, LS);
  writeRenegotiationPanel(ws, colRefs, LS);
  writeExitPanel(ws, colRefs, LS);

  ws['!cols'] = [
    { wch: 3 }, { wch: 3 }, { wch: 3 }, { wch: 3 },        // A–D (unused)
    { wch: 34 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, // E–J
  ];
  ws['!rows'] = [{ hpt: 28 }];
  setRef(ws, 9, 50);
  return ws;
}


export function buildXLSXWorkbook(rows, params = {}, filename = 'lease-schedule') {
  const wb = XLSX.utils.book_new();
  wb.Props = {
    Title:       'Lease Schedule',
    Author:      'DEODATE Lease Schedule Engine',
    CreatedDate: new Date(),
  };

  const exportModel = buildExportModel(rows, params, filename);
  const leaseLayout = resolveLeaseScheduleLayout(exportModel);
  const leaseSpec = buildLegacyLeaseScheduleSpec(exportModel, leaseLayout);

  // Build sheets
  XLSX.utils.book_append_sheet(
    wb,
    renderLeaseScheduleWorksheet(leaseSpec),
    'Lease Schedule',
  );
  XLSX.utils.book_append_sheet(
    wb,
    renderSheet(buildAnnualSummarySpec(
      rows,
      exportModel.activeCategories.length,
      exportModel.otLabels.length,
      {
        FIRST_DATA_ROW: leaseLayout.firstDataRow,
        TOTAL_NNN_COL: exportModel.columns.find((column) => column.key === 'totalNNN').index,
        TOTAL_MONTHLY: exportModel.columns.find((column) => column.key === 'totalMonthly').index,
      },
    )),
    'Annual Summary',
  );
  XLSX.utils.book_append_sheet(
    wb,
    renderSheet(buildAuditTrailSpec(rows, exportModel.activeCategories)),
    'Audit Trail',
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildScenarioSheet(rows, exportModel.otLabels, exportModel.columns, leaseLayout.firstDataRow, leaseLayout.cellMap, leaseLayout),
    'Scenario Analysis',
  );

  return {
    workbook: wb,
    firstDataRow: leaseLayout.firstDataRow,
    lastDataRow: leaseLayout.lastDataRow,
  };
}

export function buildXLSXBytes(rows, params = {}, filename = 'lease-schedule') {
  const { workbook: wb, firstDataRow, lastDataRow } = buildXLSXWorkbook(rows, params, filename);

  const xlsxBytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

  // Unzip the XLSX package to inject data validation
  const unzipped = unzipSync(toUint8Array(xlsxBytes));

  const sheetKey = 'xl/worksheets/sheet4.xml';
  if (unzipped[sheetKey]) {
    let xml = strFromU8(unzipped[sheetKey]);
    const dvXml =
      `<dataValidations count="1">` +
      `<dataValidation type="list" sqref="I5" showDropDown="0" ` +
      `showErrorMessage="0" showInputMessage="0">` +
      `<formula1>'Lease Schedule'!$A$${firstDataRow}:$A$${lastDataRow}</formula1>` +
      `</dataValidation></dataValidations>`;
    if (xml.includes('<ignoredErrors')) {
      xml = xml.replace('<ignoredErrors', dvXml + '<ignoredErrors');
    } else {
      xml = xml.replace('</worksheet>', dvXml + '</worksheet>');
    }
    unzipped[sheetKey] = strToU8(xml);
  }

  return zipSync(unzipped);
}

export function exportToXLSX(rows, params = {}, filename = 'lease-schedule') {
  const rezipped = buildXLSXBytes(rows, params, filename);
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

