import { describe, expect, it } from 'vitest';

import { buildXLSXWorkbook } from './exportUtils.js';
import { calculateAllCharges } from '../engine/calculator.js';
import { expandPeriods } from '../engine/expander.js';
import { parseMDYStrict } from '../engine/yearMonth.js';

function makeWorkbook(periods, params = {}, exportParams = {}) {
  const { rows } = expandPeriods(periods);
  const processedRows = calculateAllCharges(rows, {
    nnnMode: 'individual',
    squareFootage: 1000,
    oneTimeItems: [],
    charges: [],
    abatementPct: 0,
    abatementEndDate: null,
    ...params,
  });
  return {
    processedRows,
    ...buildXLSXWorkbook(processedRows, { nnnMode: 'individual', squareFootage: 1000, ...exportParams }, 'parity'),
  };
}

describe('buildXLSXWorkbook', () => {
  it('keeps preview and workbook aligned for a five-year stepped schedule', () => {
    const { workbook, firstDataRow } = makeWorkbook([
      { periodStart: parseMDYStrict('01/01/2030'), periodEnd: parseMDYStrict('12/31/2034'), monthlyRent: 10000 },
      { periodStart: parseMDYStrict('01/01/2035'), periodEnd: parseMDYStrict('04/30/2039'), monthlyRent: 12500 },
    ]);

    const sheet = workbook.Sheets['Lease Schedule'];
    expect(sheet[`E${firstDataRow}`].f).toBeDefined();
    expect(sheet[`E${firstDataRow}`].v).toBe(10000);
    expect(sheet[`E${firstDataRow + 60}`].f).toBeUndefined();
    expect(sheet[`E${firstDataRow + 60}`].v).toBe(12500);
  });

  it('keeps preview and workbook aligned for a dated abatement event', () => {
    const { workbook, firstDataRow, processedRows } = makeWorkbook([
      { periodStart: parseMDYStrict('01/01/2030'), periodEnd: parseMDYStrict('03/31/2030'), monthlyRent: 10000 },
    ], {
      concessionEvents: [
        { id: 'abatement_1', type: 'abatement', scope: 'monthly_row', effectiveDate: parseMDYStrict('03/10/2030'), valueMode: 'percent', value: 40 },
      ],
    });

    const sheet = workbook.Sheets['Lease Schedule'];
    expect(sheet[`F${firstDataRow}`].f).toContain(`E${firstDataRow}`);
    expect(sheet[`F${firstDataRow + 2}`].f).toBeUndefined();
    expect(sheet[`F${firstDataRow + 2}`].v).toBe(processedRows[2].baseRentApplied);
    expect(sheet[`F${firstDataRow + 2}`].v).toBe(6000);
  });

  it('adds concession trace metadata to the audit trail', () => {
    const { workbook } = makeWorkbook([
      { periodStart: parseMDYStrict('01/01/2030'), periodEnd: parseMDYStrict('01/31/2030'), monthlyRent: 10000 },
    ], {
      concessionEvents: [
        { id: 'free_1', type: 'free_rent', scope: 'monthly_row', effectiveDate: parseMDYStrict('01/05/2030'), valueMode: 'percent', value: 100, label: 'Opening month' },
      ],
    });

    const sheet = workbook.Sheets['Audit Trail'];
    expect(sheet.A1.v).toBe('Period Start');
    expect(sheet.F1.v).toBe('Concession Type');
    expect(sheet.G1.v).toBe('Concession Trigger');
    expect(sheet.H1.v).toBe('Concession Detail');
  });
});
