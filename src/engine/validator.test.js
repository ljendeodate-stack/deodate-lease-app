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
});
