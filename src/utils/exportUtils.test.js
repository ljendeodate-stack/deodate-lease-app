import { describe, expect, it } from 'vitest';

import { buildXLSXWorkbook } from './exportUtils.js';
import { calculateAllCharges } from '../engine/calculator.js';
import { expandPeriods } from '../engine/expander.js';
import { parseMDYStrict } from '../engine/yearMonth.js';
import { buildExportModel } from '../export/model/buildExportModel.js';
import { resolveLeaseScheduleLayout } from '../export/resolvers/resolveLeaseScheduleLayout.js';
import {
  INLINE_SCENARIO_COLUMNS,
  INLINE_SCENARIO_EXIT_GROUP_TITLE,
  INLINE_SCENARIO_RENEGO_GROUP_TITLE,
} from '../export/derived/inlineScenarioColumns.js';
import { C, DEODATE_THEME } from '../export/specs/styleTokens.js';

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
    expect(sheet[`F${firstDataRow + 2}`].f).toContain('SUMIF(');
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

  it('keeps abatement and free-rent table formulas anchored to their own rows', () => {
    const { workbook } = makeWorkbook([
      { periodStart: parseMDYStrict('01/01/2030'), periodEnd: parseMDYStrict('12/31/2030'), monthlyRent: 10000 },
    ], {
      concessionEvents: [
        { id: 'abatement_1', type: 'abatement', scope: 'monthly_row', effectiveDate: parseMDYStrict('01/01/2030'), valueMode: 'percent', value: 50 },
        { id: 'abatement_2', type: 'abatement', scope: 'monthly_row', effectiveDate: parseMDYStrict('02/01/2030'), valueMode: 'percent', value: 50 },
        { id: 'abatement_3', type: 'abatement', scope: 'monthly_row', effectiveDate: parseMDYStrict('03/01/2030'), valueMode: 'percent', value: 50 },
        { id: 'abatement_4', type: 'abatement', scope: 'monthly_row', effectiveDate: parseMDYStrict('04/01/2030'), valueMode: 'percent', value: 50 },
        { id: 'free_1', type: 'free_rent', scope: 'monthly_row', effectiveDate: parseMDYStrict('01/01/2030'), valueMode: 'percent', value: 100 },
        { id: 'free_2', type: 'free_rent', scope: 'monthly_row', effectiveDate: parseMDYStrict('02/01/2030'), valueMode: 'percent', value: 100 },
        { id: 'free_3', type: 'free_rent', scope: 'monthly_row', effectiveDate: parseMDYStrict('03/01/2030'), valueMode: 'percent', value: 100 },
        { id: 'free_4', type: 'free_rent', scope: 'monthly_row', effectiveDate: parseMDYStrict('04/01/2030'), valueMode: 'percent', value: 100 },
      ],
    });

    const sheet = workbook.Sheets['Lease Schedule'];

    [6, 7, 8, 9].forEach((row) => {
      expect(sheet[`G${row}`].f).toContain(`$H$${row}`);
      expect(sheet[`I${row}`].f).toContain(`$H$${row}`);
      expect(sheet[`I${row}`].f).toContain(`$J$${row}`);
      expect(sheet[`G${row}`].f).not.toContain('#REF!');
      expect(sheet[`I${row}`].f).not.toContain('#REF!');
    });

    [20, 21, 22, 23].forEach((row) => {
      expect(sheet[`G${row}`].f).toContain(`$H$${row}`);
      expect(sheet[`I${row}`].f).toContain(`$H$${row}`);
      expect(sheet[`G${row}`].f).not.toMatch(/\$H\$(6|7|8|9)/);
      expect(sheet[`I${row}`].f).not.toMatch(/\$H\$(6|7|8|9)/);
      expect(sheet[`G${row}`].f).not.toContain('#REF!');
      expect(sheet[`I${row}`].f).not.toContain('#REF!');
    });
  });

  it('keeps Scenario Analysis linked to live free-rent and abatement totals', () => {
    const { workbook } = makeWorkbook([
      { periodStart: parseMDYStrict('01/01/2030'), periodEnd: parseMDYStrict('12/31/2030'), monthlyRent: 10000 },
    ], {
      concessionEvents: [
        { id: 'abatement_1', type: 'abatement', scope: 'monthly_row', effectiveDate: parseMDYStrict('01/01/2030'), valueMode: 'percent', value: 50 },
        { id: 'free_1', type: 'free_rent', scope: 'monthly_row', effectiveDate: parseMDYStrict('02/01/2030'), valueMode: 'percent', value: 100 },
      ],
    });

    const sheet = workbook.Sheets['Scenario Analysis'];
    expect(sheet.F9.f).toMatch(/^'Lease Schedule'!\$[A-Z]+\$\d+$/);
    expect(sheet.F10.f).toMatch(/^'Lease Schedule'!\$[A-Z]+\$\d+$/);
    ['G23', 'H23', 'I23'].forEach((addr) => {
      expect(sheet[addr].f).toMatch(/^'Lease Schedule'!\$[A-Z]+\$\d+\*\(1-[A-Z]15\)$/);
    });
    ['G24', 'H24', 'I24'].forEach((addr) => {
      expect(sheet[addr].f).toMatch(/^'Lease Schedule'!\$[A-Z]+\$\d+\*\(1-[A-Z]15\)$/);
    });
  });

  it('uses legacy-compatible lookup formulas in Scenario Analysis', () => {
    const { workbook } = makeWorkbook([
      { periodStart: parseMDYStrict('01/01/2030'), periodEnd: parseMDYStrict('12/31/2030'), monthlyRent: 10000 },
    ]);

    const sheet = workbook.Sheets['Scenario Analysis'];
    ['F5', 'F6', 'F7', 'F8', 'F16', 'F18'].forEach((addr) => {
      expect(sheet[addr].f).toContain('LOOKUP(');
      expect(sheet[addr].f).not.toContain('XLOOKUP');
      expect(sheet[addr].f).not.toContain('_xlfn');
    });
  });

  it('defaults the effective analysis date to the first schedule date instead of the current month', () => {
    const { workbook, firstDataRow } = makeWorkbook([
      { periodStart: parseMDYStrict('01/01/2030'), periodEnd: parseMDYStrict('12/31/2030'), monthlyRent: 10000 },
    ]);

    const leaseSheet = workbook.Sheets['Lease Schedule'];
    const scenarioSheet = workbook.Sheets['Scenario Analysis'];
    expect(leaseSheet.C11.v).toBeGreaterThan(0);
    expect(scenarioSheet.I5.f).toBe(`'Lease Schedule'!$C$11`);
    expect(scenarioSheet.I5.v).toBe(leaseSheet[`A${firstDataRow}`].v);
  });

  it('keeps base-rent-applied dynamic when free rent or abatement starts the schedule', () => {
    const { workbook, firstDataRow, processedRows } = makeWorkbook([
      { periodStart: parseMDYStrict('01/01/2030'), periodEnd: parseMDYStrict('03/31/2030'), monthlyRent: 10000 },
    ], {
      concessionEvents: [
        { id: 'free_1', type: 'free_rent', scope: 'monthly_row', effectiveDate: parseMDYStrict('01/05/2030'), valueMode: 'percent', value: 100 },
        { id: 'abatement_1', type: 'abatement', scope: 'monthly_row', effectiveDate: parseMDYStrict('02/05/2030'), valueMode: 'percent', value: 50 },
      ],
    });

    const sheet = workbook.Sheets['Lease Schedule'];
    expect(sheet[`F${firstDataRow}`].f).toContain('COUNTIF(');
    expect(sheet[`F${firstDataRow}`].f).toContain('SUMIF(');
    expect(sheet[`F${firstDataRow}`].f).not.toContain('abatementMonths');
    expect(sheet[`F${firstDataRow}`].v).toBe(processedRows[0].baseRentApplied);
    expect(sheet[`F${firstDataRow + 1}`].v).toBe(processedRows[1].baseRentApplied);
  });

  it('adds inline renegotiation and exit columns with explicit basis labels and formulas', () => {
    const { rows } = expandPeriods([
      { periodStart: parseMDYStrict('01/01/2030'), periodEnd: parseMDYStrict('12/31/2030'), monthlyRent: 10000 },
    ]);
    const processedRows = calculateAllCharges(rows, {
      nnnMode: 'individual',
      squareFootage: 1000,
      oneTimeItems: [{ label: 'HVAC', date: '2030-01-15', amount: 5000 }],
      charges: [
        { key: 'cams', canonicalType: 'nnn', displayLabel: 'CAMS', year1: 1000, escPct: 0 },
        { key: 'parking', canonicalType: 'other', displayLabel: 'Parking', year1: 300, escPct: 0 },
      ],
      abatementPct: 0,
      abatementEndDate: null,
    });
    const exportParams = {
      nnnMode: 'individual',
      squareFootage: 1000,
      oneTimeItems: [{ label: 'HVAC', date: '2030-01-15', amount: 5000 }],
      charges: [
        { key: 'cams', canonicalType: 'nnn', displayLabel: 'CAMS', year1: 1000, escPct: 0 },
        { key: 'parking', canonicalType: 'other', displayLabel: 'Parking', year1: 300, escPct: 0 },
      ],
    };
    const model = buildExportModel(processedRows, exportParams, 'scenario-inline');
    const layout = resolveLeaseScheduleLayout(model);
    const { workbook } = buildXLSXWorkbook(processedRows, exportParams, 'scenario-inline');
    const sheet = workbook.Sheets['Lease Schedule'];

    const firstScenarioColumn = model.columns.find((column) => column.key === INLINE_SCENARIO_COLUMNS[0].key);
    const lastScenarioColumn = model.columns.find((column) => column.key === INLINE_SCENARIO_COLUMNS[INLINE_SCENARIO_COLUMNS.length - 1].key);
    const otherRemColumn = model.columns.find((column) => column.key === 'otherRem');
    const firstDataRow = layout.firstDataRow;

    expect(firstScenarioColumn.index).toBe(otherRemColumn.index + 1);
    expect(sheet[`${firstScenarioColumn.letter}${layout.scenarioGroupRow}`].v).toBe(INLINE_SCENARIO_RENEGO_GROUP_TITLE);
    const firstExitScenarioColumn = model.columns.find((column) => column.key === 'exitBaseNetsOther0');
    expect(sheet[`${firstExitScenarioColumn.letter}${layout.scenarioGroupRow}`].v).toBe(INLINE_SCENARIO_EXIT_GROUP_TITLE);
    expect(sheet[`${firstScenarioColumn.letter}${layout.headerRow}`].v).toContain('Renego: (base rent only)');
    expect(sheet[`${lastScenarioColumn.letter}${layout.headerRow}`].v).toContain('Exit: (base rent, nets, and other obligations)');
    expect(sheet[`${firstScenarioColumn.letter}${layout.headerRow}`].s.fill.fgColor.rgb).toBe(C.tableHeader);
    expect(sheet[`${firstExitScenarioColumn.letter}${layout.headerRow}`].s.fill.fgColor.rgb).toBe(C.sectionBar);
    expect(sheet[`${firstScenarioColumn.letter}${firstDataRow}`].f).toBe(`${layout.colByKey.baseRem.letter}${firstDataRow}*(1-0.1)`);
    expect(sheet[`${lastScenarioColumn.letter}${firstDataRow}`].f).toBe(`${layout.colByKey.obligRem.letter}${firstDataRow}*(1-0.5)`);
    expect(sheet[`${firstScenarioColumn.letter}${firstDataRow}`].f).not.toContain(layout.colByKey.obligRem.letter);
    expect(sheet[`${lastScenarioColumn.letter}${firstDataRow}`].f).toContain(layout.colByKey.obligRem.letter);
  });

  it('applies DEODATE workbook anchor styles across exported sheets', () => {
    const { workbook, firstDataRow } = makeWorkbook([
      { periodStart: parseMDYStrict('01/01/2030'), periodEnd: parseMDYStrict('12/31/2030'), monthlyRent: 10000 },
    ]);

    const leaseSheet = workbook.Sheets['Lease Schedule'];
    const annualSheet = workbook.Sheets['Annual Summary'];
    const auditSheet = workbook.Sheets['Audit Trail'];
    const scenarioSheet = workbook.Sheets['Scenario Analysis'];

    expect(leaseSheet.A1.s.font.name).toBe(DEODATE_THEME.fonts.brand);
    expect(leaseSheet.B6.s.fill.fgColor.rgb).toBe(C.labelFill);
    expect(leaseSheet[`A${firstDataRow + 1}`].s.fill.fgColor.rgb).toBe(C.altRow);
    expect(annualSheet.A1.s.fill.fgColor.rgb).toBe(C.tableHeader);
    expect(auditSheet.A1.s.fill.fgColor.rgb).toBe(C.sectionBar);
    expect(scenarioSheet.E1.s.font.name).toBe(DEODATE_THEME.fonts.brand);
    expect(scenarioSheet.I5.s.font.color.rgb).toBe(C.fcInput);
    expect(scenarioSheet.I5.s.fill.fgColor.rgb).toBe(C.labelFill);
  });

  it('keeps free-rent schedule cells formula-driven instead of hardcoded when users input concession rows', () => {
    const { workbook, firstDataRow } = makeWorkbook([
      { periodStart: parseMDYStrict('01/01/2030'), periodEnd: parseMDYStrict('04/30/2030'), monthlyRent: 9000 },
    ], {
      concessionEvents: [
        { id: 'free_1', type: 'free_rent', scope: 'monthly_row', effectiveDate: parseMDYStrict('02/15/2030'), valueMode: 'percent', value: 100 },
        { id: 'free_2', type: 'free_rent', scope: 'monthly_row', effectiveDate: parseMDYStrict('04/15/2030'), valueMode: 'percent', value: 100 },
      ],
    });

    const sheet = workbook.Sheets['Lease Schedule'];
    expect(sheet[`F${firstDataRow + 1}`].f).toContain('COUNTIF(');
    expect(sheet[`F${firstDataRow + 3}`].f).toContain('COUNTIF(');
    expect(sheet[`F${firstDataRow + 1}`].v).toBe(0);
    expect(sheet[`F${firstDataRow + 3}`].v).toBe(0);
  });
});
