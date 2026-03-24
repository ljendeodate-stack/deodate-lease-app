import XLSX from 'xlsx-js-style';
import { expandPeriods } from '../../../engine/expander.js';
import { calculateAllCharges } from '../../../engine/calculator.js';
import { buildXLSXWorkbook } from '../../../utils/exportUtils.js';

function toExcelSerial(date) {
  if (!date) return null;
  const epoch = new Date(1899, 11, 30);
  return Math.round((date.getTime() - epoch.getTime()) / 86400000);
}

function cloneCell(cell = {}) {
  return {
    ...cell,
    s: cell.s ? { ...cell.s } : cell.s,
  };
}

export function buildScenarioFixtureWorkbook(fixture) {
  const { rows: expandedRows, duplicateDates, warnings } = expandPeriods(fixture.periodRows);
  const processedRows = calculateAllCharges(expandedRows, fixture.params);
  const { workbook } = buildXLSXWorkbook(processedRows, fixture.params, fixture.filename);

  if (fixture.analysisDate) {
    const sheet = workbook.Sheets['Scenario Analysis'];
    const existing = cloneCell(sheet.I5);
    sheet.I5 = {
      ...existing,
      t: 'n',
      v: toExcelSerial(fixture.analysisDate),
      w: XLSX.SSF.format(existing?.s?.numFmt || 'mm/dd/yyyy', toExcelSerial(fixture.analysisDate)),
    };
  }

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
    duplicateDates,
    warnings,
  };
}
