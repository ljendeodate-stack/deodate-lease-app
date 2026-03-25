import { C, FMT, FONT_B, FONT_SM, TOTAL_BASE, ds, hdrStyle, ASSUMPTION_BORDER } from './styleTokens.js';
import { colLetter } from '../engine/registry.js';

/**
 * Build a spec that reproduces the current Lease Schedule worksheet layout.
 *
 * @param {import('../types.js').ExportModel} exportModel
 * @param {import('../types.js').LeaseScheduleLayout} layout
 * @returns {object}
 */
export function buildLegacyLeaseScheduleSpec(exportModel, layout) {
  return {
    sheetName: 'Lease Schedule',
    lastCol: layout.lastCol,
    lastRow: layout.noteRow + 4,
    frozenPane: { xSplit: 4, ySplit: layout.headerRow },
    autoFilter: { ref: `A${layout.headerRow}:${colLetter(layout.lastCol)}${layout.headerRow}` },
    colWidths: exportModel.columns.map((column) => column.width),
    rowHeights: [
      { hpt: 36 },
      { hpt: 16 },
      { hpt: 14 },
      {},
      ...Array(layout.assumptionEntries.length).fill({ hpt: 18 }),
      {},
      { hpt: 44 },
    ],
    sections: {
      title: buildTitleSection(exportModel.filename, layout.lastCol),
      assumptions: buildAssumptionsSection(layout.assumptionEntries, layout.cellMap, layout),
      header: buildHeaderSection(exportModel.columns, layout.headerRow),
      data: buildDataSection(exportModel, layout),
      totals: buildTotalsSection(exportModel.columns, layout),
      footnotes: buildFootnotesSection(layout),
    },
  };
}

function buildTitleSection(filename, lastCol) {
  const titleName = (filename || 'Lease Schedule')
    .replace(/\.[^/.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

  const today = new Date();
  const pad = (value) => String(value).padStart(2, '0');

  return {
    cells: [
      {
        col: 0,
        row: 1,
        cell: {
          t: 's',
          v: `${titleName} - Obligation Analysis`,
          s: {
            font: { name: 'Calibri', sz: 20, bold: true, color: { rgb: C.headerNavy } },
            fill: { patternType: 'solid', fgColor: { rgb: 'DEEAF1' } },
            alignment: { horizontal: 'center', vertical: 'middle' },
            numFmt: FMT.text,
          },
        },
      },
      {
        col: 0,
        row: 2,
        cell: {
          t: 's',
          v: 'DEODATE Lease Schedule Engine - Full Obligation Analysis',
          s: {
            font: { name: 'Calibri', sz: 11, italic: true, color: { rgb: '375623' } },
            fill: { patternType: 'solid', fgColor: { rgb: C.assumpLabel } },
            alignment: { horizontal: 'center', vertical: 'middle' },
            numFmt: FMT.text,
          },
        },
      },
      {
        col: 0,
        row: 3,
        cell: {
          t: 's',
          v: `Generated: ${pad(today.getMonth() + 1)}/${pad(today.getDate())}/${today.getFullYear()}`,
          s: {
            font: { name: 'Calibri', sz: 10, color: { rgb: '555555' } },
            fill: { patternType: 'solid', fgColor: { rgb: C.note } },
            alignment: { horizontal: 'center', vertical: 'middle' },
            numFmt: FMT.text,
          },
        },
      },
    ],
    merges: [
      { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: lastCol } },
    ],
  };
}

function buildAssumptionsSection(assumptionEntries, cellMap, layout = null) {
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

  const textValueStyle = {
    font:      { name: 'Calibri', sz: 11, color: { rgb: C.fcInput } },
    fill:      { patternType: 'solid', fgColor: { rgb: C.inputFill } },
    alignment: { horizontal: 'left', vertical: 'middle' },
    border:    ASSUMPTION_BORDER,
    numFmt:    FMT.text,
  };

  const cells = [];

  for (const entry of assumptionEntries) {
    const r = entry.row;

    if (entry.kind === 'heading') {
      // Section heading — navy background, white bold text, spans cols B and C
      cells.push({ col: 1, row: r, cell: { t: 's', v: entry.label, s: sectionHeadStyle } });
      cells.push({ col: 2, row: r, cell: { t: 's', v: '',           s: sectionHeadStyle } });
      continue;
    }

    if (entry.kind === 'computed') {
      const formula = entry.formulaFn ? entry.formulaFn(cellMap, layout) : '0';
      const computedStyle = {
        font:      { name: 'Calibri', sz: 11, color: { rgb: C.fcCalc } },
        fill:      { patternType: 'solid', fgColor: { rgb: C.assumpLabel } },
        alignment: { horizontal: 'right', vertical: 'middle' },
        border:    ASSUMPTION_BORDER,
        numFmt:    FMT[entry.format] ?? FMT.int,
      };
      cells.push({ col: 1, row: r, cell: { t: 's', v: entry.label, s: labelStyle } });
      cells.push({ col: 2, row: r, cell: { t: 'n', v: entry.value ?? 0, f: formula, s: computedStyle } });
      continue;
    }

    if (entry.kind === 'ot_item') {
      // Non-recurring charge row: col B = label, col C = date, col D = amount
      cells.push({ col: 1, row: r, cell: { t: 's', v: entry.label || '', s: labelStyle } });
      const dc = dateCell(entry.otDate, C.inputFill, C.fcInput);
      cells.push({ col: 2, row: r, cell: { ...dc, s: { ...dc.s, border: ASSUMPTION_BORDER } } });
      const ac = inputCell(entry.value ?? 0, FMT.currency, C.inputFill);
      cells.push({ col: 3, row: r, cell: { ...ac, s: { ...ac.s, border: ASSUMPTION_BORDER } } });
      continue;
    }

    // Label cell (col B) — always present
    cells.push({ col: 1, row: r, cell: { t: 's', v: entry.label, s: labelStyle } });

    // Value cell (col C)
    let valueCell;
    if (entry.kind === 'date') {
      valueCell = dateCell(entry.value, C.inputFill, C.fcInput);
    } else if (entry.kind === 'text') {
      valueCell = { t: 's', v: String(entry.value ?? ''), s: textValueStyle };
    } else {
      valueCell = inputCell(entry.value, FMT[entry.format], C.inputFill);
    }
    cells.push({ col: 2, row: r, cell: { ...valueCell, s: { ...valueCell.s, border: ASSUMPTION_BORDER } } });
  }

  return { cells };
}

function buildHeaderSection(columns, headerRow) {
  return {
    cells: columns.map((column) => ({
      col: column.index,
      row: headerRow,
      cell: { t: 's', v: column.header, s: hdrStyle(C.headerNavy) },
    })),
  };
}

/**
 * COERCE_DATE(ref) — defensive date coercion for formula comparisons.
 * Returns IFERROR(DATEVALUE(ref),ref) so formulas survive text-form dates.
 */
function CD(ref) {
  return `IFERROR(DATEVALUE(${ref}),${ref})`;
}

function buildDataSection(exportModel, layout) {
  const cells = [];
  const { assumptions, rows } = exportModel;
  const {
    cellMap,
    colByKey,
    nnnColumns,
    otherChargeColumns,
    nrcColumn,
    nrcDateRange,
    nrcAmountRange,
    firstDataRow,
    lastDataRow,
  } = layout;

  rows.forEach((row, index) => {
    const worksheetRow = firstDataRow + index;
    const rowFill = row.isAbatementRow
      ? C.amber
      : index % 2 === 0 ? C.rowEven : C.rowOdd;
    const nnnFill = C.softRedPink;

    const leaseMonth = row.leaseMonth ?? row['Month #'] ?? 0;
    const leaseYear = row.leaseYear ?? row['Year #'] ?? 0;

    // Period Start: dynamic from Lease Commencement Date via EDATE
    cells.push({
      col: colByKey.periodStart.index,
      row: worksheetRow,
      cell: {
        t: 'n',
        v: toSerial(row.periodStart) ?? 0,
        f: `IFERROR(EDATE(${cellMap.commencementDate},${index}),0)`,
        s: ds(rowFill, FMT.date, { align: 'center', fontColor: C.fcCalc }),
      },
    });

    // Period End: dynamic — last day of the nth month from commencement
    cells.push({
      col: colByKey.periodEnd.index,
      row: worksheetRow,
      cell: {
        t: 'n',
        v: toSerial(row.periodEnd) ?? 0,
        f: `IFERROR(MIN(EDATE(${cellMap.commencementDate},${index + 1})-1,${cellMap.expirationDate}),0)`,
        s: ds(rowFill, FMT.date, { align: 'center', fontColor: C.fcCalc }),
      },
    });

    // Month #: dynamic from row position
    cells.push({
      col: colByKey.monthNum.index,
      row: worksheetRow,
      cell: {
        t: 'n',
        v: leaseMonth ?? 0,
        f: `ROW()-${firstDataRow - 1}`,
        s: ds(rowFill, FMT.int, { align: 'center', fontColor: C.fcCalc }),
      },
    });

    const yearCol = colByKey.yearNum.letter;
    const monthCol = colByKey.monthNum.letter;
    const scheduledBaseRentCol = colByKey.scheduledBaseRent.letter;
    const periodStartCol = colByKey.periodStart.letter;
    const periodEndCol = colByKey.periodEnd.letter;

    // Year #: dynamic from Month #
    cells.push({
      col: colByKey.yearNum.index,
      row: worksheetRow,
      cell: {
        t: 'n',
        v: leaseYear ?? 0,
        f: `INT((${monthCol}${worksheetRow}-1)/12)+1`,
        s: ds(rowFill, FMT.int, { align: 'center', fontColor: C.fcCalc }),
      },
    });

    // Schedule termination gate: zero out rows beyond total lease term
    const termGate = `AND(${cellMap.totalLeaseTerm}>0,${monthCol}${worksheetRow}>${cellMap.totalLeaseTerm})`;

    // Rent commencement gate (§6.3): suppress base rent before rentCommencementDate
    const rentCommGate = `AND(${cellMap.rentCommencementDate}<>"",${CD(`${periodEndCol}${worksheetRow}`)}<${CD(cellMap.rentCommencementDate)})`;

    // Scheduled Base Rent: with termination gate + rent commencement gate
    cells.push({
      col: colByKey.scheduledBaseRent.index,
      row: worksheetRow,
      cell: formulaCell(
        `IF(${termGate},0,IF(${rentCommGate},0,${cellMap.year1BaseRent}*(1+${cellMap.annualEscRate})^(${yearCol}${worksheetRow}-1)))`,
        row.scheduledBaseRent ?? 0,
        FMT.currency,
        rowFill,
      ),
    });

    // Base Rent Applied (§6.2): Free Rent > Full Abatement > Boundary Abatement > Full Rent
    // All date comparisons use defensive COERCE_DATE
    const ps = `${periodStartCol}${worksheetRow}`;
    const pe = `${periodEndCol}${worksheetRow}`;
    const sbr = `${scheduledBaseRentCol}${worksheetRow}`;

    // Period factor: proration for partial first/last months.
    // Evaluates to 1 for full calendar months; fractional for boundary months.
    const pfExpr = `IF(${pe}>=EDATE(${ps},1)-1,1,MAX(0,(${pe}-${ps}+1)/DAY(EOMONTH(${pe},0))))`;

    const freeRentActive = `AND(${cellMap.freeRentStart}<>"",${cellMap.freeRentEnd}<>"",${CD(ps)}>=${CD(cellMap.freeRentStart)},${CD(ps)}<=${CD(cellMap.freeRentEnd)})`;
    const fullAbatement = `AND(${cellMap.abatementStart}<>"",${cellMap.abatementEnd}<>"",${CD(ps)}>=${CD(cellMap.abatementStart)},${CD(pe)}<=${CD(cellMap.abatementEnd)})`;
    const boundaryAbatement = `AND(${cellMap.abatementStart}<>"",${cellMap.abatementEnd}<>"",${CD(ps)}>=${CD(cellMap.abatementStart)},${CD(ps)}<=${CD(cellMap.abatementEnd)},${CD(pe)}>${CD(cellMap.abatementEnd)})`;

    cells.push({
      col: colByKey.baseRentApplied.index,
      row: worksheetRow,
      cell: formulaCell(
        `(IF(${freeRentActive},0,IF(${fullAbatement},MAX(0,${sbr}-${cellMap.abatementAmount}),IF(${boundaryAbatement},${sbr}*${cellMap.abatementPartialFactor},${sbr}))))*${pfExpr}`,
        row.baseRentApplied ?? 0,
        FMT.currency,
        nnnFill,
      ),
    });

    // NNN charge columns
    if (assumptions.nnnMode === 'aggregate' && colByKey.nnnAggregate) {
      cells.push({
        col: colByKey.nnnAggregate.index,
        row: worksheetRow,
        cell: formulaCell(
          `(IF(${termGate},0,${cellMap.nnnAgg_year1}*(1+${cellMap.nnnAgg_escRate})^(${yearCol}${worksheetRow}-1)))*${pfExpr}`,
          row.nnnAggregateAmount ?? 0,
          FMT.currency,
          nnnFill,
        ),
      });
    } else {
      for (const column of nnnColumns) {
        const category = column.catDef;
        if (!category) continue;
        cells.push({
          col: column.index,
          row: worksheetRow,
          cell: formulaCell(
            `(IF(${termGate},0,${cellMap[`${category.key}_year1`]}*(1+${cellMap[`${category.key}_escRate`]})^(${yearCol}${worksheetRow}-1)))*${pfExpr}`,
            row[category.amountField] ?? 0,
            FMT.currency,
            nnnFill,
          ),
        });
      }
    }

    // Other charge columns (security, otherItems, etc.)
    for (const column of otherChargeColumns) {
      const category = column.catDef;
      if (!category) continue;
      cells.push({
        col: column.index,
        row: worksheetRow,
        cell: formulaCell(
          `(IF(${termGate},0,${cellMap[`${category.key}_year1`]}*(1+${cellMap[`${category.key}_escRate`]})^(${yearCol}${worksheetRow}-1)))*${pfExpr}`,
          row[category.amountField] ?? 0,
          FMT.currency,
          nnnFill,
        ),
      });
    }

    // Total NNN
    if (nnnColumns.length > 0) {
      const nnnFormula = nnnColumns.map((column) => `${column.letter}${worksheetRow}`).join('+');
      const nnnFallback = nnnColumns.reduce((sum, column) => {
        if (column.catDef) return sum + (row[column.catDef.amountField] ?? 0);
        return sum + (row.nnnAggregateAmount ?? 0);
      }, 0);

      cells.push({
        col: colByKey.totalNNN.index,
        row: worksheetRow,
        cell: formulaCell(nnnFormula, nnnFallback, FMT.currency, nnnFill),
      });
    } else {
      cells.push({
        col: colByKey.totalNNN.index,
        row: worksheetRow,
        cell: calcCell(0, FMT.currency, nnnFill),
      });
    }

    // Non-Recurring Charges (§6.1): dynamic SUMPRODUCT from NRC input table
    if (nrcColumn && nrcDateRange && nrcAmountRange) {
      const nrcFallback = Object.values(row.oneTimeItemAmounts ?? {}).reduce(
        (sum, amt) => sum + (Number(amt) || 0), 0,
      );
      cells.push({
        col: nrcColumn.index,
        row: worksheetRow,
        cell: formulaCell(
          `SUMPRODUCT((${nrcDateRange}<>"")*(${CD(nrcDateRange)}>=${CD(`${periodStartCol}${worksheetRow}`)})*(${CD(nrcDateRange)}<=${CD(`${periodEndCol}${worksheetRow}`)})*${nrcAmountRange})`,
          nrcFallback,
          FMT.currency,
          rowFill,
        ),
      });
    }

    // Total Monthly Obligation (§6.4): baseRentApplied + totalNNN + otherCharges + nonRecurringCharges
    const nrcTerm = nrcColumn ? `+${nrcColumn.letter}${worksheetRow}` : '';
    const otherTerms = otherChargeColumns.map((column) => `+${column.letter}${worksheetRow}`).join('');
    cells.push({
      col: colByKey.totalMonthly.index,
      row: worksheetRow,
      cell: formulaCell(
        `${colByKey.baseRentApplied.letter}${worksheetRow}+${colByKey.totalNNN.letter}${worksheetRow}${otherTerms}${nrcTerm}`,
        row.totalMonthlyObligation ?? 0,
        FMT.currency,
        rowFill,
      ),
    });

    // Effective $/SF (§6.5)
    cells.push({
      col: colByKey.effSF.index,
      row: worksheetRow,
      cell: formulaCell(
        `IF(${cellMap.squareFootage}=0,0,${colByKey.totalMonthly.letter}${worksheetRow}/${cellMap.squareFootage})`,
        row.effectivePerSF ?? 0,
        FMT.sf,
        rowFill,
      ),
    });

    // Remaining balances (§6.6)
    cells.push({
      col: colByKey.obligRem.index,
      row: worksheetRow,
      cell: formulaCell(
        `SUM(${colByKey.totalMonthly.letter}${worksheetRow}:${colByKey.totalMonthly.letter}${lastDataRow})`,
        row.totalObligationRemaining ?? 0,
        FMT.currency,
        rowFill,
      ),
    });

    cells.push({
      col: colByKey.baseRem.index,
      row: worksheetRow,
      cell: formulaCell(
        `SUM(${colByKey.baseRentApplied.letter}${worksheetRow}:${colByKey.baseRentApplied.letter}${lastDataRow})`,
        row.totalBaseRentRemaining ?? 0,
        FMT.currency,
        rowFill,
      ),
    });

    cells.push({
      col: colByKey.nnnRem.index,
      row: worksheetRow,
      cell: formulaCell(
        `SUM(${colByKey.totalNNN.letter}${worksheetRow}:${colByKey.totalNNN.letter}${lastDataRow})`,
        row.totalNNNRemaining ?? 0,
        FMT.currency,
        rowFill,
      ),
    });

    // Other Charges Remaining (§6.6): includes otherCharge cols + NRC column
    const otherRemainingParts = [
      ...otherChargeColumns.map((column) => `SUM(${column.letter}${worksheetRow}:${column.letter}${lastDataRow})`),
      ...(nrcColumn ? [`SUM(${nrcColumn.letter}${worksheetRow}:${nrcColumn.letter}${lastDataRow})`] : []),
    ];

    cells.push({
      col: colByKey.otherRem.index,
      row: worksheetRow,
      cell: formulaCell(
        otherRemainingParts.length > 0 ? otherRemainingParts.join('+') : '0',
        row.totalOtherChargesRemaining ?? 0,
        FMT.currency,
        rowFill,
      ),
    });
  });

  return { cells };
}

function buildTotalsSection(columns, layout) {
  const cells = [];
  const sumRange = (columnIndex) => `SUM(${colLetter(columnIndex)}${layout.firstDataRow}:${colLetter(columnIndex)}${layout.lastDataRow})`;

  cells.push({ col: 0, row: layout.totalsRow, cell: totalLabelCell('TOTAL') });
  for (let columnIndex = 1; columnIndex <= 3; columnIndex += 1) {
    cells.push({ col: columnIndex, row: layout.totalsRow, cell: blankTotalCell() });
  }

  const summableColumns = columns.filter(
    (column) => column.group !== 'fixed' || column.key === 'scheduledBaseRent' || column.key === 'baseRentApplied',
  );

  for (const column of summableColumns) {
    if (['periodStart', 'periodEnd', 'monthNum', 'yearNum'].includes(column.key)) continue;

    if (['effSF', 'obligRem', 'baseRem', 'nnnRem', 'otherRem'].includes(column.key)) {
      cells.push({ col: column.index, row: layout.totalsRow, cell: blankTotalCell() });
    } else {
      cells.push({
        col: column.index,
        row: layout.totalsRow,
        cell: totalCell(sumRange(column.index), 0, FMT.currency),
      });
    }
  }

  return { cells };
}

function buildFootnotesSection(layout) {
  const noteStyle = {
    font: { ...FONT_SM, italic: true, color: { rgb: '555555' } },
    fill: { patternType: 'solid', fgColor: { rgb: C.note } },
    alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
    numFmt: FMT.text,
  };

  const nnnColumnNames = layout.nnnColumns.map((column) => `${column.header} (${column.letter})`).join(' + ');
  const otherColumnNames = layout.otherChargeColumns.map((column) => `${column.header} (${column.letter})`).join(' + ');
  const totalMonthlyLabel = `col ${layout.colByKey.totalMonthly.letter}`;
  const totalNnnLabel = layout.colByKey.totalNNN.letter;
  const nrcLabel = layout.nrcColumn ? ` + Non-Recurring Charges (${layout.nrcColumn.letter})` : '';

  const notes = [
    `① Total NNN (col ${totalNnnLabel}) = ${nnnColumnNames || 'N/A'}. Other Charges (${otherColumnNames || 'none'}) are NOT included in NNN.`,
    `② Total Monthly Obligation (${totalMonthlyLabel}) = Base Rent Applied + Total NNN${otherColumnNames ? ' + Other Charges' : ''}${nrcLabel}.`,
    '③ Remaining: Obligation = SUM of future Total Monthly Obligation. Base Rent / NNN / Other Charges = tail-sums of their respective columns.',
    '④ NNN escalation: Year 1 Monthly Amounts in assumption cells are compounded annually by their escalation rates. Charge columns are live formulas — edit assumptions to recalculate.',
    '⑤ Color guide: Yellow fill + blue text = user-editable inputs | Black text = formula outputs | Red-pink fill = NNN/obligation columns | Amber rows = abatement periods.',
  ];

  return {
    cells: notes.map((note, index) => ({
      col: 0,
      row: layout.noteRow + index,
      cell: { t: 's', v: note, s: noteStyle },
    })),
  };
}

function toSerial(isoDate) {
  if (!isoDate) return null;
  const s = String(isoDate);
  let yr, mo, dy;
  // Primary: YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    [, yr, mo, dy] = iso;
  } else {
    // Fallback: MM/DD/YYYY or M/D/YYYY (prevents text-cell fallback if normalisation was skipped)
    const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!mdy) return null;
    [, mo, dy, yr] = mdy;
  }
  const value = new Date(Number(yr), Number(mo) - 1, Number(dy));
  const epoch = new Date(1899, 11, 30);
  return Math.round((value.getTime() - epoch.getTime()) / 86400000);
}

function dateCell(isoDate, fill, fontColor = C.fcCalc) {
  const serial = toSerial(isoDate);
  if (serial === null) {
    // Always use date format so user-typed dates are stored as serials, not text.
    return {
      t: 's',
      v: isoDate ?? '',
      s: ds(fill, FMT.date, { align: 'center', fontColor }),
    };
  }

  return {
    t: 'n',
    v: serial,
    s: ds(fill, FMT.date, { align: 'center', fontColor }),
  };
}

function inputCell(value, format, fill) {
  return {
    t: 'n',
    v: value ?? 0,
    s: ds(fill, format, { fontColor: C.fcInput }),
  };
}

function calcCell(value, format, fill) {
  return {
    t: 'n',
    v: value ?? 0,
    s: ds(fill, format, { fontColor: C.fcCalc }),
  };
}

function formulaCell(formula, fallback, format, fill) {
  return {
    t: 'n',
    v: fallback ?? 0,
    f: formula,
    s: ds(fill, format, { fontColor: C.fcCalc }),
  };
}

function intCell(value, fill) {
  return {
    t: 'n',
    v: value ?? 0,
    s: ds(fill, FMT.int, { align: 'center', fontColor: C.fcCalc }),
  };
}

function totalCell(formula, fallback, format) {
  return {
    t: 'n',
    v: fallback ?? 0,
    f: formula,
    s: { ...TOTAL_BASE, numFmt: format },
  };
}

function totalLabelCell(value) {
  return {
    t: 's',
    v: value,
    s: { ...TOTAL_BASE, alignment: { horizontal: 'left', vertical: 'middle' } },
  };
}

function blankTotalCell() {
  return { t: 's', v: '', s: TOTAL_BASE };
}
