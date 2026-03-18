/**
 * @fileoverview Professional XLSX export with full formatting and live formulas.
 *
 * Row layout — Lease Schedule tab:
 *   Row  1        : title (merged A1:R1)
 *   Row  2        : subtitle (merged A2:R2)
 *   Row  3        : generated date (merged A3:R3)
 *   Row  4        : blank
 *   Rows 5–22     : assumptions block (B = label, C = value)
 *   Row  23       : blank separator
 *   Row  24       : column headers
 *   Row  25+      : monthly data rows
 *
 * Assumption cell addresses (col C):
 *   $C$5  Rentable SF                          INPUT (blue)
 *   $C$6  Lease Commencement Date              CALC  (black)
 *   $C$7  Lease Expiration Date                CALC  (black)
 *   $C$8  Year 1 Monthly Base Rent             INPUT (blue)
 *   $C$9  Annual Base Rent Escalation Rate     INPUT (blue)
 *   $C$10 Lease Anniversary Month              CALC  (black)
 *   $C$11 Abatement Full-Month Count           CALC  (black)
 *   $C$12 Abatement Partial-Month Factor       CALC  (black)
 *   $C$13 CAMS Year 1 Monthly Amount             INPUT (blue)
 *   $C$14 CAMS Annual Escalation Rate (%)       INPUT (blue)
 *   $C$15 Insurance Year 1 Monthly Amount       INPUT (blue)
 *   $C$16 Insurance Annual Escalation Rate (%)  INPUT (blue)
 *   $C$17 Taxes Year 1 Monthly Amount           INPUT (blue)
 *   $C$18 Taxes Annual Escalation Rate (%)      INPUT (blue)
 *   $C$19 Security Year 1 Monthly Amount        INPUT (blue)
 *   $C$20 Security Annual Escalation Rate (%)   INPUT (blue)
 *   $C$21 Other Items Year 1 Monthly Amount     INPUT (blue)
 *   $C$22 Other Items Annual Escalation Rate (%) INPUT (blue)
 *
 * Column layout (0-based → letter):
 *   0  A  Period Start
 *   1  B  Period End
 *   2  C  Month #
 *   3  D  Year #
 *   4  E  Scheduled Base Rent      FORMULA  =$C$8*(1+$C$9)^(D{r}-1)
 *   5  F  Base Rent Applied        FORMULA  abatement IF referencing $C$11, $C$12
 *   6  G  CAMS                     FORMULA  =$C$13*(1+$C$14)^(D{r}-1)
 *   7  H  Insurance                FORMULA  =$C$15*(1+$C$16)^(D{r}-1)
 *   8  I  Taxes                    FORMULA  =$C$17*(1+$C$18)^(D{r}-1)
 *   9  J  Security                 FORMULA  =$C$19*(1+$C$20)^(D{r}-1)  [Other Charges]
 *  10  K  Other Items              FORMULA  =$C$21*(1+$C$22)^(D{r}-1)  [Other Charges]
 *  11  L  Total NNN ①             FORMULA  =G+H+I  (CAMS+Insurance+Taxes ONLY)
 *  12+ M… One-time charge cols     INPUT    blue hardcoded — one col per named OT item (0..N)
 *   +0  Total Monthly Obl. ②      FORMULA  =F+L+J+K+[OT cols]
 *   +1  Effective $/SF             FORMULA  =IF($C$5=0,0,TotalMonthly/$C$5)
 *   +2  Obligation Remaining       FORMULA  SUM tail of Total Monthly col
 *   +3  Base Rent Remaining        FORMULA  SUM tail of F
 *   +4  NNN Remaining              FORMULA  SUM tail of L
 *   +5  Other Charges Remaining    FORMULA  SUM(J tail)+SUM(K tail)+SUM(each OT col tail)
 *
 * Color conventions:
 *   Blue  (fcInput)     = hard-coded user inputs
 *   Black (fcCalc)      = formula outputs / engine-calculated values
 *   Green (fcCrossSheet)= cross-sheet formulas (Annual Summary)
 *   Navy  (fcTotal)     = totals row
 *   Red-pink fill       = NNN/obligation columns (F–L)
 *   Amber fill          = abatement period rows
 */

import XLSX from 'xlsx-js-style';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import Papa from 'papaparse';

// ===========================================================================
// Row layout constants
// ===========================================================================
//
// Row 1: blank
// Row 2: large bold title (Lease Name)
// Row 3: blank spacer
// Rows 4–21: assumptions block (18 rows)
// Row 22: blank separator
// Row 23: column headers
// Row 24+: monthly data rows

const HEADER_ROW     = 24;
const FIRST_DATA_ROW = 25;

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

/** Hard-coded user input — Blue font. */
function cInput(v, fmt, fill, bold = false) {
  return { t: 'n', v: v ?? 0, s: ds(fill, fmt, { bold, fontColor: C.fcInput }) };
}

/** Engine-calculated value — Black font. */
function cCalc(v, fmt, fill, bold = false) {
  return { t: 'n', v: v ?? 0, s: ds(fill, fmt, { bold, fontColor: C.fcCalc }) };
}

/** Same-sheet formula — Black font. */
function cFmla(formula, fallback, fmt, fill, bold = false) {
  return { t: 'n', v: fallback ?? 0, f: formula, s: ds(fill, fmt, { bold, fontColor: C.fcCalc }) };
}

/** Blue formula — driven by user assumption cells. */
function cFmlaInput(formula, fallback, fmt, fill) {
  return { t: 'n', v: fallback ?? 0, f: formula, s: ds(fill, fmt, { fontColor: C.fcInput }) };
}

/** Cross-sheet formula — Dark-green font. */
function cXSheet(formula, fallback, fmt, fill) {
  return { t: 'n', v: fallback ?? 0, f: formula, s: ds(fill, fmt, { fontColor: C.fcCrossSheet }) };
}

/** Date cell — Black font (derived, not user input). */
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
      camsYear1: 0,       camsEscRate: 0,
      insuranceYear1: 0,  insuranceEscRate: 0,
      taxesYear1: 0,      taxesEscRate: 0,
      securityYear1: 0,   securityEscRate: 0,
      otherItemsYear1: 0, otherItemsEscRate: 0,
    };
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
    anniversaryMonth:      1,
    fullAbatementMonths,
    abatementPartialFactor,
    camsYear1:             Number(params.cams?.year1)         || 0,
    camsEscRate:           (Number(params.cams?.escPct)       || 0) / 100,
    insuranceYear1:        Number(params.insurance?.year1)    || 0,
    insuranceEscRate:      (Number(params.insurance?.escPct)  || 0) / 100,
    taxesYear1:            Number(params.taxes?.year1)        || 0,
    taxesEscRate:          (Number(params.taxes?.escPct)      || 0) / 100,
    securityYear1:         Number(params.security?.year1)     || 0,
    securityEscRate:       (Number(params.security?.escPct)   || 0) / 100,
    otherItemsYear1:       Number(params.otherItems?.year1)   || 0,
    otherItemsEscRate:     (Number(params.otherItems?.escPct) || 0) / 100,
  };
}

// ===========================================================================
// Sheet 1 — Monthly Ledger
// ===========================================================================

// Base headers for columns 0–11 (A–L) — fixed regardless of OT count
const LEDGER_HEADERS_BASE = [
  'Period\nStart', 'Period\nEnd', 'Month\n#', 'Year\n#',
  'Scheduled\nBase Rent', 'Base Rent\nApplied',
  'CAMS', 'Insurance', 'Taxes', 'Security', 'Other\nItems',
  'Total NNN ①',
];
// Tail headers after OT columns
const LEDGER_HEADERS_TAIL = [
  'Total Monthly\nObligation ②',
  'Effective\n$/SF',
  'Obligation\nRemaining', 'Base Rent\nRemaining', 'NNN\nRemaining', 'Other Charges\nRemaining',
];

// Base column widths for columns 0–11 (A–L)
const LEDGER_WIDTHS_BASE = [13, 35, 9, 9, 20, 20, 12, 12, 12, 10, 12, 14];
// Tail column widths (TotalMonthly, EffSF, ObligRem, BaseRem, NNNRem, OtherChargesRem)
const LEDGER_WIDTHS_TAIL = [22, 14, 22, 20, 16, 22];

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

  // Merge title rows across all columns
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: lastCol } },
  ];
}

// ---------------------------------------------------------------------------
// Assumption block writer (rows 5–22)
// ---------------------------------------------------------------------------

function buildAssumptionsBlock(ws, assump) {
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
  const row = (r, label, cell) => {
    sc(ws, 1, r, { t: 's', v: label, s: labelStyle });
    sc(ws, 2, r, { ...cell, s: { ...cell.s, border: assumpBorder } });
  };

  row(5,  'Rentable SF',
      cInput(assump.squareFootage, FMT.int, vFill));           // FIX: was cCalc → now cInput (blue)
  row(6,  'Lease Commencement Date',
      cDate(assump.commencementDate, vFill));
  row(7,  'Lease Expiration Date',
      cDate(assump.expirationDate, vFill));
  row(8,  'Year 1 Monthly Base Rent',
      cInput(assump.year1BaseRent, FMT.currency, vFill));
  row(9,  'Annual Base Rent Escalation Rate (%)',
      cInput(assump.annualEscRate, FMT.pct, vFill));
  row(10, 'Lease Anniversary Month',
      cInput(assump.anniversaryMonth, FMT.int, vFill));
  row(11, 'Abatement Full-Month Count',
      cInput(assump.fullAbatementMonths, FMT.int, vFill));
  row(12, 'Abatement Partial-Month Proration Factor',
      cInput(assump.abatementPartialFactor, FMT.factor, vFill));
  row(13, 'CAMS Year 1 Monthly Amount',
      cInput(assump.camsYear1, FMT.currency, vFill));
  row(14, 'CAMS Annual Escalation Rate (%)',
      cInput(assump.camsEscRate, FMT.pct, vFill));
  row(15, 'Insurance Year 1 Monthly Amount',
      cInput(assump.insuranceYear1, FMT.currency, vFill));
  row(16, 'Insurance Annual Escalation Rate (%)',
      cInput(assump.insuranceEscRate, FMT.pct, vFill));
  row(17, 'Taxes Year 1 Monthly Amount',
      cInput(assump.taxesYear1, FMT.currency, vFill));
  row(18, 'Taxes Annual Escalation Rate (%)',
      cInput(assump.taxesEscRate, FMT.pct, vFill));
  row(19, 'Security Year 1 Monthly Amount',
      cInput(assump.securityYear1, FMT.currency, vFill));
  row(20, 'Security Annual Escalation Rate (%)',
      cInput(assump.securityEscRate, FMT.pct, vFill));
  row(21, 'Other Items Year 1 Monthly Amount',
      cInput(assump.otherItemsYear1, FMT.currency, vFill));
  row(22, 'Other Items Annual Escalation Rate (%)',
      cInput(assump.otherItemsEscRate, FMT.pct, vFill));
}

// ---------------------------------------------------------------------------
// Main ledger builder
// ---------------------------------------------------------------------------

function buildLedger(rows, assump, otLabels, filename) {
  const ws = {};

  const otCount = otLabels.length;

  // Dynamic column indices (all 0-based)
  const OT_START        = 12;                    // first OT column (col M when otCount ≥ 1)
  const TOTAL_MONTHLY   = OT_START + otCount;    // Total Monthly Obligation column
  const EFF_SF          = TOTAL_MONTHLY + 1;     // Effective $/SF
  const OBLIG_REM       = EFF_SF + 1;            // Obligation Remaining
  const BASE_REM        = OBLIG_REM + 1;         // Base Rent Remaining
  const NNN_REM           = BASE_REM + 1;        // NNN Remaining (CAMS+Ins+Taxes tail-sum)
  const OTHER_CHARGES_REM = NNN_REM + 1;         // Other Charges Remaining (Sec+Other+OT tail-sums)
  const LAST_COL          = OTHER_CHARGES_REM;   // = 17 + otCount

  const FDR      = FIRST_DATA_ROW;
  const HDR      = HEADER_ROW;
  const lastData = FDR + rows.length - 1;
  const totRow   = lastData + 1;
  const noteRow  = totRow + 2;

  // Column letter helpers for dynamic columns
  const tmLetter  = col(TOTAL_MONTHLY);
  const sumRng    = (ci) => `SUM(${col(ci)}${FDR}:${col(ci)}${lastData})`;

  // ── Title block (rows 1–3) ───────────────────────────────────────────────
  buildTitleBlock(ws, filename, LAST_COL);

  // ── Assumptions block (rows 5–22, cols B–C) ──────────────────────────────
  buildAssumptionsBlock(ws, assump);

  // ── Header row (row 24) ──────────────────────────────────────────────────
  const headers = [
    ...LEDGER_HEADERS_BASE,
    ...otLabels.map((lbl) => lbl.replace(/(.{16})/g, '$1\n').trim()),  // wrap long labels
    ...LEDGER_HEADERS_TAIL,
  ];
  headers.forEach((h, ci) => sc(ws, ci, HDR, cHdr(h, C.headerNavy)));

  // ── Data rows ────────────────────────────────────────────────────────────
  rows.forEach((row, idx) => {
    const r = FDR + idx;

    const rowFill = row.isAbatementRow
      ? C.amber
      : idx % 2 === 0 ? C.rowEven : C.rowOdd;
    const nnnFill = C.softRedPink;

    const lm = row.leaseMonth ?? row['Month #'] ?? 0;
    const ly = row.leaseYear  ?? row['Year #']  ?? 0;

    // A, B — Dates (black — derived from lease dates)
    sc(ws, 0, r, cDate(row.periodStart, rowFill));
    sc(ws, 1, r, cDate(row.periodEnd,   rowFill));

    // C, D — Month #, Year # (black — sequential, engine-calculated)
    sc(ws, 2, r, cInt(lm, rowFill, false, C.fcCalc));
    sc(ws, 3, r, cInt(ly, rowFill, false, C.fcCalc));

    // E — Scheduled Base Rent: BLACK formula referencing $C$8, $C$9
    sc(ws, 4, r, cFmla(
      `$C$8*(1+$C$9)^(D${r}-1)`,
      row.scheduledBaseRent ?? 0,
      FMT.currency,
      rowFill,
    ));

    // F — Base Rent Applied: BLACK formula referencing $C$11 (abat count), $C$12 (partial factor)
    sc(ws, 5, r, cFmla(
      `IF(C${r}<=$C$11,0,IF(C${r}=$C$11+1,E${r}*$C$12,E${r}))`,
      row.baseRentApplied ?? 0,
      FMT.currency,
      nnnFill,
    ));

    // G–K — NNN charges: BLACK formula cells referencing Year 1 + escalation rate assumptions
    sc(ws, 6,  r, cFmla(`$C$13*(1+$C$14)^(D${r}-1)`, row.camsAmount      ?? 0, FMT.currency, nnnFill));
    sc(ws, 7,  r, cFmla(`$C$15*(1+$C$16)^(D${r}-1)`, row.insuranceAmount  ?? 0, FMT.currency, nnnFill));
    sc(ws, 8,  r, cFmla(`$C$17*(1+$C$18)^(D${r}-1)`, row.taxesAmount      ?? 0, FMT.currency, nnnFill));
    sc(ws, 9,  r, cFmla(`$C$19*(1+$C$20)^(D${r}-1)`, row.securityAmount   ?? 0, FMT.currency, nnnFill));
    sc(ws, 10, r, cFmla(`$C$21*(1+$C$22)^(D${r}-1)`, row.otherItemsAmount ?? 0, FMT.currency, nnnFill));

    // L — Total NNN ①: BLACK formula — CAMS + Insurance + Taxes ONLY
    // Security (J) and Other Items (K) are Other Charges, not NNN.
    const trueNNNFallback =
      (row.camsAmount ?? 0) + (row.insuranceAmount ?? 0) + (row.taxesAmount ?? 0);
    sc(ws, 11, r, cFmla(
      `G${r}+H${r}+I${r}`,
      trueNNNFallback,
      FMT.currency,
      nnnFill,
    ));

    // OT columns (cols OT_START … OT_START+otCount−1): BLUE hardcoded input-driven values
    const otAmounts = row.oneTimeItemAmounts ?? {};
    otLabels.forEach((lbl, j) => {
      const amt = Number(otAmounts[lbl] ?? 0);
      sc(ws, OT_START + j, r, cInput(amt, FMT.currency, rowFill));
    });

    // Total Monthly Obligation ②: BLACK formula
    // = Base Rent Applied (F) + True NNN (L=G+H+I) + Security (J) + Other Items (K) + one-time cols
    const otTerms = otCount > 0
      ? '+' + otLabels.map((_, j) => `${col(OT_START + j)}${r}`).join('+')
      : '';
    sc(ws, TOTAL_MONTHLY, r, cFmla(
      `F${r}+L${r}+J${r}+K${r}${otTerms}`,
      row.totalMonthlyObligation ?? 0,
      FMT.currency,
      rowFill,
    ));

    // Effective $/SF: BLACK formula referencing $C$5 (Rentable SF)
    sc(ws, EFF_SF, r, cFmla(
      `IF($C$5=0,0,${tmLetter}${r}/$C$5)`,
      row.effectivePerSF ?? 0,
      FMT.sf,
      rowFill,
    ));

    // Remaining balances: BLACK tail-sum formulas
    sc(ws, OBLIG_REM, r, cFmla(`SUM(${tmLetter}${r}:${tmLetter}${lastData})`, row.totalObligationRemaining    ?? 0, FMT.currency, rowFill));
    sc(ws, BASE_REM,  r, cFmla(`SUM(F${r}:F${lastData})`,                     row.totalBaseRentRemaining      ?? 0, FMT.currency, rowFill));
    sc(ws, NNN_REM,   r, cFmla(`SUM(L${r}:L${lastData})`,                     row.totalNNNRemaining           ?? 0, FMT.currency, rowFill));

    // Other Charges Remaining = future Security (J) + future Other Items (K) + future one-time cols
    const otherChargesSumParts = [
      `SUM(J${r}:J${lastData})`,
      `SUM(K${r}:K${lastData})`,
      ...otLabels.map((_, j) => `SUM(${col(OT_START + j)}${r}:${col(OT_START + j)}${lastData})`),
    ];
    sc(ws, OTHER_CHARGES_REM, r, cFmla(
      otherChargesSumParts.join('+'),
      row.totalOtherChargesRemaining ?? 0,
      FMT.currency,
      rowFill,
    ));
  });

  // ── Totals row ────────────────────────────────────────────────────────────
  sc(ws, 0, totRow, cTotalLabel('TOTAL'));
  sc(ws, 1, totRow, cBlankTotal());
  sc(ws, 2, totRow, cBlankTotal());
  sc(ws, 3, totRow, cBlankTotal());
  sc(ws, 4, totRow, cTotal(sumRng(4),  0, FMT.currency));   // E — Scheduled Base Rent
  sc(ws, 5, totRow, cTotal(sumRng(5),  0, FMT.currency));   // F — Base Rent Applied
  sc(ws, 6, totRow, cTotal(sumRng(6),  0, FMT.currency));   // G — CAMS
  sc(ws, 7, totRow, cTotal(sumRng(7),  0, FMT.currency));   // H — Insurance
  sc(ws, 8, totRow, cTotal(sumRng(8),  0, FMT.currency));   // I — Taxes
  sc(ws, 9, totRow, cTotal(sumRng(9),  0, FMT.currency));   // J — Security
  sc(ws, 10, totRow, cTotal(sumRng(10), 0, FMT.currency));  // K — Other Items
  sc(ws, 11, totRow, cTotal(sumRng(11), 0, FMT.currency));  // L — Total NNN
  for (let j = 0; j < otCount; j++) {
    sc(ws, OT_START + j, totRow, cTotal(sumRng(OT_START + j), 0, FMT.currency));
  }
  sc(ws, TOTAL_MONTHLY, totRow, cTotal(sumRng(TOTAL_MONTHLY), 0, FMT.currency));
  sc(ws, EFF_SF,        totRow, cBlankTotal());
  sc(ws, OBLIG_REM,     totRow, cBlankTotal());
  sc(ws, BASE_REM,      totRow, cBlankTotal());
  sc(ws, NNN_REM,           totRow, cBlankTotal());
  sc(ws, OTHER_CHARGES_REM, totRow, cBlankTotal());

  // ── Footnotes ─────────────────────────────────────────────────────────────
  const noteStyle = {
    font:      { ...FONT_SM, italic: true, color: { rgb: '555555' } },
    fill:      { patternType: 'solid', fgColor: { rgb: C.note } },
    alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
    numFmt:    FMT.text,
  };
  const tmColName = `col ${tmLetter}`;
  [
    '① Total NNN (col L) = CAMS + Insurance + Taxes ONLY. Security (col J) and Other Items (col K) are classified as Other Charges, not NNN.',
    `② Total Monthly Obligation (${tmColName}) = Base Rent Applied + Total NNN (L) + Security (J) + Other Items (K)${otCount > 0 ? ' + one-time charge columns (blue)' : ''}.`,
    `③ Remaining: Obligation = SUM of future Total Monthly Obligation. Base Rent / NNN / Other Charges = tail-sums of their respective columns. Other Charges Remaining includes Security, Other Items, and all one-time charge columns.`,
    '④ NNN escalation: Year 1 Monthly Amounts in assumption cells C13/C15/C17/C19/C21 are compounded annually by escalation rates in C14/C16/C18/C20/C22. Cols G–K are live formulas — edit assumptions to recalculate.',
    '⑤ Color guide: Blue text = direct user inputs (incl. one-time charge event cells) | Black text = formula outputs | Red-pink fill = NNN/obligation columns | Amber rows = abatement periods.',
  ].forEach((txt, i) => {
    sc(ws, 0, noteRow + i, { t: 's', v: txt, s: noteStyle });
  });

  // ── Sheet metadata ────────────────────────────────────────────────────────
  const colWidths = [
    ...LEDGER_WIDTHS_BASE,
    ...Array(otCount).fill(22),  // one column per OT label
    ...LEDGER_WIDTHS_TAIL,
  ];
  ws['!cols'] = colWidths.map((w) => ({ wch: w }));

  ws['!rows'] = [
    { hpt: 36 },                    // row 1 — title
    { hpt: 16 },                    // row 2 — subtitle
    { hpt: 14 },                    // row 3 — generated date
    {},                              // row 4 — blank
    ...Array(18).fill({ hpt: 18 }), // rows 5–22 — assumption rows
    {},                              // row 23 — blank separator
    { hpt: 44 },                     // row 24 — header
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

function buildAnnualSummary(rows, otCount) {
  const ws = {};
  const years = [...new Set(
    rows.map((r) => r.leaseYear ?? r['Year #']).filter(Boolean)
  )].sort((a, b) => a - b);

  const firstLedger = FIRST_DATA_ROW;                      // 25
  const lastLedger  = FIRST_DATA_ROW + rows.length - 1;

  // Total Monthly Obligation column shifts right with each OT column added
  const totalMonthlyLetter = col(12 + otCount);

  const LS   = "'Lease Schedule'";
  const Dabs = `${LS}!$D$${firstLedger}:$D$${lastLedger}`;
  const Fabs = `${LS}!$F$${firstLedger}:$F$${lastLedger}`;
  const Labs = `${LS}!$L$${firstLedger}:$L$${lastLedger}`;
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

  // New layout: 8 columns — Period Start | Period End | Lease Year | Months |
  //             Base Rent Applied | Total NNN | Total Monthly Obligation | % of Grand Total
  SUMMARY_HEADERS.forEach((h, ci) => sc(ws, ci, 1, cHdr(h, C.headerBlue)));

  years.forEach((year, idx) => {
    const r       = idx + 2;
    const fill    = idx % 2 === 0 ? C.rowEven : C.rowOdd;
    const isStub  = (yearMonthCount[year] ?? 12) < 12;
    const totGref = `G${years.length + 2}`;

    sc(ws, 0, r, cInt(year, fill, false, C.fcInput));
    sc(ws, 1, r, cXSheet(`COUNTIF(${Dabs},${Ar})`,        12, FMT.int,      fill));
    sc(ws, 2, r, cXSheet(`SUMIF(${Dabs},${Ar},${Fabs})`,   0, FMT.currency, fill));
    sc(ws, 3, r, cXSheet(`SUMIF(${Dabs},${Ar},${Labs})`,   0, FMT.currency, fill));
    sc(ws, 4, r, cXSheet(`SUMIF(${Dabs},${Ar},${Nabs})`,   0, FMT.currency, fill));
    sc(ws, 5, r, cFmla(`IF(${totE}=0,0,E${r}/${totE})`,    0, FMT.pct,      fill));
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
  13, 9, 14, 16, 20,
  13, 11, 13, 11, 13, 11, 13, 11, 14, 11,
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

export function exportToXLSX(rows, params = {}, filename = 'lease-schedule') {
  const wb = XLSX.utils.book_new();
  wb.Props = {
    Title:       'Lease Schedule',
    Author:      'DEODATE Lease Schedule Engine',
    CreatedDate: new Date(),
  };

  const assump = computeAssumptions(rows, params);

  // Derive OT labels from the processed rows — the calculator has already assigned
  // oneTimeItemAmounts to every row, so this is the authoritative source regardless
  // of whether params.oneTimeItems was forwarded correctly.
  // Scan in row order so labels appear left-to-right by first occurrence (chronological).
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

  XLSX.utils.book_append_sheet(wb, buildLedger(rows, assump, otLabels, filename), 'Lease Schedule');
  XLSX.utils.book_append_sheet(wb, buildAnnualSummary(rows, otLabels.length),    'Annual Summary');
  XLSX.utils.book_append_sheet(wb, buildAuditTrail(rows),                         'Audit Trail');

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
    { key: 'oneTimeChargesAmount',     label: 'One-time Charges ($)' },
    { key: 'totalMonthlyObligation',   label: 'Total Monthly Obligation ($)' },
    { key: 'effectivePerSF',           label: 'Effective $/SF' },
    { key: 'totalObligationRemaining',   label: 'Total Obligation Remaining ($)' },
    { key: 'totalBaseRentRemaining',     label: 'Base Rent Remaining ($)' },
    { key: 'totalNNNRemaining',          label: 'NNN Remaining ($)' },
    { key: 'totalOtherChargesRemaining', label: 'Other Charges Remaining ($)' },
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
