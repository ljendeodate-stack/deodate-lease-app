import { describe, expect, it } from 'vitest';

import { renderLeaseScheduleWorksheet } from '../builders/renderLeaseScheduleWorksheet.js';
import { buildExportModel } from '../model/buildExportModel.js';
import { resolveLeaseScheduleLayout } from '../resolvers/resolveLeaseScheduleLayout.js';
import { buildLegacyLeaseScheduleSpec } from './legacyLeaseScheduleSpec.js';
import { calculateAllCharges } from '../../engine/calculator.js';
import { expandPeriods } from '../../engine/expander.js';
import { parseMDYStrict } from '../../engine/yearMonth.js';

function buildWorksheet(rows, params, filename = 'lease-schedule') {
  const model = buildExportModel(rows, params, filename);
  const layout = resolveLeaseScheduleLayout(model);
  const spec = buildLegacyLeaseScheduleSpec(model, layout);
  const worksheet = renderLeaseScheduleWorksheet(spec);
  return { model, layout, spec, worksheet };
}

function makeProcessedRows(periods, params) {
  const { rows } = expandPeriods(periods);
  return calculateAllCharges(rows, params);
}

describe('buildLegacyLeaseScheduleSpec', () => {
  it('keeps annual rows dynamic while hardcoding non-annual step-up rows', () => {
    const processedRows = makeProcessedRows([
      { periodStart: parseMDYStrict('01/01/2030'), periodEnd: parseMDYStrict('12/31/2034'), monthlyRent: 10000 },
      { periodStart: parseMDYStrict('01/01/2035'), periodEnd: parseMDYStrict('04/30/2039'), monthlyRent: 12500 },
    ], {
      nnnMode: 'individual',
      squareFootage: 1000,
      oneTimeItems: [],
      charges: [],
      abatementPct: 0,
      abatementEndDate: null,
    });

    const { layout, worksheet } = buildWorksheet(processedRows, { nnnMode: 'individual', squareFootage: 1000 }, 'irregular-step');
    const firstDataRow = layout.firstDataRow;

    expect(worksheet[`A${firstDataRow}`].f).toContain('EDATE');
    expect(worksheet[`E${firstDataRow}`].f).toContain(layout.cellMap.year1BaseRent);
    expect(worksheet[`E${firstDataRow}`].v).toBe(10000);
    expect(worksheet[`F${firstDataRow}`].f).toContain(`${layout.colByKey.scheduledBaseRent.letter}${firstDataRow}`);
    expect(worksheet[`E${firstDataRow + 60}`].f).toBeUndefined();
    expect(worksheet[`E${firstDataRow + 60}`].v).toBe(12500);
    expect(worksheet[`E${firstDataRow + 60}`].s.font.bold).toBe(true);
    expect(worksheet[`E${firstDataRow + 60}`].s.font.color.rgb).toBe('C00000');
    expect(worksheet[`F${firstDataRow + 60}`].f).toBeUndefined();
    expect(worksheet[`F${firstDataRow + 60}`].v).toBe(12500);
    expect(worksheet[`F${firstDataRow + 60}`].s.font.bold).toBe(true);
    expect(worksheet[`F${firstDataRow + 60}`].s.font.color.rgb).toBe('C00000');
  });

  it('keeps explicit dated concession rows hardcoded without collapsing neighboring annual rows', () => {
    const processedRows = makeProcessedRows([
      { periodStart: parseMDYStrict('01/01/2030'), periodEnd: parseMDYStrict('04/30/2030'), monthlyRent: 9000 },
    ], {
      nnnMode: 'individual',
      squareFootage: 1000,
      oneTimeItems: [],
      charges: [],
      abatementPct: 0,
      abatementEndDate: null,
      concessionEvents: [
        { id: 'free_1', type: 'free_rent', scope: 'monthly_row', effectiveDate: parseMDYStrict('02/15/2030'), valueMode: 'percent', value: 100 },
        { id: 'free_2', type: 'free_rent', scope: 'monthly_row', effectiveDate: parseMDYStrict('04/15/2030'), valueMode: 'percent', value: 100 },
      ],
    });

    const { model, layout, worksheet } = buildWorksheet(processedRows, { nnnMode: 'individual', squareFootage: 1000 }, 'free-rent');
    const februaryRow = layout.firstDataRow + 1;
    const marchRow = layout.firstDataRow + 2;
    const aprilRow = layout.firstDataRow + 3;

    expect(model.assumptions.freeRentStart).toBeNull();
    expect(model.assumptions.freeRentEndDate).toBeNull();
    expect(worksheet[`F${februaryRow}`].f).toBeUndefined();
    expect(worksheet[`F${februaryRow}`].v).toBe(0);
    expect(worksheet[`F${marchRow}`].f).toContain(`${layout.colByKey.scheduledBaseRent.letter}${marchRow}`);
    expect(worksheet[`F${marchRow}`].v).toBe(9000);
    expect(worksheet[`F${aprilRow}`].f).toBeUndefined();
    expect(worksheet[`F${aprilRow}`].v).toBe(0);
  });

  it('restores dynamic formulas for regular charge and non-recurring columns', () => {
    const processedRows = makeProcessedRows([
      { periodStart: parseMDYStrict('01/01/2030'), periodEnd: parseMDYStrict('02/28/2030'), monthlyRent: 7000 },
    ], {
      nnnMode: 'individual',
      squareFootage: 1000,
      oneTimeItems: [{ label: 'TI', date: parseMDYStrict('01/10/2030'), amount: 5000 }],
      charges: [{ key: 'parking', canonicalType: 'other', displayLabel: 'Parking', year1: 200, escPct: 0, chargeStart: null, escStart: null }],
      abatementPct: 0,
      abatementEndDate: null,
    });

    const exportParams = {
      nnnMode: 'individual',
      squareFootage: 1000,
      oneTimeItems: [{ label: 'TI', date: parseMDYStrict('01/10/2030'), amount: 5000 }],
      charges: [{ key: 'parking', canonicalType: 'other', displayLabel: 'Parking', year1: 200, escPct: 0, chargeStart: null, escStart: null }],
    };
    const { layout, worksheet } = buildWorksheet(processedRows, exportParams, 'formulas');
    const firstDataRow = layout.firstDataRow;

    expect(worksheet[`E${firstDataRow}`].f).toContain(layout.cellMap.year1BaseRent);
    expect(worksheet[`${layout.colByKey.parking.letter}${firstDataRow}`].f).toContain(layout.cellMap.parking_year1);
    expect(worksheet[`${layout.colByKey.nonRecurringCharges.letter}${firstDataRow}`].f).toContain('SUMPRODUCT');
    expect(worksheet[`${layout.colByKey.totalMonthly.letter}${firstDataRow}`].f).toContain(`${layout.colByKey.baseRentApplied.letter}${firstDataRow}`);
    expect(worksheet[`${layout.colByKey.obligRem.letter}${firstDataRow}`].f).toContain(`:${layout.colByKey.totalMonthly.letter}${layout.lastDataRow}`);
  });

  it('marks recurring charge overrides in bold red and hardcodes those rows', () => {
    const charge = {
      key: 'parking',
      canonicalType: 'other',
      displayLabel: 'Parking',
      year1: 200,
      escPct: 0,
      chargeStart: null,
      escStart: null,
    };

    const processedRows = makeProcessedRows([
      { periodStart: parseMDYStrict('01/01/2030'), periodEnd: parseMDYStrict('03/31/2030'), monthlyRent: 7000 },
    ], {
      nnnMode: 'individual',
      squareFootage: 1000,
      oneTimeItems: [],
      charges: [charge],
      recurringOverrides: [
        { targetKey: 'parking', effectiveDate: parseMDYStrict('02/10/2030'), amount: 325 },
      ],
      abatementPct: 0,
      abatementEndDate: null,
    });

    const { layout, worksheet } = buildWorksheet(processedRows, {
      nnnMode: 'individual',
      squareFootage: 1000,
      charges: [charge],
    }, 'irregular-charge');
    const firstDataRow = layout.firstDataRow;
    const parkingCell = layout.colByKey.parking.letter;

    expect(worksheet[`${parkingCell}${firstDataRow}`].f).toContain(layout.cellMap.parking_year1);
    expect(worksheet[`${parkingCell}${firstDataRow + 1}`].f).toBeUndefined();
    expect(worksheet[`${parkingCell}${firstDataRow + 1}`].v).toBe(325);
    expect(worksheet[`${parkingCell}${firstDataRow + 1}`].s.font.bold).toBe(true);
    expect(worksheet[`${parkingCell}${firstDataRow + 1}`].s.font.color.rgb).toBe('C00000');
  });
});
