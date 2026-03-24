import { describe, expect, it } from 'vitest';

import { buildExportModel } from '../model/buildExportModel.js';
import { resolveLeaseScheduleLayout } from './resolveLeaseScheduleLayout.js';

describe('resolveLeaseScheduleLayout', () => {
  it('computes row offsets and assumption addresses for individual mode', () => {
    const rows = [
      {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        leaseMonth: 1,
        leaseYear: 1,
        scheduledBaseRent: 10000,
        baseRentApplied: 10000,
        camsAmount: 1200,
        securityAmount: 250,
        totalMonthlyObligation: 11450,
        totalObligationRemaining: 11450,
        totalBaseRentRemaining: 10000,
        totalNNNRemaining: 1200,
        totalOtherChargesRemaining: 250,
        oneTimeItemAmounts: { 'Broker Fee': 0 },
      },
      {
        periodStart: '2026-02-01',
        periodEnd: '2026-02-28',
        leaseMonth: 2,
        leaseYear: 1,
        scheduledBaseRent: 10000,
        baseRentApplied: 10000,
        camsAmount: 1200,
        securityAmount: 250,
        totalMonthlyObligation: 11950,
        totalObligationRemaining: 11950,
        totalBaseRentRemaining: 10000,
        totalNNNRemaining: 1200,
        totalOtherChargesRemaining: 750,
        oneTimeItemAmounts: { 'Broker Fee': 500 },
      },
    ];

    const params = {
      leaseName: 'spec-check',
      squareFootage: 1000,
      nnnMode: 'individual',
      cams: { year1: 1200, escPct: 3 },
      security: { year1: 250, escPct: 0 },
    };

    const model = buildExportModel(rows, params, 'spec-check');
    const layout = resolveLeaseScheduleLayout(model);

    expect(layout.assumptionEntries).toHaveLength(12);
    expect(layout.cellMap.squareFootage).toBe('$C$5');
    expect(layout.cellMap.cams_year1).toBe('$C$13');
    expect(layout.cellMap.cams_escRate).toBe('$C$14');
    expect(layout.cellMap.security_year1).toBe('$C$15');
    expect(layout.cellMap.security_escRate).toBe('$C$16');
    expect(layout.headerRow).toBe(18);
    expect(layout.firstDataRow).toBe(19);
    expect(layout.totalsRow).toBe(21);
    expect(layout.noteRow).toBe(23);
    expect(layout.colByKey.totalMonthly.letter).toBe('K');
  });

  it('inserts aggregate NNN assumption rows before category-specific assumptions', () => {
    const rows = [
      {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        leaseMonth: 1,
        leaseYear: 1,
        scheduledBaseRent: 9000,
        baseRentApplied: 0,
        nnnAggregateAmount: 1800,
        securityAmount: 75,
        totalMonthlyObligation: 1875,
        totalObligationRemaining: 1875,
        totalBaseRentRemaining: 0,
        totalNNNRemaining: 1800,
        totalOtherChargesRemaining: 75,
        oneTimeItemAmounts: {},
        isAbatementRow: true,
      },
    ];

    const params = {
      leaseName: 'aggregate-case',
      squareFootage: 1200,
      nnnMode: 'aggregate',
      nnnAggregate: { year1: 1800, escPct: 4 },
      security: { year1: 75, escPct: 0 },
    };

    const model = buildExportModel(rows, params, 'aggregate-case');
    const layout = resolveLeaseScheduleLayout(model);

    expect(layout.assumptionEntries).toHaveLength(12);
    expect(layout.cellMap.nnnAgg_year1).toBe('$C$13');
    expect(layout.cellMap.nnnAgg_escRate).toBe('$C$14');
    expect(layout.cellMap.security_year1).toBe('$C$15');
    expect(layout.headerRow).toBe(18);
    expect(layout.colByKey.nnnAggregate.letter).toBe('G');
    expect(layout.colByKey.totalNNN.letter).toBe('I');
  });
});
