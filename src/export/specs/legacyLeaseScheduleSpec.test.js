import { describe, expect, it } from 'vitest';

import { renderLeaseScheduleWorksheet } from '../builders/renderLeaseScheduleWorksheet.js';
import { buildExportModel } from '../model/buildExportModel.js';
import { resolveLeaseScheduleLayout } from '../resolvers/resolveLeaseScheduleLayout.js';
import { buildLegacyLeaseScheduleSpec } from './legacyLeaseScheduleSpec.js';

describe('buildLegacyLeaseScheduleSpec', () => {
  it('renders legacy lease schedule formulas using resolved assumption addresses', () => {
    const rows = [
      {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        leaseMonth: 1,
        leaseYear: 1,
        scheduledBaseRent: 10000,
        baseRentApplied: 0,
        camsAmount: 1200,
        securityAmount: 250,
        totalMonthlyObligation: 1750,
        effectivePerSF: 1.75,
        totalObligationRemaining: 1750,
        totalBaseRentRemaining: 0,
        totalNNNRemaining: 1200,
        totalOtherChargesRemaining: 550,
        oneTimeItemAmounts: { 'Broker Fee': 300 },
        isAbatementRow: true,
      },
    ];

    const params = {
      leaseName: 'legacy-check',
      squareFootage: 1000,
      nnnMode: 'individual',
      cams: { year1: 1200, escPct: 3 },
      security: { year1: 250, escPct: 0 },
    };

    const model = buildExportModel(rows, params, 'legacy-check');
    const layout = resolveLeaseScheduleLayout(model);
    const spec = buildLegacyLeaseScheduleSpec(model, layout);
    const worksheet = renderLeaseScheduleWorksheet(spec);

    expect(worksheet.E19.f).toBe('$C$8*(1+$C$9)^(D19-1)');
    expect(worksheet.F19.f).toBe('IF(C19<=$C$11,0,IF(C19=$C$11+1,E19*$C$12,E19))');
    expect(worksheet.G19.f).toBe('$C$13*(1+$C$14)^(D19-1)');
    expect(worksheet.H19.f).toBe('$C$15*(1+$C$16)^(D19-1)');
    expect(worksheet.I19.f).toBe('G19');
    expect(worksheet.K19.f).toBe('F19+I19+H19+J19');
    expect(worksheet.L19.f).toBe('IF($C$5=0,0,K19/$C$5)');
    expect(worksheet.P19.f).toBe('SUM(H19:H19)+SUM(J19:J19)');
    expect(worksheet.A23.v).toContain('Total NNN');
    expect(worksheet['!autofilter'].ref).toBe('A18:P18');
  });

  it('uses the aggregate NNN assumption pair when aggregate mode is active', () => {
    const rows = [
      {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        leaseMonth: 1,
        leaseYear: 1,
        scheduledBaseRent: 9000,
        baseRentApplied: 9000,
        nnnAggregateAmount: 1800,
        totalMonthlyObligation: 10800,
        effectivePerSF: 9,
        totalObligationRemaining: 10800,
        totalBaseRentRemaining: 9000,
        totalNNNRemaining: 1800,
        totalOtherChargesRemaining: 0,
        oneTimeItemAmounts: {},
      },
    ];

    const params = {
      leaseName: 'aggregate-check',
      squareFootage: 1200,
      nnnMode: 'aggregate',
      nnnAggregate: { year1: 1800, escPct: 4 },
    };

    const model = buildExportModel(rows, params, 'aggregate-check');
    const layout = resolveLeaseScheduleLayout(model);
    const spec = buildLegacyLeaseScheduleSpec(model, layout);
    const worksheet = renderLeaseScheduleWorksheet(spec);

    expect(layout.firstDataRow).toBe(17);
    expect(worksheet.G17.f).toBe('$C$13*(1+$C$14)^(D17-1)');
    expect(worksheet.H17.f).toBe('G17');
    expect(worksheet.I17.f).toBe('F17+H17');
  });
});
