import { describe, expect, it } from 'vitest';

import { buildEditableRowsFromPeriods, buildParsedRows } from './ScheduleEditor.jsx';
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
      rentStr: '37187.5',
    });
    expect(rows[1]).toMatchObject({
      startDate: '01/01/2031',
      endDate: '12/31/2031',
      rentStr: '40906.25',
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
});
