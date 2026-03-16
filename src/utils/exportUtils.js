/**
 * @fileoverview Professional XLSX export with full formatting and live formulas.
 *
 * Uses xlsx-js-style (SheetJS fork with cell styling support).
 * Produces a three-sheet workbook:
 *
 *   "Lease Schedule"  — assumptions block (B2:C19) + monthly ledger.
 *                       Every formula traces back to a labeled assumption cell.
 *                       Total NNN ① and Total Monthly ② are Excel formulas.
 *                       Bottom row: SUM formulas for every numeric column.
 *
 *   "Annual Summary"  — one row per lease year; every value is a SUMIF/COUNTIF
 *                       formula referencing the Lease Schedule sheet.
 *
 *   "Audit Trail"     — proration factors and escalation indexes (plain data).
 *
 * Row layout — Lease Schedule tab:
 *   Row  1        : blank
 *   Rows 2–19     : assumptions block (B = label, C = value)
 *   Row  20       : blank separator
 *   Row  21       : column headers
 *   Row  22+      : monthly data rows
 */

import XLSX from 'xlsx-js-style';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import Papa from 'papaparse';

// ===========================================================================
// Row layout constants  (referenced by both buildLedger and buildAnnualSummary)
// ===========================================================================
//
// Row 1: blank
// Row 2: large bold title (Lease Name)
// Row 3: blank spacer
// Rows 4–21: assumptions block (18 rows)
// Row 22: blank separator
// Row 23: column headers
// Row 24+: monthly data rows

const HEADER_ROW     = 23;   // column-header row
const FIRST_DATA_ROW = 24;   // first monthly data row

// Assumption block start row (after title + spacer)
const ASSUMP_START   = 4;

// ===========================================================================
// Colour palette
// ===========================================================================

const C = {
  // ── Background fills ──────────────────────────────────────────────────────
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
  assumpLabel:  'EBF3FB',   // light-blue assumption label background
  softRedPink:  'FFB6C1',   // Fix 3: net/obligation column fill

  // ── Finance-convention font colours ──────────────────────────────────────
  // Fix 3: Blue = RGB(0,0,255) per spec for direct inputs
  fcInput:      '0000FF',   // pure blue  — hard-coded inputs
  fcCalc:       '000000',   // black      — same-sheet formulas / calculations
  fcCrossSheet: '375623',   // dark green — cross-sheet references
  fcTotal:      '1F3864',   // navy       — totals row
};

// ===========================================================================
// Shared style building blocks
// ===========================================================================

const FONT    = { name: 'Calibri', sz: 11 };
const FONT_B  = { ...FONT, bold: true };
const FONT_SM = { ...FONT, sz: 10 };

function hdrStyle(bg = C.headerNavy) {
  return {
    font:      { ...FONT_B, color: { rgb: C.white } },
    fill:      { patternType: 'solid', fgColor: { rgb: bg } },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    border: {
      bottom: { style: 'medium', color: { rgb: '000000' } },
      top:    { style: 'thin',   color: { rgb: '000000' } },
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

/**
 * Parse an OTC charge date string (MM/DD/YYYY) to an Excel serial number.
 * Returns null for non-date text triggers (e.g. "Within 30 days of occupancy"),
 * which the caller treats as always-present (no expiry condition).
 */
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

/** Hard-coded input — Blue font per spec (RGB 0,0,255). */
function cInput(v, fmt, fill, bold = false) {
  return { t: 'n', v: v ?? 0, s: ds(fill, fmt, { bold, fontColor: C.fcInput }) };
}

/** Same-sheet calc / formula result — Black font. */
function cCalc(v, fmt, fill, bold = false) {
  return { t: 'n', v: v ?? 0, s: ds(fill, fmt, { bold, fontColor: C.fcCalc }) };
}

/** Same-sheet formula — Black font. */
function cFmla(formula, fallback, fmt, fill, bold = false) {
  return { t: 'n', v: fallback ?? 0, f: formula, s: ds(fill, fmt, { bold, fontColor: C.fcCalc }) };
}

/**
 * Blue formula — driven by assumption cells but styled as an input
 * (user adjusts via the assumption block, not per-cell).
 */
function cFmlaInput(formula, fallback, fmt, fill) {
  return { t: 'n', v: fallback ?? 0, f: formula, s: ds(fill, fmt, { fontColor: C.fcInput }) };
}

/** Cross-sheet formula — Dark-green font. */
function cXSheet(formula, fallback, fmt, fill) {
  return { t: 'n', v: fallback ?? 0, f: formula, s: ds(fill, fmt, { fontColor: C.fcCrossSheet }) };
}

/**
 * Fix 3: Date cells are BLACK (fixed, no input styling) per spec.
 * Previously blue; changed here.
 */
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

/**
 * Derive assumption values from processed rows and calculator params.
 * These populate the assumptions block (B2:C22) in the Lease Schedule tab.
 */
function computeAssumptions(rows, params) {
  const nnnMode = params.nnnMode ?? 'individual';
  const isAgg   = nnnMode === 'aggregate';

  if (!rows || !rows.length) {
    return {
      leaseName: params.leaseName || '',
      nnnMode,
      squareFootage: 0, commencementDate: null, expirationDate: null,
      year1BaseRent: 0, annualEscRate: 0, anniversaryMonth: 1,
      fullAbatementMonths: 0, abatementPartialFactor: 1,
      camsYear1: 0, camsEsc: 0,
      insuranceYear1: 0, insuranceEsc: 0,
      taxesYear1: 0, taxesEsc: 0,
      securityYear1: 0, securityEsc: 0,
      otherItemsYear1: 0, otherItemsEsc: 0,
    };
  }

  const firstRow = rows[0];
  const lastRow  = rows[rows.length - 1];

  const year1BaseRent = firstRow.scheduledBaseRent ?? 0;

  // Annual base rent escalation: compare first Year-2 row to Year-1 base
  const year2Row     = rows.find((r) => (r.leaseYear ?? r['Year #']) === 2);
  let   annualEscRate = 0;
  if (year2Row && year1BaseRent > 0) {
    annualEscRate = (year2Row.scheduledBaseRent ?? 0) / year1BaseRent - 1;
  }

  // Abatement: count full-abatement rows (isAbatementRow = true)
  const fullAbatementMonths   = rows.filter((r) => r.isAbatementRow).length;
  const boundaryRow           = rows.find((r) => r.prorationBasis === 'abatement-boundary');
  const abatementPartialFactor = boundaryRow
    ? (boundaryRow.baseRentProrationFactor ?? 1)
    : 1;

  // In aggregate mode, row 12 holds nnnAggregate Year1, row 13 holds nnnAggregate Esc.
  // Rows 14-17 (Insurance/Taxes) are left at zero (blank in assumptions block).
  // Rows 18-21 hold Security/Other Items (same position as individual mode).
  const camsYear1 = isAgg
    ? (Number(params.nnnAggregate?.year1) || 0)
    : (Number(params.cams?.year1) || 0);
  const camsEsc = isAgg
    ? (Number(params.nnnAggregate?.escPct) || 0) / 100
    : (Number(params.cams?.escPct) || 0) / 100;

  return {
    leaseName:             String(params.leaseName || ''),
    nnnMode,
    squareFootage:         Number(params.squareFootage) || 0,
    commencementDate:      firstRow.periodStart ?? null,
    expirationDate:        lastRow.periodEnd    ?? null,
    year1BaseRent,
    annualEscRate,
    anniversaryMonth:      1,   // Year # = Math.floor(idx/12)+1 → always increments at month 1
    fullAbatementMonths,
    abatementPartialFactor,
    camsYear1,
    camsEsc,
    insuranceYear1:        isAgg ? 0 : (Number(params.insurance?.year1)   || 0),
    insuranceEsc:          isAgg ? 0 : (Number(params.insurance?.escPct)  || 0) / 100,
    taxesYear1:            isAgg ? 0 : (Number(params.taxes?.year1)       || 0),
    taxesEsc:              isAgg ? 0 : (Number(params.taxes?.escPct)      || 0) / 100,
    securityYear1:         Number(params.security?.year1)   || 0,
    securityEsc:           (Number(params.security?.escPct) || 0) / 100,
    otherItemsYear1:       Number(params.otherItems?.year1) || 0,
    otherItemsEsc:         (Number(params.otherItems?.escPct)|| 0) / 100,
  };
}

// ===========================================================================
// Sheet 1 — Monthly Ledger
// ===========================================================================
//
// Column layout (0-based → letter):
//  0  A  Period Start
//  1  B  Period End
//  2  C  Month #
//  3  D  Year #
//  4  E  Scheduled Base Rent         ← FORMULA  =$C$7*(1+$C$8)^(D{r}-1)
//  5  F  Base Rent Applied           ← FORMULA  abatement IF referencing $C$10, $C$11
//
//  INDIVIDUAL MODE (nnnMode='individual'):
//  6  G  CAMS ($C$12)               ← FORMULA  $C$12*(1+$C$13)^(D{r}-1)
//  7  H  Insurance ($C$14)          ← FORMULA  $C$14*(1+$C$15)^(D{r}-1)
//  8  I  Taxes ($C$16)              ← FORMULA  $C$16*(1+$C$17)^(D{r}-1)
//  9  J  Security ($C$18)           ← FORMULA  $C$18*(1+$C$19)^(D{r}-1)
// 10  K  Other Items ($C$20)        ← FORMULA  $C$20*(1+$C$21)^(D{r}-1)
// 11..10+n  OTC columns
// 11+n  Total NNN ①
// 12+n  Total Monthly Obl. ②
// 13+n  Effective $/SF
//
//  AGGREGATE MODE (nnnMode='aggregate'):
//  6  G  NNN Agg Estimate ($C$12)   ← FORMULA  $C$12*(1+$C$13)^(D{r}-1)
//  7  H  Security ($C$18)           ← FORMULA  $C$18*(1+$C$19)^(D{r}-1)
//  8  I  Other Items ($C$20)        ← FORMULA  $C$20*(1+$C$21)^(D{r}-1)
//  9..8+n  OTC columns
//  9+n  Total NNN ①
// 10+n  Total Monthly Obl. ②
// 11+n  Effective $/SF
//
// Fix 3 — fill convention:
//   softRedPink fill: cols F, G, H, I, J, K, OTC, Total NNN  (net/obligation columns)
//   row-alternating / amber fill: all other columns

// ---------------------------------------------------------------------------
// Assumption block writer
// ---------------------------------------------------------------------------

function buildAssumptionsBlock(ws, assump) {
  const labelStyle = {
    font:      { ...FONT_B, color: { rgb: '1F3864' } },
    fill:      { patternType: 'solid', fgColor: { rgb: C.assumpLabel } },
    alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
    border: {
      top:    { style: 'thin', color: { rgb: '000000' } },
      bottom: { style: 'thin', color: { rgb: '000000' } },
      left:   { style: 'thin', color: { rgb: '000000' } },
      right:  { style: 'thin', color: { rgb: '000000' } },
    },
    numFmt: FMT.text,
  };

  const vFill  = C.white;
  const isAgg  = assump.nnnMode === 'aggregate';

  // Title row at B2 — large bold lease name
  const titleStyle = {
    font:      { name: 'Calibri', sz: 18, bold: true, color: { rgb: C.headerNavy } },
    fill:      { patternType: 'solid', fgColor: { rgb: C.white } },
    alignment: { horizontal: 'left', vertical: 'middle', wrapText: false },
    numFmt:    FMT.text,
  };
  sc(ws, 1, 2, { t: 's', v: assump.leaseName || 'Lease Schedule', s: titleStyle });

  const assumpBorder = {
    top:    { style: 'thin', color: { rgb: '000000' } },
    bottom: { style: 'thin', color: { rgb: '000000' } },
    left:   { style: 'thin', color: { rgb: '000000' } },
    right:  { style: 'thin', color: { rgb: '000000' } },
  };
  const row = (r, label, cell) => {
    sc(ws, 1, r, { t: 's', v: label, s: labelStyle });
    sc(ws, 2, r, { ...cell, s: { ...cell.s, border: assumpBorder } });
  };

  // 18 assumption rows starting at B4 (rows 4–21, shifted +2 from previous layout)
  row(4,  'Rentable SF',
      cCalc(assump.squareFootage, FMT.int, vFill));
  row(5,  'Lease Commencement Date',
      cDate(assump.commencementDate, vFill));
  row(6,  'Lease Expiration Date',
      cDate(assump.expirationDate, vFill));
  row(7,  'Year 1 Monthly Base Rent',
      cInput(assump.year1BaseRent, FMT.currency, vFill));
  row(8,  'Annual Base Rent Escalation Rate (%)',
      cInput(assump.annualEscRate, FMT.pct, vFill));
  row(9,  'Lease Anniversary Month',
      cCalc(assump.anniversaryMonth, FMT.int, vFill));
  row(10, 'Abatement Full-Month Count',
      cCalc(assump.fullAbatementMonths, FMT.int, vFill));
  row(11, 'Abatement Partial-Month Proration Factor',
      cCalc(assump.abatementPartialFactor, FMT.factor, vFill));
  row(12, isAgg ? 'NNN Aggregate Year 1 Monthly Rate ($)' : 'CAMS Year 1 Monthly Rate ($)',
      cInput(assump.camsYear1, FMT.currency, vFill));
  row(13, isAgg ? 'NNN Aggregate Annual Escalation Rate (%)' : 'CAMS Annual Escalation Rate (%)',
      cInput(assump.camsEsc, FMT.pct, vFill));
  if (!isAgg) {
    row(14, 'Insurance Year 1 Monthly Rate ($)',
        cInput(assump.insuranceYear1, FMT.currency, vFill));
    row(15, 'Insurance Annual Escalation Rate (%)',
        cInput(assump.insuranceEsc, FMT.pct, vFill));
    row(16, 'Taxes Year 1 Monthly Rate ($)',
        cInput(assump.taxesYear1, FMT.currency, vFill));
    row(17, 'Taxes Annual Escalation Rate (%)',
        cInput(assump.taxesEsc, FMT.pct, vFill));
  }
  row(18, 'Security Year 1 Monthly Rate ($)',
      cInput(assump.securityYear1, FMT.currency, vFill));
  row(19, 'Security Annual Escalation Rate (%)',
      cInput(assump.securityEsc, FMT.pct, vFill));
  row(20, 'Other Items Year 1 Monthly Rate ($)',
      cInput(assump.otherItemsYear1, FMT.currency, vFill));
  row(21, 'Other Items Annual Escalation Rate (%)',
      cInput(assump.otherItemsEsc, FMT.pct, vFill));
}

// ---------------------------------------------------------------------------
// OTC Remaining — period-linked formula builder
// ---------------------------------------------------------------------------

/**
 * Build the Excel formula for the OTC Remaining cell in a given schedule row.
 *
 * Logic: for each OTC charge, include its amount only if the charge's due date
 * is on or after the period's start date (i.e., not yet past). Charges with
 * non-parseable text due dates (trigger events) are included unconditionally.
 *
 * @param {number}   r               - 1-based Excel row number of this period
 * @param {Array}    filteredCharges  - OTC charges with truthy name (same as box rows)
 * @param {number}   boxStartCol      - 0-based col index of the OTC box label column
 * @param {number}   boxStartRow      - 1-based row of the OTC box header
 * @returns {string} Excel formula string
 */
function buildOtcRemainingFormula(r, filteredCharges, boxStartCol, boxStartRow) {
  if (!filteredCharges || filteredCharges.length === 0) return '0';
  const parts = filteredCharges.map((charge, idx) => {
    const amtCell = `${col(boxStartCol + 1)}${boxStartRow + 1 + idx}`;
    const serial  = parseOtcDateSerial(charge.date);
    if (serial !== null) {
      // Include this item only if its due date >= this row's Period Start (col A)
      return `IF($A${r}<=${serial},${amtCell},0)`;
    } else {
      // Text trigger or no date — always present
      return amtCell;
    }
  });
  return parts.join('+');
}

// ---------------------------------------------------------------------------
// One-Time Charges bordered box (right of assumptions block, cols E–G rows 4+)
// ---------------------------------------------------------------------------

/**
 * Write a self-contained bordered OTC box into the worksheet at the given position.
 * Returns the cell address of the TOTAL formula cell, or null if no charges.
 *
 * @param {Object}   ws             - xlsx worksheet object (mutated in-place)
 * @param {Array}    oneTimeCharges - [{name, amount, date}, ...]
 * @param {number}   startCol       - 0-based column index for first box column (label)
 * @param {number}   startRow       - 1-based row for the header row
 * @returns {string|null}           - e.g. "F6" — address of the SUM total cell
 */
function buildOneTimeChargesBox(ws, oneTimeCharges, startCol, startRow) {
  const charges = Array.isArray(oneTimeCharges) ? oneTimeCharges.filter((c) => c.name) : [];
  if (charges.length === 0) return null;

  const thin = { style: 'thin', color: { rgb: '000000' } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };

  // Header row
  ['One-Time Charge', 'Amount (USD)', 'Incurred / Due Date'].forEach((label, i) => {
    const cell = cHdr(label, C.headerNavy);
    ws[a(startCol + i, startRow)] = { ...cell, s: { ...cell.s, border } };
  });

  // Charge data rows
  charges.forEach((charge, idx) => {
    const r = startRow + 1 + idx;
    const labelCell  = cText(charge.name || '', C.white);
    const amountCell = cInput(Number(charge.amount) || 0, FMT.currency, C.rowOdd);
    const _otcSerial = parseOtcDateSerial(charge.date);
    const dateCell   = _otcSerial !== null
      ? { t: 'n', v: _otcSerial, s: ds(C.white, FMT.date, { fontColor: C.fcCalc }) }
      : cText(charge.date || '', C.white);
    ws[a(startCol,     r)] = { ...labelCell,  s: { ...labelCell.s,  border } };
    ws[a(startCol + 1, r)] = { ...amountCell, s: { ...amountCell.s, border } };
    ws[a(startCol + 2, r)] = { ...dateCell,   s: { ...dateCell.s,   border } };
  });

  // Total row
  const totalRow       = startRow + 1 + charges.length;
  const firstAmtRow    = startRow + 1;
  const lastAmtRow     = startRow + charges.length;
  const amtCol         = col(startCol + 1);
  const sumFormula     = `SUM(${amtCol}${firstAmtRow}:${amtCol}${lastAmtRow})`;
  const sumFallback    = charges.reduce((s, c) => s + (Number(c.amount) || 0), 0);

  const totalLabelCell  = cText('TOTAL', C.totalBg, true);
  const totalAmountCell = cFmla(sumFormula, sumFallback, FMT.currency, C.totalBg, true);
  const totalBlankCell  = cText('', C.totalBg);
  ws[a(startCol,     totalRow)] = { ...totalLabelCell,  s: { ...totalLabelCell.s,  border } };
  ws[a(startCol + 1, totalRow)] = { ...totalAmountCell, s: { ...totalAmountCell.s, border } };
  ws[a(startCol + 2, totalRow)] = { ...totalBlankCell,  s: { ...totalBlankCell.s,  border } };

  return `${amtCol}${totalRow}`;
}

// ---------------------------------------------------------------------------
// Obligation Remaining / Buyout / Renegotiation panel writers (I4:M16)
// ---------------------------------------------------------------------------

/**
 * Write the Obligation Remaining header block at I4:M5
 * and the analysis-date echo at I8.
 */
function writeObligationRemainingPanel(ws, rows, FDR, lastData, COL_OBL_REM, COL_BASE_REM, COL_NNN_REM, COL_OTC_REM) {
  const xlColI = 8;   // I
  const xlColJ = 9;   // J
  const xlColK = 10;  // K
  const xlColL = 11;  // L
  const xlColM = 12;  // M
  const xlHdrR = ASSUMP_START;      // row 4
  const xlInpR = ASSUMP_START + 1;  // row 5

  const thinBlack = { style: 'thin', color: { rgb: '000000' } };
  const thinPlain = { style: 'thin' };

  const navyHdrBase = {
    font:      { ...FONT_B, color: { rgb: C.white } },
    fill:      { patternType: 'solid', fgColor: { rgb: C.headerNavy } },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
  };

  // I4 — no fill, no bottom border
  sc(ws, xlColI, xlHdrR, {
    t: 's', v: 'Date of Analysis',
    s: { ...navyHdrBase, fill: { patternType: 'none' }, border: { top: thinBlack, left: thinBlack, right: thinBlack } },
  });
  // J4:M4 — navy headers, thin/black borders all four sides
  const allBlackBorder = { top: thinBlack, bottom: thinBlack, left: thinBlack, right: thinBlack };
  [
    [xlColJ, 'Obligation Remaining — Total'],
    [xlColK, 'Obligation Remaining — Base Rent'],
    [xlColL, 'Obligation Remaining — NNN'],
    [xlColM, 'Obligation Remaining — Other Charges'],
  ].forEach(([c, label]) => {
    sc(ws, c, xlHdrR, { t: 's', v: label, s: { ...navyHdrBase, border: allBlackBorder } });
  });

  // I5 — no fill, black font, center, date format, thin (no-color) borders
  const analysisDateSerial = toSerial(rows[0].periodStart);
  const thinPlainBorder = { top: thinPlain, bottom: thinPlain, left: thinPlain, right: thinPlain };
  sc(ws, xlColI, xlInpR, {
    t: 'n',
    v: analysisDateSerial ?? 0,
    s: {
      font:      { ...FONT, color: { rgb: C.fcCalc } },
      fill:      { patternType: 'none' },
      alignment: { horizontal: 'center', vertical: 'middle' },
      numFmt:    FMT.date,
      border:    thinPlainBorder,
    },
  });

  // INDEX/MATCH replaces XLOOKUP for universal Excel compatibility (Excel 2016 and earlier
  // do not support XLOOKUP). MATCH type 1 = largest value ≤ lookup_value in an
  // ascending-sorted array, which is behaviourally identical to XLOOKUP match_mode -1.
  // The date column (A) is chronologically ascending, so the substitution is exact.
  const xlLookup = (retCol) =>
    `IFERROR(INDEX(${col(retCol)}$${FDR}:${col(retCol)}$${lastData},` +
    `MATCH($I$${xlInpR},$A$${FDR}:$A$${lastData},1)),"")`;

  const currStyle = {
    font:      { ...FONT, color: { rgb: C.fcCalc } },
    fill:      { patternType: 'solid', fgColor: { rgb: C.white } },
    alignment: { horizontal: 'right', vertical: 'middle' },
    numFmt:    '$#,##0',
  };

  // J5 — thin/black borders: top, bottom, right; no left
  sc(ws, xlColJ, xlInpR, {
    t: 'n', v: 0, f: xlLookup(COL_OBL_REM),
    s: { ...currStyle, border: { top: thinBlack, bottom: thinBlack, right: thinBlack } },
  });

  // K5, L5, M5 — thin/black borders all four sides
  [
    [xlColK, COL_BASE_REM],
    [xlColL, COL_NNN_REM],
    [xlColM, COL_OTC_REM],
  ].forEach(([xlCol, retCol]) => {
    sc(ws, xlCol, xlInpR, {
      t: 'n', v: 0, f: xlLookup(retCol),
      s: { ...currStyle, border: allBlackBorder },
    });
  });

  // I8 — fill DEEAF1, black font, center, date format, thin (no-color) borders
  sc(ws, xlColI, 8, {
    t: 'n', v: analysisDateSerial ?? 0, f: '=$I$5',
    s: {
      font:      { ...FONT, color: { rgb: C.fcCalc } },
      fill:      { patternType: 'solid', fgColor: { rgb: 'DEEAF1' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      numFmt:    FMT.date,
      border:    thinPlainBorder,
    },
  });

  // J8, K8, L8 — navy fill, white bold font, center, thin (no-color) borders
  [xlColJ, xlColK, xlColL].forEach((c) => {
    sc(ws, c, 8, {
      t: 's', v: '',
      s: {
        font:      { ...FONT_B, color: { rgb: C.white } },
        fill:      { patternType: 'solid', fgColor: { rgb: C.headerNavy } },
        alignment: { horizontal: 'center', vertical: 'middle' },
        border:    thinPlainBorder,
      },
    });
  });

}

/**
 * Write the Buyout table at I9:L10.
 * Three percentage tiers (20%, 35%, 50%) applied to Base Rent remaining only.
 * Lease buyouts do not include NNN or other charges.
 */
function writeBuyoutTable(ws) {
  const thinPlain = { style: 'thin' };
  const thinPlainBorder = { top: thinPlain, bottom: thinPlain, left: thinPlain, right: thinPlain };

  const navyLabel = (c, r, text) => sc(ws, c, r, {
    t: 's', v: text,
    s: {
      font:      { ...FONT_B, color: { rgb: C.white } },
      fill:      { patternType: 'solid', fgColor: { rgb: C.headerNavy } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      border:    thinPlainBorder,
    },
  });

  // No fill + $#,##0.00 for data formula cells (J10:L10)
  const dataFmla = (c, r, formula) => sc(ws, c, r, {
    t: 'n', v: 0, f: formula,
    s: {
      font:      { ...FONT, color: { rgb: C.fcCalc } },
      fill:      { patternType: 'none' },
      alignment: { horizontal: 'right', vertical: 'middle' },
      numFmt:    '$#,##0.00',
      border:    thinPlainBorder,
    },
  });

  // Row 9 — section header + tier labels (all navy)
  navyLabel(8, 9, 'Buyout');
  navyLabel(9, 9, '20% of remaining obligation');
  navyLabel(10, 9, '35% of remaining obligation');
  navyLabel(11, 9, '50% of remaining obligation');

  // Row 10 — Base Rent only (K5 × tier%)
  navyLabel(8, 10, 'Base Rent');
  dataFmla(9, 10, 'K5*0.2');
  dataFmla(10, 10, 'K5*0.35');
  dataFmla(11, 10, 'K5*0.5');
}

/**
 * Write the Renegotiation table at I13:L14.
 * Three discount scenarios (10%, 30%, 50%) — each column discounts its own component.
 */
function writeRenegotiationTable(ws) {
  const thinPlain = { style: 'thin' };
  const thinPlainBorder = { top: thinPlain, bottom: thinPlain, left: thinPlain, right: thinPlain };

  const navyLabel = (c, r, text) => sc(ws, c, r, {
    t: 's', v: text,
    s: {
      font:      { ...FONT_B, color: { rgb: C.white } },
      fill:      { patternType: 'solid', fgColor: { rgb: C.headerNavy } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      border:    thinPlainBorder,
    },
  });

  // Row 13 — section header + discount labels (all navy)
  navyLabel(8, 13, 'Renegotiation');
  navyLabel(9, 13, '10% discount');
  navyLabel(10, 13, '30% discount');
  navyLabel(11, 13, '50% discount');

  // I14 — fill DEEAF1, black font, center, date format, thin (no-color) borders
  sc(ws, 8, 14, {
    t: 'n', v: 0, f: '=$I$5',
    s: {
      font:      { ...FONT, color: { rgb: C.fcCalc } },
      fill:      { patternType: 'solid', fgColor: { rgb: 'DEEAF1' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      numFmt:    FMT.date,
      border:    thinPlainBorder,
    },
  });

  // J14, K14, L14 — white fill, black font, right, $#,##0.00, thin (no-color) borders
  const currFmla = (c, r, formula) => sc(ws, c, r, {
    t: 'n', v: 0, f: formula,
    s: {
      font:      { ...FONT, color: { rgb: C.fcCalc } },
      fill:      { patternType: 'solid', fgColor: { rgb: C.white } },
      alignment: { horizontal: 'right', vertical: 'middle' },
      numFmt:    '$#,##0.00',
      border:    thinPlainBorder,
    },
  });
  currFmla(9, 14, 'J5*(1-0.1)');
  currFmla(10, 14, 'K5*(1-0.3)');
  currFmla(11, 14, 'L5*(1-0.5)');
}

// ---------------------------------------------------------------------------
// Main ledger builder
// ---------------------------------------------------------------------------

function buildLedger(rows, assump, params) {
  const ws = {};

  const otcCharges         = Array.isArray(params?.oneTimeCharges) ? params.oneTimeCharges : [];
  const filteredOtcCharges = otcCharges.filter((c) => c.name);   // matches box rows
  const isAgg              = (params?.nnnMode ?? assump?.nnnMode) === 'aggregate';

  // Dynamic column indices — aggregate mode compresses CAMS+Ins+Tax into one column
  // OTC charges are now in a separate box (not inline columns), so no n-offset.
  const COL_FIRST_NNN   = 6;  // G — always first NNN column (CAMS or Aggregate)
  const COL_INS         = isAgg ? null : 7;   // H — Insurance (individual only)
  const COL_TAX         = isAgg ? null : 8;   // I — Taxes (individual only)
  const COL_SEC         = isAgg ? 7    : 9;   // H or J — Security
  const COL_OTHER       = isAgg ? 8    : 10;  // I or K — Other Items
  const COL_NNN         = isAgg ? 9    : 11;  // Total NNN ①
  const COL_TOTAL_MO    = COL_NNN + 1;
  const COL_SF          = COL_NNN + 2;
  const COL_OBL_REM     = COL_NNN + 3;
  const COL_BASE_REM    = COL_NNN + 4;
  const COL_NNN_REM     = COL_NNN + 5;
  const COL_OTC_REM     = COL_NNN + 6;  // OTC Remaining (references box total)
  const MAX_COL         = COL_OTC_REM;

  // Assumption cell references (all +2 from previous layout due to title row insertion)
  // $C$4 = SF, $C$7 = Year1BaseRent, $C$8 = AnnualEscRate
  // $C$10 = AbatementFullMonths, $C$11 = AbatementPartialFactor
  // $C$12 = CAMS/NNNAgg Year1, $C$13 = CAMS/NNNAgg Esc
  // $C$14 = Ins Year1 (individual), $C$15 = Ins Esc (individual)
  // $C$16 = Tax Year1 (individual), $C$17 = Tax Esc (individual)
  // $C$18 = Security Year1, $C$19 = Security Esc
  // $C$20 = OtherItems Year1, $C$21 = OtherItems Esc

  const FDR      = FIRST_DATA_ROW;                   // 25
  const HDR      = HEADER_ROW;                       // 24
  const lastData = FDR + rows.length - 1;            // last monthly data row
  const totRow   = lastData + 1;                     // TOTAL row
  const noteRow  = totRow + 2;                       // footnotes start

  // ── Assumptions block (rows 2–22, cols B–C) ─────────────────────────────
  buildAssumptionsBlock(ws, assump);

  // ── One-Time Charges box (cols E–G, rows 4+, right of assumptions) ───────
  const otcBoxTotalRef = buildOneTimeChargesBox(ws, otcCharges, 4, ASSUMP_START);

  // ── Obligation Remaining panel (cols I–M, rows 4–5) ─────────────────────
  // ── Buyout table (cols I–L, rows 9–10) ─────────────────────────────────
  // ── Renegotiation table (cols I–L, rows 13–14) ─────────────────────────
  // ── Analysis date echo at I8 ───────────────────────────────────────────
  writeObligationRemainingPanel(ws, rows, FDR, lastData, COL_OBL_REM, COL_BASE_REM, COL_NNN_REM, COL_OTC_REM);
  writeBuyoutTable(ws);
  writeRenegotiationTable(ws);

  // ── Header row ──────────────────────────────────────────────────────────
  const fixedHeaders = [
    'Period Start', 'Period End', 'Month #', 'Year #',
    'Scheduled\nBase Rent', 'Base Rent\nApplied',
  ];
  fixedHeaders.forEach((h, ci) => sc(ws, ci, HDR, cHdr(h, C.headerNavy)));

  if (isAgg) {
    sc(ws, COL_FIRST_NNN, HDR, cHdr('NNN —\nAggregate Est.', C.headerNavy));
  } else {
    sc(ws, COL_FIRST_NNN, HDR, cHdr('CAMS', C.headerNavy));
    sc(ws, COL_INS,       HDR, cHdr('Insurance', C.headerNavy));
    sc(ws, COL_TAX,       HDR, cHdr('Taxes', C.headerNavy));
  }
  sc(ws, COL_SEC,   HDR, cHdr('Security', C.headerNavy));
  sc(ws, COL_OTHER, HDR, cHdr('Other Items', C.headerNavy));

  // Remaining headers (no OTC inline columns)
  [
    'Total NNN ①',
    'Total Monthly\nObligation ②',
    'Effective $/SF',
    'Obligation\nRemaining',
    'Base Rent\nRemaining',
    'NNN\nRemaining',
    'OTC\nRemaining',
  ].forEach((h, i) => sc(ws, COL_NNN + i, HDR, cHdr(h, C.headerNavy)));

  // ── Data rows ────────────────────────────────────────────────────────────
  rows.forEach((row, idx) => {
    const r = FDR + idx;

    const rowFill = row.isAbatementRow
      ? C.amber
      : idx % 2 === 0 ? C.rowEven : C.rowOdd;

    // Fix 3: net/obligation columns always get soft red-pink fill
    const nnnFill = C.softRedPink;

    const lm = row.leaseMonth ?? row['Month #'] ?? 0;
    const ly = row.leaseYear  ?? row['Year #']  ?? 0;

    // ── A, B — Dates: BLACK text (Fix 3) ────────────────────────────────
    sc(ws, 0, r, cDate(row.periodStart, rowFill));
    sc(ws, 1, r, cDate(row.periodEnd,   rowFill));

    // ── C, D — Month #, Year # ───────────────────────────────────────────
    sc(ws, 2, r, cInt(lm, rowFill));
    sc(ws, 3, r, cInt(ly, rowFill));

    // ── E — Scheduled Base Rent: BLACK formula referencing $C$7, $C$8 ───
    // $C$7 = Year1BaseRent, $C$8 = AnnualEscRate
    sc(ws, 4, r, cFmla(
      `$C$7*(1+$C$8)^(D${r}-1)`,
      row.scheduledBaseRent ?? 0,
      FMT.currency,
      rowFill,
    ));

    // ── F — Base Rent Applied: BLACK formula, red-pink fill ──────────────
    // $C$10 = AbatementFullMonths, $C$11 = AbatementPartialFactor
    sc(ws, 5, r, cFmla(
      `IF(C${r}<=$C$10,0,IF(C${r}=$C$10+1,E${r}*$C$11,E${r}))`,
      row.baseRentApplied ?? 0,
      FMT.currency,
      nnnFill,
    ));

    // ── NNN columns: BLACK formula, red-pink fill ────────────────────────
    if (isAgg) {
      // Single aggregate NNN column at COL_FIRST_NNN (G)
      // $C$12 = NNNAgg Year1, $C$13 = NNNAgg Esc
      sc(ws, COL_FIRST_NNN, r, cFmla(
        `$C$12*(1+$C$13)^(D${r}-1)`,
        row.nnnAggregateAmount ?? 0, FMT.currency, nnnFill,
      ));
    } else {
      // Individual: G=CAMS($C$12), H=Ins($C$14), I=Tax($C$16)
      sc(ws, COL_FIRST_NNN, r, cFmla(`$C$12*(1+$C$13)^(D${r}-1)`, row.camsAmount      ?? 0, FMT.currency, nnnFill));
      sc(ws, COL_INS,       r, cFmla(`$C$14*(1+$C$15)^(D${r}-1)`, row.insuranceAmount ?? 0, FMT.currency, nnnFill));
      sc(ws, COL_TAX,       r, cFmla(`$C$16*(1+$C$17)^(D${r}-1)`, row.taxesAmount     ?? 0, FMT.currency, nnnFill));
    }
    // Security ($C$18) and Other Items ($C$20) same position in both modes
    sc(ws, COL_SEC,   r, cFmla(`$C$18*(1+$C$19)^(D${r}-1)`, row.securityAmount   ?? 0, FMT.currency, nnnFill));
    sc(ws, COL_OTHER, r, cFmla(`$C$20*(1+$C$21)^(D${r}-1)`, row.otherItemsAmount ?? 0, FMT.currency, nnnFill));

    // ── Total NNN ①: BLACK formula ─────────────────────────────────────
    const nnnFallback = row.totalNNNAmount ?? 0;
    const nnnLetter   = col(COL_NNN);
    const nnnFormula  = isAgg
      ? `${col(COL_FIRST_NNN)}${r}+${col(COL_SEC)}${r}+${col(COL_OTHER)}${r}`
      : `${col(COL_FIRST_NNN)}${r}+${col(COL_INS)}${r}+${col(COL_TAX)}${r}+${col(COL_SEC)}${r}+${col(COL_OTHER)}${r}`;
    sc(ws, COL_NNN, r, cFmla(nnnFormula, nnnFallback, FMT.currency, nnnFill));

    // ── Total Monthly Obligation ②: BLACK formula (base rent + NNN only) ─
    const moFormula = `F${r}+${nnnLetter}${r}`;
    sc(ws, COL_TOTAL_MO, r, cFmla(moFormula, row.totalMonthlyObligation ?? 0, FMT.currency, rowFill));

    // ── Effective $/SF: BLACK formula referencing $C$4 (SF) ─────────────
    const moLetter = col(COL_TOTAL_MO);
    sc(ws, COL_SF, r, cFmla(
      `IF($C$4=0,0,${moLetter}${r}/$C$4)`,
      row.effectivePerSF ?? 0,
      FMT.sf,
      rowFill,
    ));

    // ── OTC Remaining: SUMPRODUCT over the full OTC table range ─────────────
    // $F$5:$F$17 = amounts; $G$5:$G$17 = due dates (Excel date serials).
    // Charges whose due date ≥ this row's Period Start are included; past charges = 0.
    // Empty/unused OTC rows contribute 0 (F=0). Text-trigger dates (non-parseable)
    // evaluate as text > number = TRUE in Excel → always included, which is correct.
    const otcRemLetter = col(COL_OTC_REM);
    sc(ws, COL_OTC_REM, r, cFmla(
      `SUMPRODUCT(($F$5:$F$17)*($G$5:$G$17>=$A${r}))`,
      0,
      FMT.currency,
      rowFill,
    ));

    // ── Obligation Remaining: tail-sum of monthly obligation + period-linked OTC ─
    // MAX(..., 0) enforces hard constraint: total remaining obligation never negative.
    const oblFormula = filteredOtcCharges.length > 0
      ? `MAX(SUM(${moLetter}${r}:${moLetter}${lastData})+${otcRemLetter}${r},0)`
      : `SUM(${moLetter}${r}:${moLetter}${lastData})`;
    sc(ws, COL_OBL_REM,  r, cFmla(oblFormula, row.totalObligationRemaining ?? 0, FMT.currency, rowFill));
    sc(ws, COL_BASE_REM, r, cFmla(`SUM(F${r}:F${lastData})`,                       row.totalBaseRentRemaining ?? 0, FMT.currency, rowFill));
    sc(ws, COL_NNN_REM,  r, cFmla(`SUM(${nnnLetter}${r}:${nnnLetter}${lastData})`, row.totalNNNRemaining      ?? 0, FMT.currency, rowFill));
  });

  // ── Totals row ────────────────────────────────────────────────────────────
  const sum = (letter) => `SUM(${letter}${FDR}:${letter}${lastData})`;

  sc(ws, 0, totRow, cTotalLabel('TOTAL'));
  sc(ws, 1, totRow, cBlankTotal());
  sc(ws, 2, totRow, cBlankTotal());
  sc(ws, 3, totRow, cBlankTotal());
  sc(ws, 4, totRow, cTotal(sum('E'), 0, FMT.currency));
  sc(ws, 5, totRow, cTotal(sum('F'), 0, FMT.currency));
  sc(ws, COL_FIRST_NNN, totRow, cTotal(sum(col(COL_FIRST_NNN)), 0, FMT.currency));
  if (!isAgg) {
    sc(ws, COL_INS, totRow, cTotal(sum(col(COL_INS)), 0, FMT.currency));
    sc(ws, COL_TAX, totRow, cTotal(sum(col(COL_TAX)), 0, FMT.currency));
  }
  sc(ws, COL_SEC,      totRow, cTotal(sum(col(COL_SEC)),      0, FMT.currency));
  sc(ws, COL_OTHER,    totRow, cTotal(sum(col(COL_OTHER)),    0, FMT.currency));
  sc(ws, COL_NNN,      totRow, cTotal(sum(col(COL_NNN)),      0, FMT.currency));
  sc(ws, COL_TOTAL_MO, totRow, cTotal(sum(col(COL_TOTAL_MO)), 0, FMT.currency));
  sc(ws, COL_SF,       totRow, cBlankTotal());
  sc(ws, COL_OBL_REM,  totRow, cBlankTotal());
  sc(ws, COL_BASE_REM, totRow, cBlankTotal());
  sc(ws, COL_NNN_REM,  totRow, cBlankTotal());
  sc(ws, COL_OTC_REM,  totRow, cBlankTotal());

  // ── Formula footnotes ─────────────────────────────────────────────────────
  const noteStyle = {
    font:      { ...FONT_SM, italic: true, color: { rgb: '555555' } },
    fill:      { patternType: 'solid', fgColor: { rgb: C.note } },
    alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
    numFmt:    FMT.text,
  };
  const nnnDesc = isAgg
    ? 'NNN Aggregate Estimate + Security + Other Items'
    : 'CAMS+Insurance+Taxes+Security+Other Items';
  sc(ws, 0, noteRow,
    { t: 's', v: `① Total NNN (col ${col(COL_NNN)}) = ${nnnDesc} — formula updates if you edit individual NNN charges.`, s: noteStyle });
  sc(ws, 0, noteRow + 1,
    { t: 's', v: `② Total Monthly Obligation (col ${col(COL_TOTAL_MO)}) = Base Rent Applied + One-Time Charges + Total NNN — formula updates if you edit base rent or NNN charges.`, s: noteStyle });
  sc(ws, 0, noteRow + 2,
    { t: 's', v: `③ Remaining balances (cols ${col(COL_OBL_REM)}–${col(COL_NNN_REM)}) = tail-sum of all future months: SUM(this row → last data row). Automatically recalculates if any monthly value is edited.`, s: noteStyle });
  sc(ws, 0, noteRow + 3,
    { t: 's', v: `Color guide: Blue text = direct inputs (assumption cells B4:C21; One-Time Charge amounts in box E4:G${ASSUMP_START + otcCharges.filter(c => c.name).length + 1}) | Black text = formula outputs | Red-pink fill = net/obligation columns | Amber rows = abatement periods.`, s: noteStyle });

  // ── Sheet metadata ────────────────────────────────────────────────────────
  // Column widths derived from the reference template (Need_extract_format.xlsx).
  // Individual mode: 18 columns A–R; Aggregate mode: 16 columns A–P.
  const allWidths = isAgg
    ? [14, 36, 17, 10, 40, 21, 33, 16, 20, 23, 21, 17, 15, 23, 21, 17]
    : [14, 36, 17, 10, 40, 21, 33, 16, 20, 35, 41, 34, 46, 15, 23, 21, 17, 15];
  ws['!cols'] = allWidths.map((w) => ({ wch: w }));

  // Row heights:
  //   row 1: blank
  //   row 2: title (28pt)
  //   row 3: blank spacer
  //   rows 4–21: assumptions (18 rows × 18pt)
  //   row 22: blank separator
  //   row 23: column header (44pt)
  const rowHeights = [
    {},            // row 1 — blank
    { hpt: 28 },   // row 2 — title
    {},            // row 3 — spacer
    ...Array(18).fill({ hpt: 18 }),  // rows 4–21 — assumptions (18 rows)
    {},            // row 22 — blank separator
    { hpt: 44 },   // row 23 — header
  ];
  ws['!rows'] = rowHeights;

  // Freeze rows 1–23 and columns A–D
  ws['!views']      = [{ state: 'frozen', ySplit: HDR, xSplit: 4 }];
  ws['!autofilter'] = { ref: `A${HDR}:${col(MAX_COL)}${HDR}` };

  setRef(ws, MAX_COL, noteRow + 3);
  return ws;
}

// ===========================================================================
// Sheet 2 — Annual Summary (SUMIF/COUNTIF cross-sheet formulas)
// ===========================================================================

const SUMMARY_HEADERS = [
  'Period Start', 'Period End', 'Lease Year', 'Months',
  'Base Rent Applied', 'Total NNN',
  'Total Monthly Obligation', '% of Grand Total',
];

function buildAnnualSummary(rows, params) {
  const ws = {};
  const years = [...new Set(
    rows.map((r) => r.leaseYear ?? r['Year #']).filter(Boolean)
  )].sort((a, b) => a - b);

  const isAgg = (params?.nnnMode) === 'aggregate';
  // NNN total column (no OTC offset in new layout)
  const nnnColLetter = col(isAgg ? 9 : 11);
  const moColLetter  = col(isAgg ? 10 : 12);

  const firstLedger = FIRST_DATA_ROW;
  const lastLedger  = FIRST_DATA_ROW + rows.length - 1;

  const LS   = "'Lease Schedule'";
  const Dabs = `${LS}!$D$${firstLedger}:$D$${lastLedger}`;
  const Fabs = `${LS}!$F$${firstLedger}:$F$${lastLedger}`;
  const Labs = `${LS}!$${nnnColLetter}$${firstLedger}:$${nnnColLetter}$${lastLedger}`;
  const Mabs = `${LS}!$${moColLetter}$${firstLedger}:$${moColLetter}$${lastLedger}`;

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

  // New layout: 8 columns — Period Start | Period End | Lease Year | Months |
  //             Base Rent Applied | Total NNN | Total Monthly Obligation | % of Grand Total
  SUMMARY_HEADERS.forEach((h, ci) => sc(ws, ci, 1, cHdr(h, C.headerBlue)));

  years.forEach((year, idx) => {
    const r       = idx + 2;
    const fill    = idx % 2 === 0 ? C.rowEven : C.rowOdd;
    const isStub  = (yearMonthCount[year] ?? 12) < 12;
    const totGref = `G${years.length + 2}`;

    // Col A (0): Period Start date
    sc(ws, 0, r, cDate(yearDateMap[year]?.start, fill));
    // Col B (1): Period End date
    sc(ws, 1, r, cDate(yearDateMap[year]?.end, fill));
    // Col C (2): Lease Year — integer, with "(Stub)" suffix if partial year
    sc(ws, 2, r, isStub
      ? cText(`${year} (Stub)`, fill, false, 'center')
      : cInt(year, fill));
    // Cols D-G use literal year integer in SUMIF/COUNTIF so col C text doesn't interfere
    sc(ws, 3, r, cXSheet(`COUNTIF(${Dabs},${year})`,        yearMonthCount[year] ?? 12, FMT.int,      fill));
    sc(ws, 4, r, cXSheet(`SUMIF(${Dabs},${year},${Fabs})`,  0,                          FMT.currency, fill));
    sc(ws, 5, r, cXSheet(`SUMIF(${Dabs},${year},${Labs})`,  0,                          FMT.currency, fill));
    sc(ws, 6, r, cXSheet(`SUMIF(${Dabs},${year},${Mabs})`,  0,                          FMT.currency, fill));
    sc(ws, 7, r, cFmla(`IF(${totGref}=0,0,G${r}/${totGref})`, 0,                        FMT.pct,      fill));
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
// Sheet 3 — Audit Trail (unchanged)
// ===========================================================================

const AUDIT_HEADERS = [
  'Period Start', 'Month #',
  'Period Factor', 'Proration Factor', 'Proration Basis',
  'CAMS Esc Year', 'CAMS Active',
  'Ins Esc Year', 'Ins Active',
  'Tax Esc Year', 'Tax Active',
  'Sec Esc Year', 'Sec Active',
  'Other Esc Year', 'Other Active',
];

const AUDIT_WIDTHS = [
  13, 9,
  14, 16, 20,
  13, 11,
  13, 11,
  13, 11,
  13, 11,
  14, 11,
];

function buildAuditTrail(rows) {
  const ws = {};

  AUDIT_HEADERS.forEach((h, ci) => sc(ws, ci, 1, cHdr(h, C.headerPurple)));

  rows.forEach((row, idx) => {
    const r    = idx + 2;
    const fill = idx % 2 === 0 ? C.rowEven : C.rowOdd;

    sc(ws,  0, r, cDate(row.periodStart, fill));
    sc(ws,  1, r, cInt(row.leaseMonth ?? row['Month #'] ?? 0, fill, false, C.fcInput));
    sc(ws,  2, r, cInput(row.periodFactor            ?? 1, FMT.factor, fill));
    sc(ws,  3, r, cInput(row.baseRentProrationFactor ?? 1, FMT.factor, fill));
    sc(ws,  4, r, cText(row.prorationBasis ?? '', fill, false, 'center', C.fcInput));
    sc(ws,  5, r, cInt(row.camsEscYears      ?? 0, fill, false, C.fcInput));
    sc(ws,  6, r, cText(String(row.camsActive      ?? ''), fill, false, 'center', C.fcInput));
    sc(ws,  7, r, cInt(row.insuranceEscYears ?? 0, fill, false, C.fcInput));
    sc(ws,  8, r, cText(String(row.insuranceActive ?? ''), fill, false, 'center', C.fcInput));
    sc(ws,  9, r, cInt(row.taxesEscYears     ?? 0, fill, false, C.fcInput));
    sc(ws, 10, r, cText(String(row.taxesActive     ?? ''), fill, false, 'center', C.fcInput));
    sc(ws, 11, r, cInt(row.securityEscYears  ?? 0, fill, false, C.fcInput));
    sc(ws, 12, r, cText(String(row.securityActive  ?? ''), fill, false, 'center', C.fcInput));
    sc(ws, 13, r, cInt(row.otherItemsEscYears ?? 0, fill, false, C.fcInput));
    sc(ws, 14, r, cText(String(row.otherItemsActive ?? ''), fill, false, 'center', C.fcInput));
  });

  ws['!cols']  = AUDIT_WIDTHS.map((w) => ({ wch: w }));
  ws['!rows']  = [{ hpt: 40 }];
  ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
  setRef(ws, 14, rows.length + 1);
  return ws;
}

// ===========================================================================
// Public exports
// ===========================================================================

/**
 * Export the full ledger to a professionally styled XLSX workbook.
 *
 * @param {Object[]} rows     - Processed ledger rows from calculator.js.
 * @param {Object}   params   - Calculator params (squareFootage, cams, insurance,
 *                              taxes, security, otherItems, blendedNNN, oneTimeCharges).
 *                              Pass {} if unavailable.
 * @param {string}   filename - Base filename without extension.
 */
export function exportToXLSX(rows, params = {}, filename = 'lease-schedule') {
  const wb = XLSX.utils.book_new();
  wb.Props = {
    Title:       'Lease Schedule',
    Author:      'DEODATE Lease Schedule Engine',
    CreatedDate: new Date(),
  };

  const assump = computeAssumptions(rows, params);

  XLSX.utils.book_append_sheet(wb, buildLedger(rows, assump, params),    'Lease Schedule');
  XLSX.utils.book_append_sheet(wb, buildAnnualSummary(rows, params),     'Annual Summary');
  XLSX.utils.book_append_sheet(wb, buildAuditTrail(rows),                'Audit Trail');

  const xlsxBytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

  // Unzip the XLSX package (XLSX files are ZIP archives)
  const unzipped = unzipSync(new Uint8Array(xlsxBytes));

  // Inject dataValidation XML into the Lease Schedule sheet
  const sheetKey = 'xl/worksheets/sheet1.xml';
  if (unzipped[sheetKey]) {
    let xml = strFromU8(unzipped[sheetKey]);
    const lastDataRow = FIRST_DATA_ROW + rows.length - 1;
    const dvXml =
      `<dataValidations count="1">` +
      `<dataValidation type="list" sqref="I5" showDropDown="0" ` +
      `showErrorMessage="0" showInputMessage="0">` +
      `<formula1>$A${FIRST_DATA_ROW}:$A${lastDataRow}</formula1>` +
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

/**
 * Export standard columns to a plain CSV (raw numeric values, no formatting).
 */
export function exportToCSV(rows, filename = 'lease-schedule') {
  const COLS = [
    { key: 'periodStart',              label: 'Period Start' },
    { key: 'periodEnd',                label: 'Period End' },
    { key: 'leaseYear',                label: 'Lease Year #' },
    { key: 'leaseMonth',               label: 'Lease Month #' },
    { key: 'scheduledBaseRent',        label: 'Scheduled Base Rent ($)' },
    { key: 'baseRentApplied',          label: 'Base Rent Applied ($)' },
    { key: 'camsAmount',               label: 'CAMS ($)' },
    { key: 'insuranceAmount',          label: 'Insurance ($)' },
    { key: 'taxesAmount',              label: 'Taxes ($)' },
    { key: 'securityAmount',           label: 'Security ($)' },
    { key: 'otherItemsAmount',         label: 'Other Items ($)' },
    { key: 'totalMonthlyObligation',   label: 'Total Monthly Obligation ($)' },
    { key: 'effectivePerSF',           label: 'Effective $/SF' },
    { key: 'totalObligationRemaining', label: 'Total Obligation Remaining ($)' },
    { key: 'totalNNNRemaining',        label: 'Total NNN Remaining ($)' },
    { key: 'totalBaseRentRemaining',   label: 'Total Base Rent Remaining ($)' },
  ];

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
