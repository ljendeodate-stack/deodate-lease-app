import { describe, expect, it } from 'vitest';

import { validateParams } from './validator.js';

describe('validateParams', () => {
  const rows = [
    { date: '2026-01-01', 'Month #': 1 },
    { date: '2026-12-01', 'Month #': 12 },
  ];

  it('validates dynamic charges array fields using charges.N paths', () => {
    const result = validateParams(
      {
        squareFootage: '1000',
        nnnMode: 'individual',
        charges: [
          {
            key: 'cams',
            displayLabel: 'CAMS',
            year1: 'abc',
            escPct: '3',
            chargeStart: '13/40/2026',
            escStart: '02/01/2026',
          },
        ],
      },
      rows,
    );

    expect(result.errors.map((error) => error.field)).toContain('charges.0.year1');
    expect(result.errors.map((error) => error.field)).toContain('charges.0.chargeStart');
  });

  it('validates aggregate NNN inputs when aggregate mode is selected', () => {
    const result = validateParams(
      {
        squareFootage: '1000',
        nnnMode: 'aggregate',
        nnnAggregate: {
          year1: 'abc',
          escPct: 'oops',
        },
      },
      rows,
    );

    expect(result.errors.map((error) => error.field)).toContain('nnnAggregate.year1');
    expect(result.errors.map((error) => error.field)).toContain('nnnAggregate.escPct');
  });

  it('blocks conflicting dated concession events landing in the same monthly row', () => {
    const result = validateParams(
      {
        squareFootage: '1000',
        nnnMode: 'individual',
        freeRentEvents: [{ date: '01/15/2026' }],
        abatementEvents: [{ date: '01/25/2026', value: '50' }],
      },
      rows,
    );

    expect(result.errors.map((error) => error.field)).toContain('abatementEvents.0.date');
  });

  it('validates malformed concession dates and abatement percentages', () => {
    const result = validateParams(
      {
        squareFootage: '1000',
        nnnMode: 'individual',
        freeRentEvents: [{ date: '2026-99-99' }],
        abatementEvents: [{ date: '01/20/2026', value: '150' }],
      },
      rows,
    );

    expect(result.errors.map((error) => error.field)).toContain('freeRentEvents.0.date');
    expect(result.errors.map((error) => error.field)).toContain('abatementEvents.0.value');
  });

  it('validates recurring override amounts and duplicate target rows', () => {
    const result = validateParams(
      {
        squareFootage: '1000',
        nnnMode: 'individual',
        charges: [
          {
            key: 'parking',
            displayLabel: 'Parking',
            canonicalType: 'other',
            year1: '100',
            escPct: '0',
            chargeStart: '',
            escStart: '',
          },
        ],
        recurringOverrides: [
          { targetKey: 'parking', date: '01/15/2026', amount: 'abc' },
          { targetKey: 'parking', date: '01/25/2026', amount: '250' },
        ],
      },
      rows,
    );

    expect(result.errors.map((error) => error.field)).toContain('recurringOverrides.0.amount');
    expect(result.errors.map((error) => error.field)).toContain('recurringOverrides.1.date');
  });
});
