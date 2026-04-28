/**
 * @fileoverview Declarative spec for Sheet 3 — Audit Trail.
 *
 * Shows per-row calculation trace: period factor, proration factor,
 * proration basis, and per-charge escalation year and active status.
 */

import { C, FMT, ds, hdrStyle } from './styleTokens.js';

/**
 * Build the Audit Trail sheet spec.
 *
 * @param {object[]} rows    — processed data rows
 * @param {Array}    charges — resolved charge objects
 * @returns {object} sheet spec
 */
export function buildAuditTrailSpec(rows, charges) {
  const cells = [];

  // Headers
  const baseHeaders = [
    'Period Start', 'Month #',
    'Period Factor', 'Proration Factor', 'Proration Basis',
    'Concession Type', 'Concession Trigger', 'Concession Detail', 'Concession Amount',
  ];
  const chargeHeaders = charges.flatMap((ch) => [
    `${ch.displayLabel}\nEsc Year`, `${ch.displayLabel}\nActive`,
  ]);
  const allHeaders = [...baseHeaders, ...chargeHeaders];

  allHeaders.forEach((h, ci) => {
    cells.push({ col: ci, row: 1, cell: { t: 's', v: h, s: hdrStyleLocal(C.headerPurple) } });
  });

  // Data rows
  rows.forEach((row, idx) => {
    const r    = idx + 2;
    const fill = idx % 2 === 0 ? C.rowEven : C.rowOdd;

    cells.push({ col: 0, row: r, cell: dateCell(row.periodStart, fill) });
    cells.push({ col: 1, row: r, cell: intCell(row.leaseMonth ?? row['Month #'] ?? 0, fill, C.fcInput) });
    cells.push({ col: 2, row: r, cell: inputCell(row.periodFactor            ?? 1, FMT.factor, fill) });
    cells.push({ col: 3, row: r, cell: inputCell(row.baseRentProrationFactor ?? 1, FMT.factor, fill) });
    cells.push({ col: 4, row: r, cell: textCell(row.prorationBasis ?? '', fill, 'center', C.fcInput) });
    cells.push({ col: 5, row: r, cell: textCell(row.concessionType ?? '', fill, 'center', C.fcInput) });
    cells.push({ col: 6, row: r, cell: textCell(row.concessionTriggerDate ?? row.concessionEndDate ?? '', fill, 'center', C.fcInput) });
    cells.push({
      col: 7,
      row: r,
      cell: textCell(
        row.concessionLabel
          ?? row.concessionAssumptionNote
          ?? (
            row.concessionStartDate || row.concessionEndDate
              ? `${row.concessionStartDate ?? ''}${row.concessionEndDate ? ` -> ${row.concessionEndDate}` : ''}`
              : ''
          ),
        fill,
        'left',
        C.fcInput,
      ),
    });
    cells.push({ col: 8, row: r, cell: inputCell(row.abatementAmount ?? 0, FMT.currency, fill) });

    // Dynamic charge trace columns
    charges.forEach((ch, chIdx) => {
      const baseCi = 9 + chIdx * 2;
      const detail = row.chargeDetails?.[ch.key];
      const escYears = detail?.escYears ?? row[`${ch.key}EscYears`] ?? 0;
      const active   = detail?.active   ?? row[`${ch.key}Active`]   ?? '';
      cells.push({ col: baseCi,     row: r, cell: intCell(escYears, fill, C.fcInput) });
      cells.push({ col: baseCi + 1, row: r, cell: textCell(String(active), fill, 'center', C.fcInput) });
    });
  });

  const totalCols  = 9 + charges.length * 2;
  const baseWidths = [13, 9, 14, 16, 20, 16, 16, 28, 16];
  const chargeWidths = charges.flatMap(() => [13, 11]);

  return {
    sheetName: 'Audit Trail',
    lastCol: totalCols - 1,
    lastRow: rows.length + 1,
    frozenPane: { ySplit: 1 },
    colWidths: [...baseWidths, ...chargeWidths],
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

function inputCell(v, fmt, fill) {
  return { t: 'n', v: v ?? 0, s: dsLocal(fill, fmt, { fontColor: C.fcInput }) };
}

function textCell(v, fill, align = 'left', fontColor = C.fcCalc) {
  return { t: 's', v: String(v ?? ''), s: dsLocal(fill, FMT.text, { align, fontColor }) };
}
