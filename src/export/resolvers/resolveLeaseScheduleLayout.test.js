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
        oneTimeItemAmounts: {},
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
        oneTimeItemAmounts: {},
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

    // Legacy left-side assumptions remain in place, and the layout now also
    // exposes right-side concession tables for month-number inputs.
    expect(layout.assumptionEntries).toHaveLength(47);
    // Row positions: assumptionStartRow(5) + index
    expect(layout.cellMap.squareFootage).toBe('$C$7');           // index 2
    expect(layout.cellMap.totalLeaseTerm).toBe('$C$12');         // index 7
    expect(layout.cellMap.effectiveMonth).toBe('$C$13');         // index 8
    expect(layout.cellMap.monthsRemaining).toBe('$C$14');        // index 9
    expect(layout.cellMap.monthsUntilNextEsc).toBe('$C$15');     // index 10
    expect(layout.cellMap.year1BaseRent).toBe('$C$18');          // index 13
    expect(layout.cellMap.annualEscRate).toBe('$C$22');          // index 17
    expect(layout.cellMap.cams_year1).toBe('$C$19');             // index 14
    expect(layout.cellMap.cams_escRate).toBe('$C$24');           // index 19
    expect(layout.cellMap.security_year1).toBe('$C$20');         // index 15
    expect(layout.cellMap.security_escRate).toBe('$C$25');       // index 20

    expect(layout.abatementTable.headerRow).toBe(5);
    expect(layout.abatementTable.dataStartRow).toBe(6);
    expect(layout.abatementTable.dataEndRow).toBe(15);
    expect(layout.abatementTable.totalRow).toBe(16);
    expect(layout.abatementTable.monthRange).toBe('$H$6:$H$15');
    expect(layout.abatementTable.amountRange).toBe('$I$6:$I$15');
    expect(layout.abatementTable.pctRange).toBe('$J$6:$J$15');
    expect(layout.abatementTable.totalAmountAddress).toBe('$I$16');

    expect(layout.freeRentTable.headerRow).toBe(19);
    expect(layout.freeRentTable.dataStartRow).toBe(20);
    expect(layout.freeRentTable.dataEndRow).toBe(29);
    expect(layout.freeRentTable.totalRow).toBe(30);
    expect(layout.freeRentTable.monthRange).toBe('$H$20:$H$29');
    expect(layout.freeRentTable.amountRange).toBe('$I$20:$I$29');
    expect(layout.freeRentTable.totalAmountAddress).toBe('$I$30');

    expect(layout.leftAssumptionLastRow).toBe(51);
    expect(layout.assumptionLastRow).toBe(51);
    expect(layout.headerRow).toBe(53);
    expect(layout.firstDataRow).toBe(54);
    expect(layout.totalsRow).toBe(56);
    expect(layout.noteRow).toBe(58);

    // NRC ranges should span the 11 OT entries
    expect(layout.nrcDateRange).toBeDefined();
    expect(layout.nrcAmountRange).toBeDefined();

    // Single NRC column instead of per-label OT columns
    expect(layout.nrcColumn).toBeDefined();
    expect(layout.nrcColumn.key).toBe('nonRecurringCharges');

    // Column K is now nonRecurringCharges (after cams=G, security=H, totalNNN=I, nrc=J... let me check)
    // Columns: A=periodStart, B=periodEnd, C=monthNum, D=yearNum, E=scheduledBaseRent, F=baseRentApplied,
    //   G=cams(nnn), H=security(otherCharge), I=totalNNN, J=nonRecurringCharges, K=totalMonthly, ...
    expect(layout.colByKey.totalMonthly.letter).toBe('K');
    expect(layout.colByKey.nonRecurringCharges.letter).toBe('J');
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

    // Aggregate mode keeps the legacy left-side footprint; concession inputs remain in the right-side tables.
    expect(layout.assumptionEntries).toHaveLength(47);
    expect(layout.cellMap.nnnAgg_year1).toBe('$C$19');    // index 14
    expect(layout.cellMap.nnnAgg_escRate).toBe('$C$24');  // index 19
    expect(layout.cellMap.security_year1).toBe('$C$20');  // index 15
    expect(layout.headerRow).toBe(53);
    expect(layout.colByKey.nnnAggregate.letter).toBe('G');
    expect(layout.colByKey.totalNNN.letter).toBe('I');
  });

  it('exposes NRC date and amount ranges for SUMPRODUCT formula', () => {
    const rows = [
      {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        leaseMonth: 1,
        leaseYear: 1,
        scheduledBaseRent: 10000,
        baseRentApplied: 10000,
        oneTimeItemAmounts: {},
      },
    ];

    const params = {
      squareFootage: 1000,
      nnnMode: 'individual',
      oneTimeItems: [
        { label: 'Broker Fee', date: '2026-01-01', amount: 5000 },
      ],
    };

    const model = buildExportModel(rows, params, 'nrc-range-check');
    const layout = resolveLeaseScheduleLayout(model);

    // NRC ranges should be defined (11 OT slots)
    expect(layout.nrcDateRange).toBeDefined();
    expect(layout.nrcAmountRange).toBeDefined();
    // The ranges should span 11 rows
    const dateRangeMatch = layout.nrcDateRange.match(/\$C\$(\d+):\$C\$(\d+)/);
    expect(dateRangeMatch).toBeTruthy();
    expect(Number(dateRangeMatch[2]) - Number(dateRangeMatch[1]) + 1).toBe(11);
  });

  it('defaults rentCommencementDate to commencementDate when not provided', () => {
    const rows = [
      {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        leaseMonth: 1,
        leaseYear: 1,
        scheduledBaseRent: 10000,
        baseRentApplied: 10000,
        oneTimeItemAmounts: {},
      },
    ];

    const params = {
      squareFootage: 1000,
      nnnMode: 'individual',
      // rentCommencementDate NOT provided
    };

    const model = buildExportModel(rows, params, 'default-rent-comm');

    // Should default to commencementDate (first row's periodStart)
    expect(model.assumptions.rentCommencementDate).toBe('2026-01-01');
  });

  it('defaults effectiveAnalysisDate to first of current month when not provided', () => {
    const rows = [
      {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        leaseMonth: 1,
        leaseYear: 1,
        scheduledBaseRent: 10000,
        baseRentApplied: 10000,
        oneTimeItemAmounts: {},
      },
    ];

    const params = {
      squareFootage: 1000,
      nnnMode: 'individual',
      // effectiveAnalysisDate NOT provided
    };

    const model = buildExportModel(rows, params, 'default-analysis-date');

    // Should be a valid ISO date string (YYYY-MM-DD) ending in -01
    expect(model.assumptions.effectiveAnalysisDate).toMatch(/^\d{4}-\d{2}-01$/);
  });
});
