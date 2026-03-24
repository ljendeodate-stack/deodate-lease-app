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

    expect(worksheet.E34.f).toBe('$C$14*(1+$C$18)^(D34-1)');
    expect(worksheet.F34.f).toBe('IF(C34<=$C$23,0,IF(C34=$C$23+1,E34*$C$26,E34))');
    expect(worksheet.G34.f).toBe('$C$15*(1+$C$20)^(D34-1)');
    expect(worksheet.H34.f).toBe('$C$16*(1+$C$21)^(D34-1)');
    expect(worksheet.I34.f).toBe('G34');
    expect(worksheet.K34.f).toBe('F34+I34+H34+J34');
    expect(worksheet.L34.f).toBe('IF($C$7=0,0,K34/$C$7)');
    expect(worksheet.P34.f).toBe('SUM(H34:H34)+SUM(J34:J34)');
    expect(worksheet.A37.v).toContain('Total NNN');
    expect(worksheet['!autofilter'].ref).toBe('A33:P33');
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

    expect(layout.firstDataRow).toBe(32);
    expect(worksheet.G32.f).toBe('$C$15*(1+$C$19)^(D32-1)');
    expect(worksheet.H32.f).toBe('G32');
    expect(worksheet.I32.f).toBe('F32+H32');
  });
});
