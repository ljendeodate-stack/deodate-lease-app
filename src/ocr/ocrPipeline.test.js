import { describe, expect, it } from 'vitest';

import { expandPeriods } from '../engine/expander.js';
import { normalizeFormToCalculatorParams } from '../engine/leaseTerms.js';
import { calculateAllCharges } from '../engine/calculator.js';
import { renderLeaseScheduleWorksheet } from '../export/builders/renderLeaseScheduleWorksheet.js';
import { buildExportModel } from '../export/model/buildExportModel.js';
import { resolveLeaseScheduleLayout } from '../export/resolvers/resolveLeaseScheduleLayout.js';
import { buildLegacyLeaseScheduleSpec } from '../export/specs/legacyLeaseScheduleSpec.js';
import { repairExtractionSemantics } from './extractor.js';
import {
  buildPrepopulatedFormFromOCR,
  ocrScheduleToPeriodRows,
} from './ocrPipeline.js';

function runSyntheticOcrFlow(rawResult, documentText, filename = 'synthetic-lease') {
  const repaired = repairExtractionSemantics(rawResult, documentText);
  const periodRows = ocrScheduleToPeriodRows(repaired.rentSchedule);
  const { rows: expandedRows } = expandPeriods(periodRows);
  const prepopulated = buildPrepopulatedFormFromOCR(repaired, expandedRows);
  const params = normalizeFormToCalculatorParams(prepopulated.formState, expandedRows);
  const processedRows = calculateAllCharges(expandedRows, params);
  const exportModel = buildExportModel(processedRows, params, filename);
  const leaseLayout = resolveLeaseScheduleLayout(exportModel);
  const leaseSpec = buildLegacyLeaseScheduleSpec(exportModel, leaseLayout);
  const worksheet = renderLeaseScheduleWorksheet(leaseSpec);

  return {
    repaired,
    periodRows,
    expandedRows,
    prepopulated,
    params,
    processedRows,
    exportModel,
    worksheet,
    firstDataRow: leaseLayout.firstDataRow,
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
      worksheet,
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

    const scheduledBaseYear1 = getDataCell(worksheet, exportModel, firstDataRow, 'scheduledBaseRent', 0);
    const scheduledBaseYear2 = getDataCell(worksheet, exportModel, firstDataRow, 'scheduledBaseRent', 12);
    const camsYear1 = getDataCell(worksheet, exportModel, firstDataRow, 'cams', 0);
    const camsYear2 = getDataCell(worksheet, exportModel, firstDataRow, 'cams', 12);
    const effSfYear1 = getDataCell(worksheet, exportModel, firstDataRow, 'effSF', 0);

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

  it('preserves detected one-time wording variants through form, preview, and export without seeded NRC labels', () => {
    const variantResult = {
      leaseName: 'Synthetic NRC Variants Lease',
      sfRequired: false,
      squareFootage: 18000,
      confidenceFlags: [],
      notices: [],
      rentSchedule: [
        { periodStart: '01/01/2026', periodEnd: '12/31/2026', monthlyRent: 25000 },
      ],
      recurringCharges: [],
      oneTimeCharges: [
        { label: 'Tenant Improvement Allowance (TIA)', amount: -50000, dueDate: '01/15/2026' },
        { label: 'Landlord Work Contribution', amount: -12000, dueDate: '02/01/2026' },
        { label: 'Parking Deposit', amount: 3500, dueDate: '03/01/2026' },
        { label: 'Signage Allowance', amount: -2500, dueDate: '04/01/2026' },
      ],
    };

    const {
      prepopulated,
      processedRows,
      exportModel,
    } = runSyntheticOcrFlow(
      variantResult,
      [
        'Tenant Improvement Allowance (TIA): Landlord shall fund $50,000.00 on January 15, 2026.',
        'Landlord Work Contribution: $12,000.00 payable February 1, 2026.',
        'Parking Deposit: Tenant shall deposit $3,500.00 on March 1, 2026.',
        'Signage Allowance: Landlord credit of $2,500.00 on April 1, 2026.',
      ].join('\n'),
      'synthetic-nrc-variants',
    );

    expect(prepopulated.formState.oneTimeItems).toEqual([
      { label: 'Tenant Improvement Allowance (TIA)', date: '01/15/2026', amount: '-50000' },
      { label: 'Landlord Work Contribution', date: '02/01/2026', amount: '-12000' },
      { label: 'Parking Deposit', date: '03/01/2026', amount: '3500' },
      { label: 'Signage Allowance', date: '04/01/2026', amount: '-2500' },
    ]);

    expect(processedRows[0].oneTimeItemAmounts['Tenant Improvement Allowance (TIA)']).toBe(-50000);
    expect(processedRows[1].oneTimeItemAmounts['Landlord Work Contribution']).toBe(-12000);
    expect(processedRows[2].oneTimeItemAmounts['Parking Deposit']).toBe(3500);
    expect(processedRows[3].oneTimeItemAmounts['Signage Allowance']).toBe(-2500);

    expect(exportModel.assumptions.oneTimeItems.slice(0, 4).map((item) => item.label)).toEqual([
      'Tenant Improvement Allowance (TIA)',
      'Landlord Work Contribution',
      'Parking Deposit',
      'Signage Allowance',
    ]);
    expect(exportModel.assumptions.oneTimeItems.slice(4).every((item) => item.label === '')).toBe(true);
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
      worksheet,
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

    const scheduledBaseYear1 = getDataCell(worksheet, exportModel, firstDataRow, 'scheduledBaseRent', 0);
    const scheduledBaseStep = getDataCell(worksheet, exportModel, firstDataRow, 'scheduledBaseRent', 60);
    const appliedBaseStep = getDataCell(worksheet, exportModel, firstDataRow, 'baseRentApplied', 60);
    const totalMonthlyStep = getDataCell(worksheet, exportModel, firstDataRow, 'totalMonthly', 60);

    expect(scheduledBaseYear1.f).toBeDefined();
    expect(scheduledBaseStep.f).toBeUndefined();
    expect(scheduledBaseStep.v).toBe(12500);
    expect(appliedBaseStep.f).toBeUndefined();
    expect(appliedBaseStep.v).toBe(12500);
    expect(totalMonthlyStep.f).toBeDefined();
  });

  it('materializes semantic month-bucket OCR schedules and carries the anchor date into the assumption form', () => {
    const semanticResult = {
      leaseName: 'Synthetic Semantic Lease',
      sfRequired: false,
      squareFootage: 15000,
      confidenceFlags: [],
      notices: [],
      rentSchedule: [],
      recurringCharges: [],
      oneTimeCharges: [],
    };

    const {
      repaired,
      periodRows,
      expandedRows,
      prepopulated,
      processedRows,
    } = runSyntheticOcrFlow(
      semanticResult,
      [
        'Commencement Date shall be January 15, 2030.',
        'Minimum Annual Rent shall commence on the first full calendar month after the Commencement Date.',
        'Months 1-60: $37,187.50 monthly',
        'Months 61-120: $40,906.25 monthly',
      ].join('\n'),
      'synthetic-semantic',
    );

    expect(repaired.scheduleNormalization).toMatchObject({
      materializationStatus: 'resolved',
      preferredRepresentationType: 'relative_month_ranges',
      preferredAnchorDate: '02/01/2030',
    });
    expect(repaired.rentSchedule).toEqual([
      { periodStart: '02/01/2030', periodEnd: '01/31/2035', monthlyRent: 37187.5 },
      { periodStart: '02/01/2035', periodEnd: '01/31/2040', monthlyRent: 40906.25 },
    ]);
    expect(prepopulated.formState.rentCommencementDate).toBe('02/01/2030');
    expect(periodRows).toHaveLength(2);
    expect(expandedRows).toHaveLength(120);
    expect(processedRows[0].scheduledBaseRent).toBe(37187.5);
    expect(processedRows[60].scheduledBaseRent).toBe(40906.25);
  });

  it('converts OCR-detected irregular recurring charge steps into override-driven preview and workbook values without interrupting annual base-rent formulas', () => {
    const irregularRecurringResult = {
      leaseName: 'Synthetic Irregular Recurring Charges',
      sfRequired: false,
      squareFootage: 24000,
      confidenceFlags: [],
      notices: [],
      rentSchedule: [
        { periodStart: '02/01/2027', periodEnd: '01/31/2028', monthlyRent: 32000 },
        { periodStart: '02/01/2028', periodEnd: '01/31/2029', monthlyRent: 32960 },
        { periodStart: '02/01/2029', periodEnd: '01/31/2030', monthlyRent: 33948.8 },
      ],
      recurringCharges: [
        {
          label: 'Common Area Maintenance',
          bucketKey: 'cams',
          canonicalType: 'nnn',
          year1: 4800,
          escPct: null,
          chargeStart: '02/01/2027',
          escStart: '02/01/2028',
          confidence: 0.98,
        },
      ],
    };

    const {
      repaired,
      prepopulated,
      processedRows,
      exportModel,
      worksheet,
      firstDataRow,
    } = runSyntheticOcrFlow(
      irregularRecurringResult,
      [
        'Base Rent Schedule',
        'February 1, 2027 through January 31, 2028: $32,000.00 per month',
        'February 1, 2028 through January 31, 2029: $32,960.00 per month',
        'February 1, 2029 through January 31, 2030: $33,948.80 per month',
        'Common Area Maintenance:',
        'February 1, 2027 through January 31, 2028: $4,800.00 per month',
        'February 1, 2028 through January 31, 2029: $5,050.00 per month',
        'February 1, 2029 through January 31, 2030: $5,600.00 per month',
      ].join('\n'),
      'synthetic-irregular-recurring',
    );

    expect(repaired.recurringOverrideHints).toEqual([
      expect.objectContaining({ bucketKey: 'cams', date: '02/01/2028', amount: 5050 }),
      expect.objectContaining({ bucketKey: 'cams', date: '02/01/2029', amount: 5600 }),
    ]);
    expect(prepopulated.formState.recurringOverrides).toEqual([
      expect.objectContaining({ targetKey: 'cams', date: '02/01/2028', amount: '5050' }),
      expect.objectContaining({ targetKey: 'cams', date: '02/01/2029', amount: '5600' }),
    ]);
    expect(prepopulated.formState.charges.find((charge) => charge.key === 'cams')).toMatchObject({
      year1: '4800',
      escPct: '',
      escStart: '',
    });

    expect(processedRows[12].chargeAmounts.cams).toBe(5050);
    expect(processedRows[12].chargeDetails.cams.overrideApplied).toBe(true);
    expect(processedRows[12].hasIrregularEscalation).toBe(true);
    expect(processedRows[24].chargeAmounts.cams).toBe(5600);
    expect(processedRows[24].chargeDetails.cams.overrideApplied).toBe(true);

    const baseRentYear2 = getDataCell(worksheet, exportModel, firstDataRow, 'scheduledBaseRent', 12);
    const camsYear1 = getDataCell(worksheet, exportModel, firstDataRow, 'cams', 0);
    const camsYear2 = getDataCell(worksheet, exportModel, firstDataRow, 'cams', 12);
    const camsYear3 = getDataCell(worksheet, exportModel, firstDataRow, 'cams', 24);

    expect(baseRentYear2.f).toBeDefined();
    expect(camsYear1.f).toBeDefined();
    expect(camsYear2.f).toBeUndefined();
    expect(camsYear2.v).toBe(5050);
    expect(camsYear3.f).toBeUndefined();
    expect(camsYear3.v).toBe(5600);
  });
});
