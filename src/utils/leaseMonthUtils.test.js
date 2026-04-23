import { describe, expect, it } from 'vitest';

import {
  formatLeaseMonthLabel,
  formatLeaseMonthRange,
  getLeaseMonthEndDate,
  getLeaseMonthRange,
  getLeaseMonthNumber,
  getLeaseMonthStartDate,
  getLeaseStartDate,
} from './leaseMonthUtils.js';
import { parseMDYStrict } from '../engine/yearMonth.js';

describe('leaseMonthUtils', () => {
  it('computes anchored lease month numbers from the earliest valid schedule date', () => {
    const leaseStart = getLeaseStartDate([
      { periodStart: '12/26/2024' },
      { periodStart: '06/26/2024' },
      { periodStart: '06/26/2029' },
    ]);

    expect(getLeaseMonthNumber(leaseStart, '06/26/2024')).toBe(1);
    expect(getLeaseMonthNumber(leaseStart, '12/26/2024')).toBe(7);
    expect(getLeaseMonthNumber(leaseStart, '06/26/2029')).toBe(61);
  });

  it('formats a badge label only for positive month numbers', () => {
    expect(formatLeaseMonthLabel(7)).toBe('Month 7');
    expect(formatLeaseMonthLabel(null)).toBe('');
  });

  it('formats a full lease-month span for a dated period', () => {
    const range = getLeaseMonthRange('04/03/2026', '04/03/2026', '07/04/2026');

    expect(range).toEqual({
      startMonthNumber: 1,
      endMonthNumber: 4,
    });
    expect(formatLeaseMonthRange(range)).toBe('1-4');
  });

  it('resolves anchored lease month boundaries back into calendar dates', () => {
    expect(getLeaseMonthStartDate('06/26/2024', 13)?.getTime()).toBe(parseMDYStrict('06/26/2025')?.getTime());
    expect(getLeaseMonthEndDate('06/26/2024', 19)?.getTime()).toBe(parseMDYStrict('01/25/2026')?.getTime());
  });
});
