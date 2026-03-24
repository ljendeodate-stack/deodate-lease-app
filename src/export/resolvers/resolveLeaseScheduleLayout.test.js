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

    // Six-section assumptions block: 7+5+5+5+3+2 = 27 entries (heading + leaseName + squareFootage
    // + commencementDate + expirationDate + rentCommencementDate + effectiveAnalysisDate |
    // heading + nnnMode + year1BaseRent + cams_year1 + security_year1 |
    // heading + annualEscRate + anniversaryMonth + cams_escRate + security_escRate |
    // heading + abatementMonths + abatementEndDate + abatementPct + abatementPartialFactor |
    // heading + freeRentMonths + freeRentEndDate |
    // heading + "(none)")
    expect(layout.assumptionEntries).toHaveLength(27);
    // Row positions: assumptionStartRow(5) + index
    expect(layout.cellMap.squareFootage).toBe('$C$7');       // index 2
    expect(layout.cellMap.year1BaseRent).toBe('$C$14');      // index 9
    expect(layout.cellMap.annualEscRate).toBe('$C$18');      // index 13
    expect(layout.cellMap.abatementMonths).toBe('$C$23');    // index 18
    expect(layout.cellMap.abatementPartialFactor).toBe('$C$26'); // index 21
    expect(layout.cellMap.cams_year1).toBe('$C$15');         // index 10
    expect(layout.cellMap.cams_escRate).toBe('$C$20');       // index 15
    expect(layout.cellMap.security_year1).toBe('$C$16');     // index 11
    expect(layout.cellMap.security_escRate).toBe('$C$21');   // index 16
    expect(layout.headerRow).toBe(33);    // 5 + 27 - 1 + 2
    expect(layout.firstDataRow).toBe(34); // headerRow + 1
    expect(layout.totalsRow).toBe(36);    // lastDataRow(35) + 1 for 2 data rows
    expect(layout.noteRow).toBe(38);      // totalsRow + 2
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

    // Aggregate mode: same 27-entry count (nnnAgg entries replace cams/insurance/taxes in sections 2/3)
    expect(layout.assumptionEntries).toHaveLength(27);
    expect(layout.cellMap.nnnAgg_year1).toBe('$C$15');    // index 10 — after heading+mode+year1BaseRent
    expect(layout.cellMap.nnnAgg_escRate).toBe('$C$20');  // index 15 — after heading+annualEscRate+anniversaryMonth+nnnAgg_year1(sec2)
    expect(layout.cellMap.security_year1).toBe('$C$16');  // index 11
    expect(layout.headerRow).toBe(33);
    expect(layout.colByKey.nnnAggregate.letter).toBe('G');
    expect(layout.colByKey.totalNNN.letter).toBe('I');
  });
});
