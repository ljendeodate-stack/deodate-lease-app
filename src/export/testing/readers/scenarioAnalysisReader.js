import XLSX from 'xlsx-js-style';
import { parseISODate, toISOLocal } from '../../../engine/yearMonth.js';

const FORMULA_ERROR_PATTERN = /#(?:REF|VALUE|NAME|DIV\/0|NUM|N\/A|NULL)!/i;
const BLUE_FONT = '0000FF';

function parseExcelDateCell(cell) {
  if (!cell) return null;
  if (typeof cell.v === 'number') {
    const epoch = new Date(1899, 11, 30);
    const date = new Date(epoch.getTime() + Math.round(cell.v) * 86400000);
    date.setHours(0, 0, 0, 0);
    return date;
  }
  if (typeof cell.w === 'string') {
    const parsed = new Date(cell.w);
    if (!Number.isNaN(parsed.getTime())) {
      parsed.setHours(0, 0, 0, 0);
      return parsed;
    }
  }
  return null;
}

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
      display: cell?.w ?? null,
    }));
}

function resolveEffectiveRow(rows, analysisDate) {
  const defaultRow = rows[0] ?? null;
  if (!defaultRow || !analysisDate) return defaultRow;

  let resolved = defaultRow;
  for (const row of rows) {
    const rowDate = parseISODate(row.periodStart ?? row.date);
    if (!rowDate) continue;
    if (rowDate.getTime() <= analysisDate.getTime()) {
      resolved = row;
    } else {
      break;
    }
  }
  return resolved;
}

export function readScenarioAnalysisWorkbook(workbookBytes, processedRows) {
  const workbook = XLSX.read(workbookBytes, {
    type: 'buffer',
    cellStyles: true,
    cellFormula: true,
    cellNF: true,
  });
  const scenarioSheet = workbook.Sheets['Scenario Analysis'];
  if (!scenarioSheet) {
    throw new Error('Scenario Analysis sheet is missing from the exported workbook.');
  }

  const effectiveDateCell = readCell(scenarioSheet, 'I5');
  const effectiveDate = parseExcelDateCell(effectiveDateCell.raw);
  const effectiveRow = resolveEffectiveRow(processedRows, effectiveDate);

  const firstScheduleDate = processedRows[0]
    ? parseISODate(processedRows[0].periodStart ?? processedRows[0].date)
    : null;

  return {
    workbook,
    scenarioSheet,
    formulaErrors: findFormulaErrors(scenarioSheet),
    firstScheduleDateIso: firstScheduleDate ? toISOLocal(firstScheduleDate) : null,
    effectiveDateIso: effectiveDate ? toISOLocal(effectiveDate) : null,
    effectiveDateCell,
    effectiveRow,
    labels: {
      renegotiationAdditionalRent: readCell(scenarioSheet, 'E18'),
      exitAdditionalRent: readCell(scenarioSheet, 'E37'),
    },
    cells: {
      currentRemainingObligation: readCell(scenarioSheet, 'F5'),
      currentRemainingBase: readCell(scenarioSheet, 'F6'),
      currentRemainingNets: readCell(scenarioSheet, 'F7'),
      currentRemainingOther: readCell(scenarioSheet, 'F8'),
      monthlyBaseRent: readCell(scenarioSheet, 'F16'),
      additionalRent: readCell(scenarioSheet, 'F18'),
      totalOccupancyCost: readCell(scenarioSheet, 'F19'),
      effectivePsf: readCell(scenarioSheet, 'F20'),
      leaseObligationFv: readCell(scenarioSheet, 'F21'),
      fullLeaseFv: readCell(scenarioSheet, 'F29'),
      exitRemainingObligation: readCell(scenarioSheet, 'F40'),
    },
    formulaSemantics: {
      currentRemainingUsesApproximateLookup: /XLOOKUP\(.+,-1\)/i.test(readCell(scenarioSheet, 'F5').formula ?? ''),
      snapshotBaseUsesApproximateLookup: /XLOOKUP\(.+,-1\)/i.test(readCell(scenarioSheet, 'F16').formula ?? ''),
      snapshotAdditionalRentUsesApproximateLookup: /XLOOKUP\(.+,-1\)/i.test(readCell(scenarioSheet, 'F18').formula ?? ''),
      additionalRentTargetsTotalNnn: /'Lease Schedule'!\$[A-Z]+\$\d+:\$[A-Z]+\$\d+/i.test(readCell(scenarioSheet, 'F18').formula ?? ''),
      analysisDateDefaultsToSchedule: /^'Lease Schedule'!A\d+$/i.test(effectiveDateCell.formula ?? ''),
    },
    styleSignals: {
      analysisDateUsesBlueInputFont:
        String(effectiveDateCell.style?.font?.color?.rgb ?? '').toUpperCase() === BLUE_FONT,
    },
    semanticSnapshot: effectiveRow ? {
      monthlyBaseRent: effectiveRow.scheduledBaseRent ?? 0,
      additionalRent: effectiveRow.totalNNNAmount ?? 0,
      totalOccupancyCost: (effectiveRow.scheduledBaseRent ?? 0) + (effectiveRow.totalNNNAmount ?? 0),
      remainingObligation: effectiveRow.totalObligationRemaining ?? 0,
      remainingBaseRent: effectiveRow.totalBaseRentRemaining ?? 0,
      remainingNets: effectiveRow.totalNNNRemaining ?? 0,
      remainingOtherCharges: effectiveRow.totalOtherChargesRemaining ?? 0,
      fullLeaseFv: processedRows.reduce((sum, row) => sum + (row.totalMonthlyObligation ?? 0), 0),
    } : null,
  };
}
