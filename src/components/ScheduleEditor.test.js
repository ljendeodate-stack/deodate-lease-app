import { describe, expect, it } from 'vitest';

import { buildEditableRowsFromPeriods } from './ScheduleEditor.jsx';
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
      periodStr: '01/01/2030-12/31/2030',
      rentStr: '37187.5',
    });
    expect(rows[1]).toMatchObject({
      periodStr: '01/01/2031-12/31/2031',
      rentStr: '40906.25',
    });
  });

  it('returns three blank editable rows when no dated schedule exists yet', () => {
    const rows = buildEditableRowsFromPeriods([]);

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.periodStr === '' && row.rentStr === '')).toBe(true);
  });
});
