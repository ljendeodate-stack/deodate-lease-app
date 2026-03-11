/**
 * @fileoverview Professional XLSX export with full formatting and live formulas.
 *
 * Uses xlsx-js-style (SheetJS fork with cell styling support).
 * Produces a three-sheet workbook:
 *
 *   "Lease Schedule"  — assumptions block (B2:C14) + monthly ledger.
 *                       Every formula traces back to a labeled assumption cell.
 *                       Columns L and M are Excel formulas:
 *                         ① Total NNN        = CAMS + Insurance + Taxes + Security + Other
 *                         ② Total Monthly    = Base Rent Applied + Total NNN
 *                       Bottom row: SUM formulas for every numeric column.
 *
 *   "Annual Summary"  — one row per lease year; every value is a SUMIF/COUNTIF
 *                       formula referencing the Lease Schedule sheet.
 *
 *   "Audit Trail"     — proration factors and escalation indexes (plain data).
 *
 * Row layout — Lease Schedule tab:
 *   Row  1        : blank
 *   Rows 2–14     : assumptions block (B = label, C = value)
 *   Row  15       : blank separator
 *   Row  16       : column headers
 *   Row  17+      : monthly data rows
 */

import XLSX from 'xlsx-js-style';
import Papa from 'papaparse';

// ===========================================================================
// Row layout constants  (referenced by both buildLedger and buildAnnualSummary)
// ===========================================================================

const HEADER_ROW     = 16;   // column-header row
const FIRST_DATA_ROW = 17;   // first monthly data row

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
 * Derive the 13 assumption values from processed rows and calculator params.
 * These populate the assumptions block (B2:C14) in the Lease Schedule tab.
 */
function computeAssumptions(rows, params) {
  if (!rows || !rows.length) {
    return {
      squareFootage: 0, commencementDate: null, expirationDate: null,
      year1BaseRent: 0, annualEscRate: 0, anniversaryMonth: 1,
      fullAbatementMonths: 0, abatementPartialFactor: 1,
      camsYear1: 0, insuranceYear1: 0, taxesYear1: 0, securityYear1: 0, otherItemsYear1: 0,
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

  return {
    squareFootage:         Number(params.squareFootage) || 0,
    commencementDate:      firstRow.periodStart ?? null,
    expirationDate:        lastRow.periodEnd    ?? null,
    year1BaseRent,
    annualEscRate,
    anniversaryMonth:      1,   // Year # = Math.floor(idx/12)+1 → always increments at month 1
    fullAbatementMonths,
    abatementPartialFactor,
    camsYear1:             Number(params.cams?.year1)       || 0,
    insuranceYear1:        Number(params.insurance?.year1)  || 0,
    taxesYear1:            Number(params.taxes?.year1)      || 0,
    securityYear1:         Number(params.security?.year1)   || 0,
    otherItemsYear1:       Number(params.otherItems?.year1) || 0,
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
//  4  E  Scheduled Base Rent     ← FORMULA  =$C$5*(1+$C$6)^(D{r}-1)
//  5  F  Base Rent Applied       ← FORMULA  abatement IF referencing $C$8, $C$9
//  6  G  CAMS
//  7  H  Insurance
//  8  I  Taxes
//  9  J  Security
// 10  K  Other Items
// 11  L  Total NNN ①            ← FORMULA  =G+H+I+J+K
// 12  M  Total Monthly Obl. ②  ← FORMULA  =F+L
// 13  N  Effective $/SF          ← FORMULA  =IF($C$2=0,0,M{r}/$C$2)
// 14  O  Total Obligation Remaining  ← FORMULA  SUM tail
// 15  P  Base Rent Remaining         ← FORMULA  SUM tail
// 16  Q  NNN Remaining               ← FORMULA  SUM tail
//
// Fix 3 — fill convention:
//   softRedPink fill: cols F, G, H, I, J, K, L  (net/obligation columns)
//   row-alternating / amber fill: all other columns

const LEDGER_HEADERS = [
  'Period Start', 'Period End', 'Month #', 'Year #',
  'Scheduled\nBase Rent', 'Base Rent\nApplied',
  'CAMS', 'Insurance', 'Taxes', 'Security', 'Other Items',
  'Total NNN ①', 'Total Monthly\nObligation ②',
  'Effective $/SF',
  'Obligation\nRemaining', 'Base Rent\nRemaining', 'NNN\nRemaining',
];

// Column B widened to 35 to accommodate assumption labels in rows 2–14
const LEDGER_WIDTHS = [
  13, 35, 16, 9,
  20, 20,
  12, 12, 12, 10, 12,
  14, 22,
  14,
  22, 20, 16,
];

// ---------------------------------------------------------------------------
// Assumption block writer
// ---------------------------------------------------------------------------

function buildAssumptionsBlock(ws, assump) {
  const labelStyle = {
    font:      { ...FONT_B, color: { rgb: '1F3864' } },
    fill:      { patternType: 'solid', fgColor: { rgb: C.assumpLabel } },
    alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
    border: {
      bottom: { style: 'thin', color: { rgb: 'B0B0B0' } },
      right:  { style: 'thin', color: { rgb: 'B0B0B0' } },
    },
    numFmt: FMT.text,
  };

  const vFill = C.white;

  const row = (r, label, cell) => {
    sc(ws, 1, r, { t: 's', v: label, s: labelStyle });
    sc(ws, 2, r, cell);
  };

  // Fix 1: 13 clearly labeled assumption rows starting at B2
  row(2,  'Rentable SF',
      cCalc(assump.squareFootage, FMT.int, vFill));
  row(3,  'Lease Commencement Date',
      cDate(assump.commencementDate, vFill));
  row(4,  'Lease Expiration Date',
      cDate(assump.expirationDate, vFill));
  row(5,  'Year 1 Monthly Base Rent',
      cInput(assump.year1BaseRent, FMT.currency, vFill));
  row(6,  'Annual Base Rent Escalation Rate (%)',
      cInput(assump.annualEscRate, FMT.pct, vFill));
  row(7,  'Lease Anniversary Month',
      cCalc(assump.anniversaryMonth, FMT.int, vFill));
  row(8,  'Abatement Full-Month Count',
      cCalc(assump.fullAbatementMonths, FMT.int, vFill));
  row(9,  'Abatement Partial-Month Proration Factor',
      cCalc(assump.abatementPartialFactor, FMT.factor, vFill));
  row(10, 'CAMS Monthly Rate',
      cInput(assump.camsYear1, FMT.currency, vFill));
  row(11, 'Insurance Monthly Rate',
      cInput(assump.insuranceYear1, FMT.currency, vFill));
  row(12, 'Taxes Monthly Rate',
      cInput(assump.taxesYear1, FMT.currency, vFill));
  row(13, 'Security Monthly Rate',
      cInput(assump.securityYear1, FMT.currency, vFill));
  row(14, 'Other Items Monthly Rate',
      cInput(assump.otherItemsYear1, FMT.currency, vFill));
}

// ---------------------------------------------------------------------------
// Main ledger builder
// ---------------------------------------------------------------------------

function buildLedger(rows, assump) {
  const ws = {};

  const FDR      = FIRST_DATA_ROW;                   // 17
  const HDR      = HEADER_ROW;                       // 16
  const lastData = FDR + rows.length - 1;            // last monthly data row
  const totRow   = lastData + 1;                     // TOTAL row
  const noteRow  = totRow + 2;                       // footnotes start

  // ── Fix 1: Assumptions block (rows 2–14, cols B–C) ─────────────────────
  buildAssumptionsBlock(ws, assump);

  // ── Header row (row 16) ──────────────────────────────────────────────────
  LEDGER_HEADERS.forEach((h, ci) => sc(ws, ci, HDR, cHdr(h, C.headerNavy)));

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
    sc(ws, 2, r, cInt(lm, rowFill, false, C.fcInput));
    sc(ws, 3, r, cInt(ly, rowFill, false, C.fcInput));

    // ── E — Scheduled Base Rent: BLUE formula referencing $C$5, $C$6 ────
    // Fix 2: = Year1BaseRent * (1 + EscRate)^(Year#-1)
    sc(ws, 4, r, cFmlaInput(
      `$C$5*(1+$C$6)^(D${r}-1)`,
      row.scheduledBaseRent ?? 0,
      FMT.currency,
      rowFill,
    ));

    // ── F — Base Rent Applied: BLACK formula, red-pink fill ──────────────
    // Fix 2: abatement logic references $C$8 (full-month count) and $C$9 (partial factor)
    // Months ≤ $C$8  → full abatement → $0
    // Month  = $C$8+1 → boundary month → E{r} × partial factor
    // Months > $C$8+1 → full rent      → E{r}
    sc(ws, 5, r, cFmla(
      `IF(C${r}<=$C$8,0,IF(C${r}=$C$8+1,E${r}*$C$9,E${r}))`,
      row.baseRentApplied ?? 0,
      FMT.currency,
      nnnFill,
    ));

    // ── G–K — NNN inputs: BLUE text, red-pink fill (Fix 3) ──────────────
    sc(ws, 6,  r, cInput(row.camsAmount       ?? 0, FMT.currency, nnnFill));
    sc(ws, 7,  r, cInput(row.insuranceAmount   ?? 0, FMT.currency, nnnFill));
    sc(ws, 8,  r, cInput(row.taxesAmount       ?? 0, FMT.currency, nnnFill));
    sc(ws, 9,  r, cInput(row.securityAmount    ?? 0, FMT.currency, nnnFill));
    sc(ws, 10, r, cInput(row.otherItemsAmount  ?? 0, FMT.currency, nnnFill));

    // ── L — Total NNN ①: BLACK formula, red-pink fill ───────────────────
    const nnnFallback =
      (row.camsAmount ?? 0) + (row.insuranceAmount ?? 0) +
      (row.taxesAmount ?? 0) + (row.securityAmount ?? 0) + (row.otherItemsAmount ?? 0);
    sc(ws, 11, r, cFmla(
      `G${r}+H${r}+I${r}+J${r}+K${r}`,
      nnnFallback,
      FMT.currency,
      nnnFill,
    ));

    // ── M — Total Monthly Obligation ②: BLACK formula, row fill ─────────
    sc(ws, 12, r, cFmla(
      `F${r}+L${r}`,
      row.totalMonthlyObligation ?? 0,
      FMT.currency,
      rowFill,
    ));

    // ── N — Effective $/SF: BLACK formula referencing $C$2 (SF) ─────────
    // Fix 2: = Total Monthly Obligation / Rentable SF assumption cell
    sc(ws, 13, r, cFmla(
      `IF($C$2=0,0,M${r}/$C$2)`,
      row.effectivePerSF ?? 0,
      FMT.sf,
      rowFill,
    ));

    // ── O, P, Q — Remaining balances: BLACK tail-sum formulas ───────────
    sc(ws, 14, r, cFmla(`SUM(M${r}:M${lastData})`, row.totalObligationRemaining ?? 0, FMT.currency, rowFill));
    sc(ws, 15, r, cFmla(`SUM(F${r}:F${lastData})`, row.totalBaseRentRemaining   ?? 0, FMT.currency, rowFill));
    sc(ws, 16, r, cFmla(`SUM(L${r}:L${lastData})`, row.totalNNNRemaining        ?? 0, FMT.currency, rowFill));
  });

  // ── Totals row ────────────────────────────────────────────────────────────
  const sum = (letter) => `SUM(${letter}${FDR}:${letter}${lastData})`;

  sc(ws,  0, totRow, cTotalLabel('TOTAL'));
  sc(ws,  1, totRow, cBlankTotal());
  sc(ws,  2, totRow, cBlankTotal());
  sc(ws,  3, totRow, cBlankTotal());
  sc(ws,  4, totRow, cTotal(sum('E'), 0, FMT.currency));
  sc(ws,  5, totRow, cTotal(sum('F'), 0, FMT.currency));
  sc(ws,  6, totRow, cTotal(sum('G'), 0, FMT.currency));
  sc(ws,  7, totRow, cTotal(sum('H'), 0, FMT.currency));
  sc(ws,  8, totRow, cTotal(sum('I'), 0, FMT.currency));
  sc(ws,  9, totRow, cTotal(sum('J'), 0, FMT.currency));
  sc(ws, 10, totRow, cTotal(sum('K'), 0, FMT.currency));
  sc(ws, 11, totRow, cTotal(sum('L'), 0, FMT.currency));
  sc(ws, 12, totRow, cTotal(sum('M'), 0, FMT.currency));
  sc(ws, 13, totRow, cBlankTotal());
  sc(ws, 14, totRow, cBlankTotal());
  sc(ws, 15, totRow, cBlankTotal());
  sc(ws, 16, totRow, cBlankTotal());

  // ── Formula footnotes ─────────────────────────────────────────────────────
  const noteStyle = {
    font:      { ...FONT_SM, italic: true, color: { rgb: '555555' } },
    fill:      { patternType: 'solid', fgColor: { rgb: C.note } },
    alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
    numFmt:    FMT.text,
  };
  sc(ws, 0, noteRow,
    { t: 's', v: '① Total NNN (col L) = CAMS + Insurance + Taxes + Security + Other Items — formula updates if you edit individual NNN charges.', s: noteStyle });
  sc(ws, 0, noteRow + 1,
    { t: 's', v: '② Total Monthly Obligation (col M) = Base Rent Applied + Total NNN — formula updates if you edit base rent or NNN charges.', s: noteStyle });
  sc(ws, 0, noteRow + 2,
    { t: 's', v: '③ Remaining balances (cols O–Q) = tail-sum of all future months: SUM(this row → last data row). Automatically recalculates if any monthly value is edited.', s: noteStyle });
  sc(ws, 0, noteRow + 3,
    { t: 's', v: 'Color guide: Blue text = direct inputs (Scheduled Base Rent, NNN charges; adjust via assumption cells B2:C14) | Black text = formula outputs | Red-pink fill = net/obligation columns | Amber rows = abatement periods.', s: noteStyle });

  // ── Sheet metadata ────────────────────────────────────────────────────────
  ws['!cols'] = LEDGER_WIDTHS.map((w) => ({ wch: w }));

  // Row heights: row 1 default, rows 2–14 assumptions (18pt), row 15 blank, row 16 header (44pt)
  const rowHeights = [
    {},           // row 1 — blank, default height
    ...Array(13).fill({ hpt: 18 }),  // rows 2–14 — assumption rows
    {},           // row 15 — blank separator
    { hpt: 44 },  // row 16 — header
  ];
  ws['!rows'] = rowHeights;

  // Freeze rows 1–16 so header is always visible when scrolling data
  ws['!views']      = [{ state: 'frozen', ySplit: HDR }];
  ws['!autofilter'] = { ref: `A${HDR}:${col(16)}${HDR}` };

  setRef(ws, 16, noteRow + 3);
  return ws;
}

// ===========================================================================
// Sheet 2 — Annual Summary (SUMIF/COUNTIF cross-sheet formulas)
// ===========================================================================

const SUMMARY_HEADERS = [
  'Lease Year', 'Months',
  'Base Rent Applied', 'Total NNN',
  'Total Monthly Obligation', '% of Grand Total',
];

function buildAnnualSummary(rows) {
  const ws = {};
  const years = [...new Set(
    rows.map((r) => r.leaseYear ?? r['Year #']).filter(Boolean)
  )].sort((a, b) => a - b);

  // Fix 2 consequence: data rows now start at FIRST_DATA_ROW (17), not row 2
  const firstLedger = FIRST_DATA_ROW;                      // 17
  const lastLedger  = FIRST_DATA_ROW + rows.length - 1;    // 16 + rows.length

  const LS   = "'Lease Schedule'";
  const Dabs = `${LS}!$D$${firstLedger}:$D$${lastLedger}`;
  const Fabs = `${LS}!$F$${firstLedger}:$F$${lastLedger}`;
  const Labs = `${LS}!$L$${firstLedger}:$L$${lastLedger}`;
  const Mabs = `${LS}!$M$${firstLedger}:$M$${lastLedger}`;

  SUMMARY_HEADERS.forEach((h, ci) => sc(ws, ci, 1, cHdr(h, C.headerBlue)));

  years.forEach((year, idx) => {
    const r    = idx + 2;
    const fill = idx % 2 === 0 ? C.rowEven : C.rowOdd;
    const Ar   = `A${r}`;
    const totE = `E${years.length + 2}`;

    sc(ws, 0, r, cInt(year, fill, false, C.fcInput));
    sc(ws, 1, r, cXSheet(`COUNTIF(${Dabs},${Ar})`,        12, FMT.int,      fill));
    sc(ws, 2, r, cXSheet(`SUMIF(${Dabs},${Ar},${Fabs})`,   0, FMT.currency, fill));
    sc(ws, 3, r, cXSheet(`SUMIF(${Dabs},${Ar},${Labs})`,   0, FMT.currency, fill));
    sc(ws, 4, r, cXSheet(`SUMIF(${Dabs},${Ar},${Mabs})`,   0, FMT.currency, fill));
    sc(ws, 5, r, cFmla(`IF(${totE}=0,0,E${r}/${totE})`,    0, FMT.pct,      fill));
  });

  const totRow  = years.length + 2;
  const lastRow = totRow - 1;
  const gsum    = (letter) => `SUM(${letter}2:${letter}${lastRow})`;

  sc(ws, 0, totRow, cTotalLabel('GRAND TOTAL'));
  sc(ws, 1, totRow, cTotal(gsum('B'), 0, FMT.int));
  sc(ws, 2, totRow, cTotal(gsum('C'), 0, FMT.currency));
  sc(ws, 3, totRow, cTotal(gsum('D'), 0, FMT.currency));
  sc(ws, 4, totRow, cTotal(gsum('E'), 0, FMT.currency));
  sc(ws, 5, totRow, { t: 's', v: '100.0%', s: TOTAL_BASE });

  ws['!cols']  = [{ wch: 12 }, { wch: 9 }, { wch: 22 }, { wch: 16 }, { wch: 26 }, { wch: 16 }];
  ws['!rows']  = [{ hpt: 40 }];
  ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
  setRef(ws, 5, totRow);
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
 *                              taxes, security, otherItems). Pass {} if unavailable.
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

  XLSX.utils.book_append_sheet(wb, buildLedger(rows, assump),        'Lease Schedule');
  XLSX.utils.book_append_sheet(wb, buildAnnualSummary(rows),         'Annual Summary');
  XLSX.utils.book_append_sheet(wb, buildAuditTrail(rows),            'Audit Trail');

  XLSX.writeFile(wb, `${filename}.xlsx`);
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
