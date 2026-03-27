import { describe, expect, it } from 'vitest';

import {
  documentIndicatesSfBasedRent,
  repairSfBasedRentSemantics,
} from './extractor.js';

describe('documentIndicatesSfBasedRent', () => {
  it('detects base rent expressed per square foot per year on the same line', () => {
    const text = 'Lease Year 1 Base Rent: $24.00 per rentable square foot per year.';
    expect(documentIndicatesSfBasedRent(text)).toBe(true);
  });

  it('detects base rent expressed per square foot across adjacent lines', () => {
    const text = [
      'BASE RENT',
      'Lease Year 1: $24.00 per rentable square foot per year.',
    ].join('\n');
    expect(documentIndicatesSfBasedRent(text)).toBe(true);
  });

  it('does not misclassify non-rent per-square-foot references', () => {
    const text = 'Property Taxes: $3.20 per square foot per year.';
    expect(documentIndicatesSfBasedRent(text)).toBe(false);
  });
});

describe('repairSfBasedRentSemantics', () => {
  it('forces sfRequired when the document indicates square-footage-based rent', () => {
    const repaired = repairSfBasedRentSemantics(
      {
        sfRequired: false,
        squareFootage: 20000,
        confidenceFlags: [],
        notices: [],
      },
      'Lease Year 1 Base Rent: $24.00 per rentable square foot per year.',
    );

    expect(repaired.sfRequired).toBe(true);
    expect(repaired.confidenceFlags).toEqual([]);
  });

  it('flags square footage when sf-based rent is detected but square footage is missing', () => {
    const repaired = repairSfBasedRentSemantics(
      {
        sfRequired: false,
        squareFootage: null,
        confidenceFlags: [],
        notices: [],
      },
      'Minimum Rent shall be $2.00 per square foot per month.',
    );

    expect(repaired.sfRequired).toBe(true);
    expect(repaired.confidenceFlags).toContain('squareFootage');
  });

  it('leaves non-sf leases unchanged', () => {
    const repaired = repairSfBasedRentSemantics(
      {
        sfRequired: false,
        squareFootage: 10000,
        confidenceFlags: [],
        notices: [],
      },
      'Monthly Base Rent during Lease Year 1 shall be $10,000.00 per month.',
    );

    expect(repaired.sfRequired).toBe(false);
    expect(repaired.confidenceFlags).toEqual([]);
  });
});
