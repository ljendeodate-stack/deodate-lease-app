import { describe, expect, it } from 'vitest';

import {
  applyAutoEndDatesToRows,
  analyzePreserveMonthSpacing,
  buildEditableRowsFromPeriods,
  buildRowMonthConstraints,
  buildParsedRows,
  buildRowsPreservingMonthSpacing,
  formatRentInputValue,
} from './ScheduleEditor.jsx';
import { parseMDYStrict } from '../engine/yearMonth.js';

describe('buildEditableRowsFromPeriods', () => {
  it('maps detected period rows into editable manual-entry rows', () => {
    const rows = buildEditableRowsFromPeriods([
      {
        periodStart: parseMDYStrict('01/01/2030'),
        periodEnd: parseMDYStrict('12/31/2030'),
        monthlyRent: 37187.5,
      },
      {
        periodStart: parseMDYStrict('01/01/2031'),
        periodEnd: parseMDYStrict('12/31/2031'),
        monthlyRent: 40906.25,
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      startDate: '01/01/2030',
      endDate: '12/31/2030',
      rentStr: '37,187.5',
    });
    expect(rows[1]).toMatchObject({
      startDate: '01/01/2031',
      endDate: '12/31/2031',
      rentStr: '40,906.25',
    });
  });

  it('returns three blank editable rows when no dated schedule exists yet', () => {
    const rows = buildEditableRowsFromPeriods([]);

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.startDate === '' && row.endDate === '' && row.rentStr === '')).toBe(true);
  });

  it('flags chronology conflicts when a later row starts before the previous row ends', () => {
    const rows = buildParsedRows([
      { id: 1, startDate: '04/03/2026', endDate: '07/04/2026', rentStr: '98463.60' },
      { id: 2, startDate: '04/18/2026', endDate: '09/19/2026', rentStr: '98463.60' },
    ]);

    expect(rows[1].warning).toContain('Start date must be after the previous row ends');
  });

  it('builds forward-only month constraints from the row 1 anchor date', () => {
    const rows = buildRowMonthConstraints([
      { id: 1, startDate: '06/26/2024', endDate: '12/25/2024', rentStr: '0' },
      { id: 2, startDate: '06/26/2025', endDate: '12/25/2025', rentStr: '1000' },
      { id: 3, startDate: '', endDate: '', rentStr: '1100' },
    ]);

    expect(rows[0]).toMatchObject({
      startMonthNumber: 1,
      endMonthNumber: 6,
      startMonthLocked: true,
      minEndMonth: 1,
      maxEndMonth: 12,
    });
    expect(rows[1]).toMatchObject({
      startMonthNumber: 13,
      endMonthNumber: 18,
      minStartMonth: 7,
      minEndMonth: 13,
    });
    expect(rows[2]).toMatchObject({
      minStartMonth: 19,
      endMonthDisabled: true,
    });
  });

  it('auto-fills a blank prior end date from the next row start date', () => {
    const rows = applyAutoEndDatesToRows([
      { id: 1, startDate: '06/26/2024', endDate: '', rentStr: '1000' },
      { id: 2, startDate: '06/26/2025', endDate: '', rentStr: '1200' },
    ]);

    expect(rows[0]).toMatchObject({
      endDate: '06/25/2025',
      endDateSource: 'auto',
    });
  });

  it('does not overwrite a manual end date when a later row start exists', () => {
    const rows = applyAutoEndDatesToRows([
      { id: 1, startDate: '06/26/2024', endDate: '12/25/2025', rentStr: '1000', endDateSource: 'manual' },
      { id: 2, startDate: '06/26/2025', endDate: '', rentStr: '1200' },
    ]);

    expect(rows[0]).toMatchObject({
      endDate: '12/25/2025',
      endDateSource: 'manual',
    });
  });

  it('formats manual rent input values with commas without changing the parsed amount', () => {
    expect(formatRentInputValue('98463.60')).toBe('98,463.60');
    expect(formatRentInputValue('$98463.60*')).toBe('$98,463.60*');
    expect(buildParsedRows([
      { id: 1, startDate: '06/26/2024', endDate: '12/25/2024', rentStr: '98,463.60' },
    ])[0].monthlyRent).toBe(98463.6);
  });

  it('re-anchors dated schedule rows while preserving lease-month spacing', () => {
    const rows = buildEditableRowsFromPeriods([
      {
        periodStart: parseMDYStrict('01/01/2030'),
        periodEnd: parseMDYStrict('06/30/2030'),
        monthlyRent: 0,
      },
      {
        periodStart: parseMDYStrict('07/01/2030'),
        periodEnd: parseMDYStrict('12/31/2034'),
        monthlyRent: 23149.25,
      },
      {
        periodStart: parseMDYStrict('01/01/2035'),
        periodEnd: parseMDYStrict('12/31/2039'),
        monthlyRent: 25464.18,
      },
    ]);

    const transformed = buildRowsPreservingMonthSpacing(rows, '06/26/2024');

    expect(transformed).toMatchObject([
      { startDate: '06/26/2024', endDate: '12/25/2024', rentStr: '0' },
      { startDate: '12/26/2024', endDate: '06/25/2029', rentStr: '23,149.25' },
      { startDate: '06/26/2029', endDate: '06/25/2034', rentStr: '25,464.18' },
    ]);
  });

  it('keeps preserve-month-spacing mode supplementary by refusing incomplete schedules', () => {
    const analysis = analyzePreserveMonthSpacing([
      { id: 1, startDate: '01/01/2030', endDate: '06/30/2030', rentStr: '1000' },
      { id: 2, startDate: '07/01/2030', endDate: '', rentStr: '1200' },
    ]);

    expect(analysis.eligible).toBe(false);
    expect(analysis.reason).toContain('end date is required');
    expect(buildRowsPreservingMonthSpacing([
      { id: 1, startDate: '01/01/2030', endDate: '06/30/2030', rentStr: '1000' },
      { id: 2, startDate: '07/01/2030', endDate: '', rentStr: '1200' },
    ], '06/26/2024')).toBeNull();
  });
});
