import { describe, expect, it } from 'vitest';

import { buildOCRConcessionForms } from './leaseTerms.js';

describe('buildOCRConcessionForms', () => {
  const rows = [
    { date: '2030-01-01', periodEnd: null },
    { date: '2030-02-01', periodEnd: null },
    { date: '2030-03-01', periodEnd: '2030-03-31' },
  ];

  it('converts a legacy OCR abatement window into dated monthly abatement events', () => {
    const result = buildOCRConcessionForms({
      abatementEndDate: '02/28/2030',
      abatementPct: 50,
    }, rows);

    expect(result.freeRentEvents).toEqual([]);
    expect(result.abatementEvents).toHaveLength(2);
    expect(result.abatementEvents[0]).toMatchObject({ date: '01/01/2030', value: '50' });
    expect(result.abatementEvents[1]).toMatchObject({ date: '02/01/2030', value: '50' });
  });

  it('converts a 100 percent OCR window into dated free-rent events', () => {
    const result = buildOCRConcessionForms({
      abatementEndDate: '02/28/2030',
      abatementPct: 100,
    }, rows);

    expect(result.abatementEvents).toEqual([]);
    expect(result.freeRentEvents).toHaveLength(2);
    expect(result.freeRentEvents[0]).toMatchObject({ date: '01/01/2030' });
    expect(result.freeRentEvents[1]).toMatchObject({ date: '02/01/2030' });
  });

  it('preserves missing value mode on OCR abatement events instead of defaulting to percent', () => {
    const result = buildOCRConcessionForms({
      abatementEvents: [
        { monthNumber: 2, value: 2000, valueMode: null, date: '02/10/2030', label: 'Imported Dollar Abatement' },
      ],
    }, rows);

    expect(result.abatementEvents).toHaveLength(1);
    expect(result.abatementEvents[0]).toMatchObject({
      monthNumber: '2',
      value: '2000',
      valueMode: null,
      date: '02/01/2030',
    });
  });
});
