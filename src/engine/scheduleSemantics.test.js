import { describe, expect, it } from 'vitest';

import {
  analyzeScheduleSemantics,
  extractScheduleStartRules,
  materializeScheduleSemantics,
} from './scheduleSemantics.js';

describe('scheduleSemantics', () => {
  it('detects and materializes month-bucket rent schedules anchored by a commencement-based start rule', () => {
    const documentText = [
      'Commencement Date shall be January 15, 2030.',
      'Minimum Annual Rent shall commence on the first full calendar month after the Commencement Date.',
      'Months 1-60: $37,187.50 monthly',
      'Months 61-120: $40,906.25 monthly',
    ].join('\n');

    const analysis = analyzeScheduleSemantics({ documentText });

    expect(analysis.materializationStatus).toBe('resolved');
    expect(analysis.preferredRepresentationType).toBe('relative_month_ranges');
    expect(analysis.preferredAnchorDate).toBe('02/01/2030');
    expect(analysis.summaryLines).toEqual([
      'Months 1-60: $37,187.50 monthly',
      'Months 61-120: $40,906.25 monthly',
    ]);
    expect(analysis.derivedRentSchedule).toEqual([
      { periodStart: '02/01/2030', periodEnd: '01/31/2035', monthlyRent: 37187.5 },
      { periodStart: '02/01/2035', periodEnd: '01/31/2040', monthlyRent: 40906.25 },
    ]);
  });

  it('keeps semantic month-bucket schedules alive until the user provides an anchor date', () => {
    const documentText = [
      'Months 1-60: $37,187.50 monthly',
      'Months 61-120: $40,906.25 monthly',
    ].join('\n');

    const analysis = analyzeScheduleSemantics({ documentText });
    expect(analysis.materializationStatus).toBe('needs_anchor');
    expect(analysis.derivedRentSchedule).toEqual([]);

    const rematerialized = materializeScheduleSemantics(analysis, {
      base_rent_start_date: '03/15/2030',
      rent_commencement_date: '03/15/2030',
    });

    expect(rematerialized.materializationStatus).toBe('resolved');
    expect(rematerialized.preferredAnchorDate).toBe('03/15/2030');
    expect(rematerialized.derivedRentSchedule[0]).toEqual({
      periodStart: '03/15/2030',
      periodEnd: '03/14/2035',
      monthlyRent: 37187.5,
    });
    expect(rematerialized.derivedRentSchedule[1]).toEqual({
      periodStart: '03/15/2035',
      periodEnd: '03/14/2040',
      monthlyRent: 40906.25,
    });
  });

  it('captures composite later-of schedule start rules for downstream normalization', () => {
    const rules = extractScheduleStartRules(
      'Base Rent shall commence on the later of the Delivery Date and the Permit Issuance Date.',
    );

    expect(rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleKind: 'later_of',
          compositeRules: [
            { triggerEvent: 'delivery_date' },
            { triggerEvent: 'permit_issuance_date' },
          ],
        }),
      ]),
    );
  });

  it('materializes narrative escalation rules into dated base-rent periods', () => {
    const documentText = [
      'Lease term 01/01/2025-01/01/2035',
      'Rent 10000 month, escalated 2% every two years',
    ].join('\n');

    const analysis = analyzeScheduleSemantics({ documentText });

    expect(analysis.materializationStatus).toBe('resolved');
    expect(analysis.preferredRepresentationType).toBe('relative_month_ranges');
    expect(analysis.preferredAnchorDate).toBe('01/01/2025');
    expect(analysis.derivedRentSchedule[0]).toEqual({
      periodStart: '01/01/2025',
      periodEnd: '12/31/2026',
      monthlyRent: 10000,
    });
    expect(analysis.derivedRentSchedule[1]).toEqual({
      periodStart: '01/01/2027',
      periodEnd: '12/31/2028',
      monthlyRent: 10200,
    });
    expect(analysis.derivedRentSchedule[4]).toEqual({
      periodStart: '01/01/2033',
      periodEnd: '12/31/2034',
      monthlyRent: 10824.32,
    });
  });
});
