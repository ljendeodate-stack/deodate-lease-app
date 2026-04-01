import { describe, expect, it } from 'vitest';

import {
  formatLeaseMonthLabel,
  formatLeaseMonthRange,
  getLeaseMonthRange,
  getLeaseMonthNumber,
  getLeaseStartDate,
} from './leaseMonthUtils.js';

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
});
