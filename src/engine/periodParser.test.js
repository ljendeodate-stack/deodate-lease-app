import { describe, expect, it } from 'vitest';

import { parseBulkPasteText, parsePeriodString } from './periodParser.js';

describe('periodParser', () => {
  it('parses explicit date ranges that use Word/PDF dash variants', () => {
    const parsed = parsePeriodString('03/01/2024–08/31/2024');

    expect(parsed.start?.getFullYear()).toBe(2024);
    expect(parsed.start?.getMonth()).toBe(2);
    expect(parsed.start?.getDate()).toBe(1);
    expect(parsed.end?.getFullYear()).toBe(2024);
    expect(parsed.end?.getMonth()).toBe(7);
    expect(parsed.end?.getDate()).toBe(31);
  });

  it('normalizes bulk-pasted date ranges before splitting period rows', () => {
    const { rows, warnings } = parseBulkPasteText('03/01/2024 – 08/31/2024   $23,149.25');

    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].warning).toBeNull();
    expect(rows[0].start?.getMonth()).toBe(2);
    expect(rows[0].end?.getMonth()).toBe(7);
    expect(rows[0].monthlyRent).toBe(23149.25);
  });
});
