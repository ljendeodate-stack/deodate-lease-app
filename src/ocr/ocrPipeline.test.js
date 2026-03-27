import { describe, expect, it } from 'vitest';

import { expandPeriods } from '../engine/expander.js';
import { normalizeFormToCalculatorParams } from '../engine/leaseTerms.js';
import { calculateAllCharges } from '../engine/calculator.js';
import { buildExportModel } from '../export/model/buildExportModel.js';
import { buildXLSXWorkbook } from '../utils/exportUtils.js';
import { repairSfBasedRentSemantics } from './extractor.js';
import {
  buildPrepopulatedFormFromOCR,
  ocrScheduleToPeriodRows,
} from './ocrPipeline.js';

function runSyntheticOcrFlow(rawResult, documentText, filename = 'synthetic-lease') {
  const repaired = repairSfBasedRentSemantics(rawResult, documentText);
  const periodRows = ocrScheduleToPeriodRows(repaired.rentSchedule);
  const { rows: expandedRows } = expandPeriods(periodRows);
  const prepopulated = buildPrepopulatedFormFromOCR(repaired, expandedRows);
  const params = normalizeFormToCalculatorParams(prepopulated.formState, expandedRows);
  const processedRows = calculateAllCharges(expandedRows, params);
  const exportModel = buildExportModel(processedRows, params, filename);
  const { workbook, firstDataRow } = buildXLSXWorkbook(processedRows, params, filename);

  return {
    repaired,
    periodRows,
    expandedRows,
    prepopulated,
    params,
    processedRows,
    exportModel,
    workbook,
    firstDataRow,
  };
}

function getDataCell(sheet, exportModel, firstDataRow, columnKey, rowOffset) {
  const column = exportModel.columns.find((entry) => entry.key === columnKey);
  if (!column) {
    throw new Error(`Column not found: ${columnKey}`);
  }
  return sheet[`${column.letter}${firstDataRow + rowOffset}`];
}

describe('synthetic OCR pipeline', () => {
  it('flows annual $/SF OCR data through auto-population, calculator, and workbook export', () => {
    const annualResult = {
      leaseName: 'Synthetic SF Annual Lease',
      sfRequired: false,
      squareFootage: 20000,
      confidenceFlags: [],
      notices: [],
      rentSchedule: [
        { periodStart: '01/01/2025', periodEnd: '12/31/2025', monthlyRent: 40000 },
        { periodStart: '01/01/2026', periodEnd: '12/31/2026', monthlyRent: 41200 },
      ],
      recurringCharges: [
        {
          label: 'Operating Expenses',
          bucketKey: 'cams',
          canonicalType: 'nnn',
          year1: 5000,
          escPct: 3,
          chargeStart: '01/01/2025',
          escStart: '01/01/2025',
          confidence: 0.98,
        },
      ],
      oneTimeCharges: [
        { label: 'HVAC Allowance', amount: 20000, dueDate: '03/15/2025' },
      ],
    };

    const {
      repaired,
      prepopulated,
      processedRows,
      exportModel,
      workbook,
      firstDataRow,
    } = runSyntheticOcrFlow(
      annualResult,
      'Base Rent shall be $24.00 per rentable square foot per year during Lease Year 1 and shall increase 3.0% annually thereafter.',
      'synthetic-sf-annual',
    );

    expect(repaired.sfRequired).toBe(true);
    expect(prepopulated.sfRequired).toBe(true);
    expect(prepopulated.formState.squareFootage).toBe('20000');
    expect(prepopulated.formState.nnnMode).toBe('individual');
    expect(prepopulated.formState.charges.find((charge) => charge.key === 'cams')?.displayLabel).toBe('Operating Expenses');
    expect(prepopulated.formState.oneTimeItems).toEqual([
      { label: 'HVAC Allowance', date: '03/15/2025', amount: '20000' },
    ]);

    expect(processedRows).toHaveLength(24);
    expect(processedRows[0].effectivePerSF).toBe(2.25);
    expect(processedRows[2].oneTimeItemAmounts['HVAC Allowance']).toBe(20000);
    expect(processedRows[12].chargeAmounts.cams).toBe(5150);

    const sheet = workbook.Sheets['Lease Schedule'];
    const scheduledBaseYear1 = getDataCell(sheet, exportModel, firstDataRow, 'scheduledBaseRent', 0);
    const scheduledBaseYear2 = getDataCell(sheet, exportModel, firstDataRow, 'scheduledBaseRent', 12);
    const camsYear1 = getDataCell(sheet, exportModel, firstDataRow, 'cams', 0);
    const camsYear2 = getDataCell(sheet, exportModel, firstDataRow, 'cams', 12);
    const effSfYear1 = getDataCell(sheet, exportModel, firstDataRow, 'effSF', 0);

    expect(scheduledBaseYear1.f).toBeDefined();
    expect(scheduledBaseYear1.v).toBe(40000);
    expect(scheduledBaseYear2.f).toBeDefined();
    expect(scheduledBaseYear2.v).toBe(41200);
    expect(camsYear1.f).toBeDefined();
    expect(camsYear1.v).toBe(5000);
    expect(camsYear2.f).toBeDefined();
    expect(camsYear2.v).toBe(5150);
    expect(effSfYear1.f).toBeDefined();
    expect(effSfYear1.v).toBe(2.25);
  });

  it('flows an irregular stepped rent schedule through to hardcoded workbook rent cells', () => {
    const irregularResult = {
      leaseName: 'Synthetic Irregular Step Lease',
      sfRequired: false,
      squareFootage: 15000,
      confidenceFlags: [],
      notices: [],
      rentSchedule: [
        { periodStart: '01/01/2030', periodEnd: '12/31/2034', monthlyRent: 10000 },
        { periodStart: '01/01/2035', periodEnd: '12/31/2039', monthlyRent: 12500 },
      ],
      recurringCharges: [
        {
          label: 'Taxes',
          bucketKey: 'taxes',
          canonicalType: 'nnn',
          year1: 800,
          escPct: 2,
          chargeStart: '01/01/2030',
          escStart: '01/01/2030',
          confidence: 0.97,
        },
      ],
    };

    const {
      prepopulated,
      processedRows,
      exportModel,
      workbook,
      firstDataRow,
    } = runSyntheticOcrFlow(
      irregularResult,
      'Base rent is $10,000.00 per month for Lease Years 1 through 5 and $12,500.00 per month for Lease Years 6 through 10.',
      'synthetic-irregular-step',
    );

    expect(prepopulated.formState.squareFootage).toBe('15000');
    expect(prepopulated.formState.charges.find((charge) => charge.key === 'taxes')?.displayLabel).toBe('Taxes');

    expect(processedRows[59].scheduledBaseRent).toBe(10000);
    expect(processedRows[59].isIrregularBaseRent).toBe(false);
    expect(processedRows[60].scheduledBaseRent).toBe(12500);
    expect(processedRows[60].baseRentApplied).toBe(12500);
    expect(processedRows[60].isIrregularBaseRent).toBe(true);
    expect(processedRows[60].hasIrregularEscalation).toBe(true);

    const sheet = workbook.Sheets['Lease Schedule'];
    const scheduledBaseYear1 = getDataCell(sheet, exportModel, firstDataRow, 'scheduledBaseRent', 0);
    const scheduledBaseStep = getDataCell(sheet, exportModel, firstDataRow, 'scheduledBaseRent', 60);
    const appliedBaseStep = getDataCell(sheet, exportModel, firstDataRow, 'baseRentApplied', 60);
    const totalMonthlyStep = getDataCell(sheet, exportModel, firstDataRow, 'totalMonthly', 60);

    expect(scheduledBaseYear1.f).toBeDefined();
    expect(scheduledBaseStep.f).toBeUndefined();
    expect(scheduledBaseStep.v).toBe(12500);
    expect(appliedBaseStep.f).toBeUndefined();
    expect(appliedBaseStep.v).toBe(12500);
    expect(totalMonthlyStep.f).toBeDefined();
  });
});
