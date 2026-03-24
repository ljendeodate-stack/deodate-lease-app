/**
 * @fileoverview Declarative spec for Sheet 1 — Lease Schedule (Monthly Ledger).
 *
 * Defines all sections (title, assumptions, header, data, totals, footnotes)
 * and their cell bindings. The sheetWriter renders this spec to a worksheet.
 */

import { C, FMT, FONT, FONT_B, FONT_SM, ASSUMPTION_BORDER } from './styleTokens.js';
import { CANONICAL_TYPES } from '../../engine/chargeTypes.js';
import { colLetter } from '../engine/registry.js';
import * as F from './formulaTemplates.js';

/**
 * Build the Lease Schedule sheet spec.
 *
 * @param {object}   assump    — computed assumptions
 * @param {object[]} rows      — processed data rows
 * @param {string[]} otLabels  — one-time item labels
 * @param {string}   filename  — export filename (for title)
 * @param {object}   L         — layout from computeLayout()
 * @param {import('../engine/registry.js').SymbolRegistry} reg
 * @returns {object} sheet spec for sheetWriter
 */
export function buildLeaseScheduleSpec(assump, rows, otLabels, filename, L, reg) {
  const charges     = assump.charges ?? [];
  const chargeCount = charges.length;
  const otCount     = otLabels.length;

  const { HEADER_ROW: HDR, FIRST_DATA_ROW: FDR, CHARGE_START,
          TOTAL_NNN_COL, OT_START, TOTAL_MONTHLY, EFF_SF,
          OBLIG_REM, BASE_REM, NNN_REM, OTHER_CHARGES_REM, LAST_COL } = L;

  const lastData = FDR + rows.length - 1;
  const totRow   = lastData + 1;
  const noteRow  = totRow + 2;

  const tmLetter  = colLetter(TOTAL_MONTHLY);
  const nnnLetter = colLetter(TOTAL_NNN_COL);

  // Pre-compute NNN and Other charge column indices
  const nnnChargeColIndices   = [];
  const otherChargeColIndices = [];
  charges.forEach((ch, idx) => {
    const ci = CHARGE_START + idx;
    if (ch.canonicalType === CANONICAL_TYPES.NNN) nnnChargeColIndices.push(ci);
    else otherChargeColIndices.push(ci);
  });

  const otColIndices = otLabels.map((_, j) => OT_START + j);

  return {
    sheetName: 'Lease Schedule',
    lastCol: LAST_COL,
    lastRow: noteRow + 4,

    // ── Frozen pane / autofilter ──────────────────────────────────────────
    frozenPane: { xSplit: 4, ySplit: HDR },
    autoFilter: { ref: `A${HDR}:${colLetter(LAST_COL)}${HDR}` },

    // ── Column widths ────────────────────────────────────────────────────
    colWidths: [
      13, 35, 9, 9, 20, 20, 14,
      ...Array(chargeCount).fill(14),
      14,
      ...Array(otCount).fill(22),
      22, 14, 22, 20, 16, 22,
    ],

    // ── Row heights ──────────────────────────────────────────────────────
    rowHeights: [
      { hpt: 36 },   // row 1 — title
      { hpt: 16 },   // row 2 — subtitle
      { hpt: 14 },   // row 3 — generated date
      {},             // row 4 — blank
      ...Array(22 + 2 * chargeCount + Math.max(otCount, 1)).fill({ hpt: 18 }), // assumption rows
      {},             // blank separator
      { hpt: 44 },   // header row
    ],

    // ── Sections ─────────────────────────────────────────────────────────
    sections: {
      title:       buildTitleSection(filename, LAST_COL),
      assumptions: buildAssumptionsSection(assump, charges, otLabels),
      header:      buildHeaderSection(HDR, charges, otLabels, chargeCount),
      data:        buildDataSection(rows, otLabels, FDR, lastData, charges,
                                    nnnChargeColIndices, otherChargeColIndices,
                                    otColIndices, L, reg, nnnLetter, tmLetter),
      totals:      buildTotalsSection(totRow, FDR, lastData, charges, otLabels, L),
      footnotes:   buildFootnoteSection(noteRow, charges, otLabels, nnnLetter, tmLetter, otCount),
    },
  };
}

// ── Section builders ────────────────────────────────────────────────────────

function buildTitleSection(filename, lastCol) {
  const titleName = (filename || 'Lease Schedule')
    .replace(/\.[^/.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());
  const title = `${titleName} — Obligation Analysis`;

  const today = new Date();
  const pad   = (n) => String(n).padStart(2, '0');
  const dateStr = `Generated: ${pad(today.getMonth() + 1)}/${pad(today.getDate())}/${today.getFullYear()}`;

  return {
    cells: [
      { col: 0, row: 1, cell: {
        t: 's', v: title,
        s: {
          font:      { name: 'Calibri', sz: 20, bold: true, color: { rgb: C.headerNavy } },
          fill:      { patternType: 'solid', fgColor: { rgb: 'DEEAF1' } },
          alignment: { horizontal: 'center', vertical: 'middle' },
          numFmt:    FMT.text,
        },
      }},
      { col: 0, row: 2, cell: {
        t: 's', v: 'DEODATE Lease Schedule Engine — Full Obligation Analysis',
        s: {
          font:      { name: 'Calibri', sz: 11, italic: true, color: { rgb: '375623' } },
          fill:      { patternType: 'solid', fgColor: { rgb: C.assumpLabel } },
          alignment: { horizontal: 'center', vertical: 'middle' },
          numFmt:    FMT.text,
        },
      }},
      { col: 0, row: 3, cell: {
        t: 's', v: dateStr,
        s: {
          font:      { name: 'Calibri', sz: 10, color: { rgb: '555555' } },
          fill:      { patternType: 'solid', fgColor: { rgb: C.note } },
          alignment: { horizontal: 'center', vertical: 'middle' },
          numFmt:    FMT.text,
        },
      }},
    ],
    merges: [
      { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: lastCol } },
    ],
  };
}

function buildAssumptionsSection(assump, charges, otLabels) {
  const N = charges.length;
  const vFill = C.white;
  const cells = [];

  // ── Style helpers ─────────────────────────────────────────────────────────
  const labelStyle = {
    font:      { ...FONT_B, color: { rgb: '1F3864' } },
    fill:      { patternType: 'solid', fgColor: { rgb: C.assumpLabel } },
    alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
    border:    ASSUMPTION_BORDER,
    numFmt:    FMT.text,
  };

  const sectionHeadStyle = {
    font:      { ...FONT_B, sz: 10, color: { rgb: C.white } },
    fill:      { patternType: 'solid', fgColor: { rgb: C.headerNavy } },
    alignment: { horizontal: 'left', vertical: 'middle' },
    border:    ASSUMPTION_BORDER,
    numFmt:    FMT.text,
  };

  function addRow(r, label, valueCell) {
    cells.push({ col: 1, row: r, cell: { t: 's', v: label, s: labelStyle } });
    cells.push({ col: 2, row: r, cell: { ...valueCell, s: { ...valueCell.s, border: ASSUMPTION_BORDER } } });
  }

  function addHeading(r, title) {
    cells.push({ col: 1, row: r, cell: { t: 's', v: title, s: sectionHeadStyle } });
    cells.push({ col: 2, row: r, cell: { t: 's', v: '',    s: sectionHeadStyle } });
  }

  function textCell(v) {
    return {
      t: 's', v: v ?? '',
      s: { ...dsLocal(vFill, FMT.text, { align: 'left', fontColor: C.fcInput }), border: ASSUMPTION_BORDER },
    };
  }

  // ── Section 1: Lease Drivers (rows 5–11) ──────────────────────────────────
  addHeading(5, 'LEASE DRIVERS');
  addRow(6,  'Lease Name',                 textCell(assump.leaseName || ''));
  addRow(7,  'Rentable SF',                inputCell(assump.squareFootage, FMT.int, vFill));
  addRow(8,  'Lease Commencement Date',    dateCell(assump.commencementDate, vFill));
  addRow(9,  'Lease Expiration Date',      dateCell(assump.expirationDate, vFill));
  addRow(10, 'Rent Commencement Date',     dateCell(assump.rentCommencementDate ?? null, vFill));
  addRow(11, 'Effective Analysis Date',    dateCell(assump.effectiveAnalysisDate ?? null, vFill));

  // ── Section 2: Monthly Rent Breakdown (rows 12–(14+N)) ───────────────────
  addHeading(12, 'MONTHLY RENT BREAKDOWN');
  addRow(13, 'NNN Mode',                   textCell(assump.nnnMode === 'aggregate' ? 'Aggregate' : 'Individual'));
  addRow(14, 'Year 1 Monthly Base Rent',   inputCell(assump.year1BaseRent, FMT.currency, vFill));
  charges.forEach((ch, idx) => {
    const label   = ch.displayLabel || ch.key;
    const typeTag = ch.canonicalType === CANONICAL_TYPES.NNN ? ' [NNN]' : ' [Other]';
    addRow(15 + idx, `${label} Year 1 Monthly Amount${typeTag}`, inputCell(ch.year1, FMT.currency, vFill));
  });

  // ── Section 3: Escalation Assumptions (rows (15+N)–(17+2N)) ─────────────
  addHeading(15 + N, 'ESCALATION ASSUMPTIONS');
  addRow(16 + N, 'Annual Base Rent Escalation Rate (%)',      inputCell(assump.annualEscRate, FMT.pct, vFill));
  addRow(17 + N, 'Lease Anniversary Month',                   inputCell(assump.anniversaryMonth, FMT.int, vFill));
  charges.forEach((ch, idx) => {
    const label = ch.displayLabel || ch.key;
    addRow(18 + N + idx, `${label} Annual Escalation Rate (%)`, inputCell(ch.escRate, FMT.pct, vFill));
  });

  // ── Section 4: Abatement (rows (18+2N)–(22+2N)) ─────────────────────────
  addHeading(18 + 2*N, 'ABATEMENT');
  addRow(19 + 2*N, 'Abatement Full-Month Count',               inputCell(assump.fullAbatementMonths, FMT.int, vFill));
  addRow(20 + 2*N, 'Abatement End Date',                       dateCell(assump.abatementEndDate ?? null, vFill));
  addRow(21 + 2*N, 'Abatement Percentage (%)',                  inputCell((assump.abatementPct ?? 0) / 100, FMT.pct, vFill));
  addRow(22 + 2*N, 'Abatement Partial-Month Proration Factor',  inputCell(assump.abatementPartialFactor, FMT.factor, vFill));

  // ── Section 5: Free Rent (rows (23+2N)–(25+2N)) ──────────────────────────
  addHeading(23 + 2*N, 'FREE RENT');
  addRow(24 + 2*N, 'Free Rent Months',   inputCell(assump.freeRentMonths ?? 0, FMT.int, vFill));
  addRow(25 + 2*N, 'Free Rent End Date', dateCell(assump.freeRentEndDate ?? null, vFill));

  // ── Section 6: Non-Recurring Charges (rows (26+2N)+) ─────────────────────
  addHeading(26 + 2*N, 'NON-RECURRING CHARGES');
  const otItems = assump.oneTimeItems ?? [];
  if (otItems.length === 0) {
    // Show a "(none)" placeholder row so the section always has at least one row
    cells.push({ col: 1, row: 27 + 2*N, cell: {
      t: 's', v: '(none)',
      s: { ...labelStyle, font: { ...FONT_B, color: { rgb: 'AAAAAA' }, sz: 10, italic: true } },
    }});
    cells.push({ col: 2, row: 27 + 2*N, cell: { t: 's', v: '', s: { ...labelStyle } } });
  } else {
    otItems.forEach((item, idx) => {
      const r = 27 + 2*N + idx;
      cells.push({ col: 1, row: r, cell: { t: 's', v: item.label || '', s: labelStyle } });
      cells.push({ col: 2, row: r, cell: { ...dateCell(item.date ?? null, vFill), s: { ...dateCell(item.date ?? null, vFill).s, border: ASSUMPTION_BORDER } } });
      // Amount in col 3 (D)
      cells.push({ col: 3, row: r, cell: {
        ...inputCell(item.amount ?? 0, FMT.currency, vFill),
        s: { ...inputCell(item.amount ?? 0, FMT.currency, vFill).s, border: ASSUMPTION_BORDER },
      }});
    });
  }

  return { cells };
}

function buildHeaderSection(HDR, charges, otLabels, chargeCount) {
  const baseHeaders = [
    'Period\nStart', 'Period\nEnd', 'Month\n#', 'Year\n#',
    'Scheduled\nBase Rent', 'Base Rent\nApplied', 'Abatement',
  ];
  const chargeHeaders = charges.map((ch) => ch.displayLabel || ch.key);
  const tailHeaders = [
    'Total NNN',
    ...otLabels.map((lbl) => lbl.replace(/(.{16})/g, '$1\n').trim()),
    'Total Monthly\nObligation',
    'Effective\n$/SF',
    'Obligation\nRemaining', 'Base Rent\nRemaining', 'NNN\nRemaining', 'Other Charges\nRemaining',
  ];
  const headers = [...baseHeaders, ...chargeHeaders, ...tailHeaders];

  return {
    cells: headers.map((h, ci) => ({
      col: ci, row: HDR,
      cell: { t: 's', v: h, s: hdrStyleLocal(C.headerNavy) },
    })),
  };
}

function hdrStyleLocal(bg) {
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

function buildDataSection(rows, otLabels, FDR, lastData, charges,
                          nnnChargeColIndices, otherChargeColIndices,
                          otColIndices, L, reg, nnnLetter, tmLetter) {
  const { CHARGE_START, OT_START, TOTAL_MONTHLY, EFF_SF,
          OBLIG_REM, BASE_REM, NNN_REM, OTHER_CHARGES_REM } = L;

  const cells = [];

  rows.forEach((row, idx) => {
    const r = FDR + idx;

    const rowFill = row.isAbatementRow
      ? C.amber
      : idx % 2 === 0 ? C.rowEven : C.rowOdd;
    const nnnFill = C.softRedPink;

    const lm = row.leaseMonth ?? row['Month #'] ?? 0;
    const ly = row.leaseYear  ?? row['Year #']  ?? 0;

    // A, B — Dates
    cells.push({ col: 0, row: r, cell: dateCell(row.periodStart, rowFill) });
    cells.push({ col: 1, row: r, cell: dateCell(row.periodEnd,   rowFill) });

    // C, D — Month #, Year #
    cells.push({ col: 2, row: r, cell: intCell(lm, rowFill) });
    cells.push({ col: 3, row: r, cell: intCell(ly, rowFill) });

    // E — Scheduled Base Rent
    cells.push({ col: 4, row: r, cell: fmlaCell(
      F.scheduledBaseRent(reg, r),
      row.scheduledBaseRent ?? 0, FMT.currency, rowFill,
    )});

    // F — Base Rent Applied
    cells.push({ col: 5, row: r, cell: fmlaCell(
      F.baseRentApplied(reg, r),
      row.baseRentApplied ?? 0, FMT.currency, nnnFill,
    )});

    // G — Abatement
    cells.push({ col: 6, row: r, cell: fmlaCell(
      F.abatementAmount(reg, r),
      row.abatementAmount ?? 0, FMT.currency, rowFill,
    )});

    // Dynamic charge columns
    charges.forEach((ch, chIdx) => {
      const ci = CHARGE_START + chIdx;
      const fallback = row.chargeAmounts?.[ch.key] ?? row[`${ch.key}Amount`] ?? 0;
      cells.push({ col: ci, row: r, cell: fmlaCell(
        F.chargeAmount(reg, r, ch.key),
        fallback, FMT.currency, nnnFill,
      )});
    });

    // Total NNN
    cells.push({ col: L.TOTAL_NNN_COL, row: r, cell: fmlaCell(
      F.totalNNN(nnnChargeColIndices, r),
      row.totalNNNAmount ?? 0, FMT.currency, nnnFill,
    )});

    // OT columns — blue hardcoded input
    const otAmounts = row.oneTimeItemAmounts ?? {};
    otLabels.forEach((lbl, j) => {
      const amt = Number(otAmounts[lbl] ?? 0);
      cells.push({ col: OT_START + j, row: r, cell: inputCell(amt, FMT.currency, rowFill) });
    });

    // Total Monthly Obligation
    cells.push({ col: TOTAL_MONTHLY, row: r, cell: fmlaCell(
      F.totalMonthlyObligation(nnnLetter, otherChargeColIndices, otColIndices, r),
      row.totalMonthlyObligation ?? 0, FMT.currency, rowFill,
    )});

    // Effective $/SF
    cells.push({ col: EFF_SF, row: r, cell: fmlaCell(
      F.effectivePerSF(reg, tmLetter, r),
      row.effectivePerSF ?? 0, FMT.sf, rowFill,
    )});

    // Remaining balances
    cells.push({ col: OBLIG_REM, row: r, cell: fmlaCell(
      F.tailSum(TOTAL_MONTHLY, r, lastData),
      row.totalObligationRemaining ?? 0, FMT.currency, rowFill,
    )});
    cells.push({ col: BASE_REM, row: r, cell: fmlaCell(
      F.tailSum(5, r, lastData),
      row.totalBaseRentRemaining ?? 0, FMT.currency, rowFill,
    )});
    cells.push({ col: NNN_REM, row: r, cell: fmlaCell(
      F.tailSum(L.TOTAL_NNN_COL, r, lastData),
      row.totalNNNRemaining ?? 0, FMT.currency, rowFill,
    )});
    cells.push({ col: OTHER_CHARGES_REM, row: r, cell: fmlaCell(
      F.otherChargesRemaining(otherChargeColIndices, otColIndices, r, lastData),
      row.totalOtherChargesRemaining ?? 0, FMT.currency, rowFill,
    )});
  });

  return { cells };
}

function buildTotalsSection(totRow, FDR, lastData, charges, otLabels, L) {
  const { CHARGE_START, TOTAL_NNN_COL, OT_START, TOTAL_MONTHLY,
          EFF_SF, OBLIG_REM, BASE_REM, NNN_REM, OTHER_CHARGES_REM } = L;
  const otCount = otLabels.length;

  const sumRng = (ci) => `SUM(${colLetter(ci)}${FDR}:${colLetter(ci)}${lastData})`;
  const cells  = [];

  const TB = totalBaseStyle();
  const TBL = { ...TB, alignment: { horizontal: 'left', vertical: 'middle' } };

  cells.push({ col: 0, row: totRow, cell: { t: 's', v: 'TOTAL', s: TBL } });
  cells.push({ col: 1, row: totRow, cell: { t: 's', v: '', s: TB } });
  cells.push({ col: 2, row: totRow, cell: { t: 's', v: '', s: TB } });
  cells.push({ col: 3, row: totRow, cell: { t: 's', v: '', s: TB } });
  cells.push({ col: 4, row: totRow, cell: { t: 'n', v: 0, f: sumRng(4), s: { ...TB, numFmt: FMT.currency } } });
  cells.push({ col: 5, row: totRow, cell: { t: 'n', v: 0, f: sumRng(5), s: { ...TB, numFmt: FMT.currency } } });
  cells.push({ col: 6, row: totRow, cell: { t: 'n', v: 0, f: sumRng(6), s: { ...TB, numFmt: FMT.currency } } });

  charges.forEach((_, chIdx) => {
    const ci = CHARGE_START + chIdx;
    cells.push({ col: ci, row: totRow, cell: { t: 'n', v: 0, f: sumRng(ci), s: { ...TB, numFmt: FMT.currency } } });
  });

  cells.push({ col: TOTAL_NNN_COL, row: totRow, cell: { t: 'n', v: 0, f: sumRng(TOTAL_NNN_COL), s: { ...TB, numFmt: FMT.currency } } });

  for (let j = 0; j < otCount; j++) {
    cells.push({ col: OT_START + j, row: totRow, cell: { t: 'n', v: 0, f: sumRng(OT_START + j), s: { ...TB, numFmt: FMT.currency } } });
  }

  cells.push({ col: TOTAL_MONTHLY, row: totRow, cell: { t: 'n', v: 0, f: sumRng(TOTAL_MONTHLY), s: { ...TB, numFmt: FMT.currency } } });
  cells.push({ col: EFF_SF,             row: totRow, cell: { t: 's', v: '', s: TB } });
  cells.push({ col: OBLIG_REM,          row: totRow, cell: { t: 's', v: '', s: TB } });
  cells.push({ col: BASE_REM,           row: totRow, cell: { t: 's', v: '', s: TB } });
  cells.push({ col: NNN_REM,            row: totRow, cell: { t: 's', v: '', s: TB } });
  cells.push({ col: OTHER_CHARGES_REM,  row: totRow, cell: { t: 's', v: '', s: TB } });

  return { cells };
}

function buildFootnoteSection(noteRow, charges, otLabels, nnnLetter, tmLetter, otCount) {
  const noteStyle = {
    font:      { ...FONT_SM, italic: true, color: { rgb: '555555' } },
    fill:      { patternType: 'solid', fgColor: { rgb: C.note } },
    alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
    numFmt:    FMT.text,
  };

  const nnnLabels   = charges.filter(ch => ch.canonicalType === CANONICAL_TYPES.NNN).map(ch => ch.displayLabel);
  const otherLabels = charges.filter(ch => ch.canonicalType === CANONICAL_TYPES.OTHER).map(ch => ch.displayLabel);
  const nnnDesc     = nnnLabels.join(' + ') || '(none)';
  const otherDesc   = otherLabels.join(', ') || '(none)';

  const notes = [
    `Total NNN (col ${nnnLetter}) = ${nnnDesc}. Other Charges = ${otherDesc}${otCount > 0 ? ' + one-time charge columns (blue)' : ''}.`,
    `Total Monthly Obligation (col ${tmLetter}) = Base Rent Applied + Total NNN + Other Charges${otCount > 0 ? ' + one-time charges' : ''}.`,
    `Remaining: Obligation = SUM of future Total Monthly Obligation. Base Rent / NNN / Other Charges = tail-sums of their respective columns.`,
    `NNN charges escalate annually: Year 1 amounts and escalation rates are in the assumptions block. Charge columns are live formulas — edit assumptions to recalculate.`,
    'Color guide: Blue text = direct user inputs (incl. one-time charge event cells) | Black text = formula outputs | Red-pink fill = NNN/obligation columns | Amber rows = abatement periods.',
  ];

  return {
    cells: notes.map((txt, i) => ({
      col: 0, row: noteRow + i,
      cell: { t: 's', v: txt, s: noteStyle },
    })),
  };
}

// ── Inline cell/style helpers ────────────────────────────────────────────

function dsLocal(fill, numFmt, extra = {}) {
  const THIN_BORDER = {
    top:    { style: 'thin', color: { rgb: 'C8C8C8' } },
    bottom: { style: 'thin', color: { rgb: 'C8C8C8' } },
    left:   { style: 'thin', color: { rgb: 'C8C8C8' } },
    right:  { style: 'thin', color: { rgb: 'C8C8C8' } },
  };
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

function toSerialLocal(isoStr) {
  if (!isoStr) return null;
  const p = isoStr.split('-');
  if (p.length !== 3) return null;
  const d     = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  const epoch = new Date(1899, 11, 30);
  return Math.round((d.getTime() - epoch.getTime()) / 86400000);
}

function totalBaseStyle() {
  return {
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
}

function dateCell(isoStr, fill) {
  const serial = toSerialLocal(isoStr);
  if (serial === null) {
    return { t: 's', v: isoStr ?? '', s: dsLocal(fill, FMT.text, { align: 'center', fontColor: C.fcCalc }) };
  }
  return { t: 'n', v: serial, s: dsLocal(fill, FMT.date, { align: 'center', fontColor: C.fcCalc }) };
}

function intCell(v, fill) {
  return { t: 'n', v: v ?? 0, s: dsLocal(fill, FMT.int, { align: 'center', fontColor: C.fcCalc }) };
}

function fmlaCell(formula, fallback, fmt, fill) {
  return { t: 'n', v: fallback ?? 0, f: formula, s: dsLocal(fill, fmt, { fontColor: C.fcCalc }) };
}

function inputCell(v, fmt, fill) {
  return { t: 'n', v: v ?? 0, s: dsLocal(fill, fmt, { fontColor: C.fcInput }) };
}
