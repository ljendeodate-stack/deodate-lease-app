/**
 * Regression: partial final-month proration for 01/01/2023 → 01/15/2033.
 *
 * Engine must produce periodFactor = 15/31 on the last row.
 * Export formulas must include the period-factor term (EOMONTH) on recurring charge cells.
 */

import { describe, expect, it } from 'vitest';
import { calculateAllCharges } from './calculator.js';
import { expandPeriods } from './expander.js';
import { parseMDYStrict } from './yearMonth.js';

// ── Engine regression ─────────────────────────────────────────────────────────

describe('partial final month proration — engine', () => {
  const COMMENCE = '01/01/2023';
  const EXPIRE   = '01/15/2033';
  const RENT     = 1000;

  function buildRows() {
    const periods = [
      {
        periodStart: parseMDYStrict(COMMENCE),
        periodEnd:   parseMDYStrict(EXPIRE),
        monthlyRent: RENT,
      },
    ];
    const { rows } = expandPeriods(periods);
    return rows;
  }

  function buildParams(overrides = {}) {
    return {
      leaseName: 'Proration Regression',
      nnnMode: 'individual',
      squareFootage: 0,
      abatementEndDate: null,
      abatementPct: 0,
      nnnAggregate: { year1: 0, escPct: 0 },
      oneTimeItems: [],
      charges: [],
      ...overrides,
    };
  }

  it('last row has periodFactor = 15/31', () => {
    const expanded = buildRows();
    const result   = calculateAllCharges(expanded, buildParams());
    const lastRow  = result[result.length - 1];

    const expected = 15 / 31;
    expect(lastRow.periodFactor).toBeCloseTo(expected, 6);
  });

  it('last row baseRentApplied ≈ 1000 × (15/31)', () => {
    const expanded = buildRows();
    const result   = calculateAllCharges(expanded, buildParams());
    const lastRow  = result[result.length - 1];

    expect(lastRow.baseRentApplied).toBeCloseTo(RENT * (15 / 31), 2);
  });

  it('non-final rows have periodFactor = 1', () => {
    const expanded = buildRows();
    const result   = calculateAllCharges(expanded, buildParams());
    // All rows except last should be full months
    const nonFinal = result.slice(0, -1);
    for (const row of nonFinal) {
      expect(row.periodFactor).toBeCloseTo(1, 6);
    }
  });
});

// ── Export formula regression ─────────────────────────────────────────────────

import { buildLegacyLeaseScheduleSpec } from '../export/specs/legacyLeaseScheduleSpec.js';
import { buildExportModel }             from '../export/model/buildExportModel.js';
import { resolveLeaseScheduleLayout }   from '../export/resolvers/resolveLeaseScheduleLayout.js';
import { renderLeaseScheduleWorksheet } from '../export/builders/renderLeaseScheduleWorksheet.js';

describe('partial final month proration — export formulas', () => {
  function buildWorksheet(rows, params) {
    const model     = buildExportModel(rows, params, 'proration-regression');
    const layout    = resolveLeaseScheduleLayout(model);
    const spec      = buildLegacyLeaseScheduleSpec(model, layout);
    const worksheet = renderLeaseScheduleWorksheet(spec);
    return { worksheet, layout };
  }

  // Minimal processed rows: one full month + one partial final month
  const rows = [
    {
      periodStart: '2033-01-01',
      periodEnd:   '2033-01-15',
      leaseMonth:  121,
      leaseYear:   11,
      scheduledBaseRent:           1000,
      baseRentApplied:             Math.round(1000 * 15 / 31 * 100) / 100,
      camsAmount:                  200,
      insuranceAmount:             50,
      taxesAmount:                 100,
      totalMonthlyObligation:      Math.round((1000 + 200 + 50 + 100) * 15 / 31 * 100) / 100,
      effectivePerSF:              0,
      totalObligationRemaining:    0,
      totalBaseRentRemaining:      0,
      totalNNNRemaining:           0,
      totalOtherChargesRemaining:  0,
      oneTimeItemAmounts:          {},
      isAbatementRow:              false,
    },
  ];

  const params = {
    leaseName: 'Proration Regression',
    squareFootage: 0,
    nnnMode: 'individual',
    cams:      { year1: 200, escPct: 3 },
    insurance: { year1: 50,  escPct: 0 },
    taxes:     { year1: 100, escPct: 2 },
    oneTimeItems: [],
  };

  it('baseRentApplied formula includes EOMONTH period-factor term', () => {
    const { worksheet, layout } = buildWorksheet(rows, params);
    const fdr = layout.firstDataRow;
    const formula = worksheet[`F${fdr}`]?.f ?? '';
    expect(formula).toContain('EOMONTH');
  });

  it('a NNN charge formula includes EOMONTH period-factor term', () => {
    const { worksheet, layout } = buildWorksheet(rows, params);
    const fdr = layout.firstDataRow;
    // G is the first charge column after baseRentApplied (F); check G or H
    const gFormula = worksheet[`G${fdr}`]?.f ?? '';
    const hFormula = worksheet[`H${fdr}`]?.f ?? '';
    const hasEOMONTH = gFormula.includes('EOMONTH') || hFormula.includes('EOMONTH');
    expect(hasEOMONTH).toBe(true);
  });
});
