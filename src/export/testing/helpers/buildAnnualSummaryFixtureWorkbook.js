import XLSX from 'xlsx-js-style';
import { expandPeriods } from '../../../engine/expander.js';
import { calculateAllCharges } from '../../../engine/calculator.js';
import { buildXLSXWorkbook } from '../../../utils/exportUtils.js';

export function buildAnnualSummaryFixtureWorkbook(fixture) {
  const { rows: expandedRows } = expandPeriods(fixture.periodRows);
  const processedRows = calculateAllCharges(expandedRows, fixture.params);
  const { workbook } = buildXLSXWorkbook(processedRows, fixture.params, fixture.filename);

  const bytes = XLSX.write(workbook, {
    bookType: 'xlsx',
    type: 'buffer',
    cellStyles: true,
  });

  return {
    fixture,
    workbook,
    workbookBytes: bytes,
    expandedRows,
    processedRows,
  };
}
