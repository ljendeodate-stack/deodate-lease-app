import XLSX from 'xlsx-js-style';

const FORMULA_ERROR_PATTERN = /#(?:REF|VALUE|NAME|DIV\/0|NUM|N\/A|NULL)!/i;

function readCell(sheet, address) {
  const cell = sheet[address];
  return {
    address,
    value: cell?.v ?? null,
    display: cell?.w ?? null,
    formula: cell?.f ?? null,
    style: cell?.s ?? null,
    type: cell?.t ?? null,
    raw: cell ?? null,
  };
}

function findFormulaErrors(sheet) {
  return Object.entries(sheet)
    .filter(([address]) => !address.startsWith('!'))
    .map(([address, cell]) => ({ address, cell }))
    .filter(({ cell }) =>
      cell?.t === 'e' ||
      (typeof cell?.v === 'string' && FORMULA_ERROR_PATTERN.test(cell.v)) ||
      (typeof cell?.w === 'string' && FORMULA_ERROR_PATTERN.test(cell.w)) ||
      (typeof cell?.f === 'string' && FORMULA_ERROR_PATTERN.test(cell.f))
    )
    .map(({ address, cell }) => ({
      address,
      formula: cell?.f ?? null,
      value: cell?.v ?? null,
    }));
}

/**
 * Extract column letter(s) referenced in a cross-sheet SUMIF/COUNTIF formula.
 * For a formula like SUMIF('Lease Schedule'!$D$75:$D$198,...,'Lease Schedule'!$F$75:$F$198)
 * returns the unique column letters referenced against 'Lease Schedule'.
 */
function extractLeaseScheduleCols(formula) {
  if (!formula) return [];
  const matches = [...formula.matchAll(/'Lease Schedule'!\$([A-Z]+)\$/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

/**
 * Read the Annual Summary sheet from a workbook buffer.
 *
 * @param {Buffer|Uint8Array} workbookBytes
 * @param {object[]} processedRows — engine-calculated rows for expected-value checks
 * @returns {object} semantic snapshot of the Annual Summary sheet
 */
export function readAnnualSummaryWorkbook(workbookBytes, processedRows) {
  const workbook = XLSX.read(workbookBytes, {
    type: 'buffer',
    cellStyles: true,
    cellFormula: true,
    cellNF: true,
  });

  const summarySheet = workbook.Sheets['Annual Summary'];
  if (!summarySheet) {
    throw new Error('Annual Summary sheet is missing from the exported workbook.');
  }

  const leaseSheet = workbook.Sheets['Lease Schedule'];

  // ── Header row ────────────────────────────────────────────────────────────
  const headers = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((col) =>
    readCell(summarySheet, `${col}1`)
  );

  // ── Infer row count from sheet ref ────────────────────────────────────────
  const sheetRef = summarySheet['!ref'] ?? '';
  const refMatch = sheetRef.match(/\d+$/);
  const lastRow  = refMatch ? parseInt(refMatch[0], 10) : 0;
  const yearCount = Math.max(0, lastRow - 2); // rows 2..lastRow-1 are year rows

  // ── Year data rows ────────────────────────────────────────────────────────
  const yearRows = [];
  for (let r = 2; r < lastRow; r++) {
    yearRows.push({
      row: r,
      leaseYear:    readCell(summarySheet, `C${r}`),
      months:       readCell(summarySheet, `D${r}`),
      baseRent:     readCell(summarySheet, `E${r}`),
      totalNNN:     readCell(summarySheet, `F${r}`),
      totalMonthly: readCell(summarySheet, `G${r}`),
      pctOfTotal:   readCell(summarySheet, `H${r}`),
    });
  }

  // ── Grand total row ───────────────────────────────────────────────────────
  const totalRow = {
    row: lastRow,
    label:        readCell(summarySheet, `A${lastRow}`),
    months:       readCell(summarySheet, `D${lastRow}`),
    baseRent:     readCell(summarySheet, `E${lastRow}`),
    totalNNN:     readCell(summarySheet, `F${lastRow}`),
    totalMonthly: readCell(summarySheet, `G${lastRow}`),
    pctDisplay:   readCell(summarySheet, `H${lastRow}`),
  };

  // ── Cross-sheet formula analysis ──────────────────────────────────────────
  // Inspect the first year data row (row 2) for formula structure
  const sampleBaseRentFormula   = yearRows[0]?.baseRent?.formula ?? '';
  const sampleNNNFormula        = yearRows[0]?.totalNNN?.formula ?? '';
  const sampleMonthlyFormula    = yearRows[0]?.totalMonthly?.formula ?? '';
  const samplePctFormula        = yearRows[0]?.pctOfTotal?.formula ?? '';
  const sampleMonthsFormula     = yearRows[0]?.months?.formula ?? '';

  const baseRentCols   = extractLeaseScheduleCols(sampleBaseRentFormula);
  const nnnCols        = extractLeaseScheduleCols(sampleNNNFormula);
  const monthlyCols    = extractLeaseScheduleCols(sampleMonthlyFormula);

  // Compute expected year-level totals from processedRows
  const yearTotals = {};
  for (const row of processedRows) {
    const y = row.leaseYear ?? row['Year #'];
    if (!y) continue;
    if (!yearTotals[y]) yearTotals[y] = { baseRent: 0, totalNNN: 0, totalMonthly: 0, months: 0 };
    yearTotals[y].baseRent   += row.baseRentApplied ?? 0;
    yearTotals[y].totalNNN   += row.totalNNNAmount  ?? 0;
    yearTotals[y].totalMonthly += row.totalMonthlyObligation ?? 0;
    yearTotals[y].months     += 1;
  }

  const grandTotalBaseRent   = Object.values(yearTotals).reduce((s, t) => s + t.baseRent, 0);
  const grandTotalNNN        = Object.values(yearTotals).reduce((s, t) => s + t.totalNNN, 0);
  const grandTotalMonthly    = Object.values(yearTotals).reduce((s, t) => s + t.totalMonthly, 0);
  const grandTotalMonths     = Object.values(yearTotals).reduce((s, t) => s + t.months, 0);

  return {
    workbook,
    summarySheet,
    leaseSheet,
    formulaErrors: findFormulaErrors(summarySheet),
    headers,
    yearCount,
    yearRows,
    totalRow,
    formulaSemantics: {
      referencesLeaseSchedule:   /['"]Lease Schedule['"]/i.test(sampleBaseRentFormula),
      noLegacySheetName:         !/'Lease Schedule \(populated\)'/i.test(sampleBaseRentFormula + sampleNNNFormula + sampleMonthlyFormula),
      baseRentUsesLeaseScheduleF: baseRentCols.includes('F'),
      yearNumUsesLeaseScheduleD:  baseRentCols.includes('D') || /\$D\$/.test(sampleBaseRentFormula),
      nnnColsDynamic:             nnnCols.length > 0 && !nnnCols.includes('F'),
      monthlyColsDynamic:         monthlyCols.length > 0,
      pctFormulaRefsTotRow:       samplePctFormula.includes(`G${lastRow}`),
      countifUsedForMonths:       /COUNTIF/i.test(sampleMonthsFormula),
      sumifUsedForValues:         /SUMIF/i.test(sampleBaseRentFormula),
    },
    expectedTotals: {
      yearTotals,
      grandTotalBaseRent,
      grandTotalNNN,
      grandTotalMonthly,
      grandTotalMonths,
    },
  };
}
