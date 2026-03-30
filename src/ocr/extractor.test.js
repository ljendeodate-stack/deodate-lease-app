import { describe, expect, it } from 'vitest';

import {
  detectNarrativeRecurringCharges,
  detectRecurringChargeIrregularities,
  documentIndicatesSfBasedRent,
  repairExtractionSemantics,
  repairNarrativeRecurringChargeSemantics,
  repairRecurringChargeOverrideSemantics,
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

describe('detectRecurringChargeIrregularities', () => {
  it('detects explicit non-annual recurring charge schedules as dated overrides', () => {
    const irregularities = detectRecurringChargeIrregularities(
      [
        'Common Area Maintenance:',
        'February 1, 2027 through January 31, 2028: $4,800.00 per month',
        'February 1, 2028 through January 31, 2030: $5,050.00 per month',
        'February 1, 2030 through January 31, 2034: $5,600.00 per month',
      ].join('\n'),
      [
        {
          label: 'Common Area Maintenance',
          bucketKey: 'cams',
          year1: 4800,
          escPct: null,
          chargeStart: '02/01/2027',
          escStart: '02/01/2028',
        },
      ],
    );

    expect(irregularities).toHaveLength(1);
    expect(irregularities[0].firstStep).toMatchObject({ startDate: '02/01/2027', amount: 4800 });
    expect(irregularities[0].overrideHints).toEqual([
      expect.objectContaining({ bucketKey: 'cams', date: '02/01/2028', amount: 5050 }),
      expect.objectContaining({ bucketKey: 'cams', date: '02/01/2030', amount: 5600 }),
    ]);
  });

  it('does not convert standard delayed-start annual charges into irregular overrides', () => {
    const irregularities = detectRecurringChargeIrregularities(
      [
        'Common Area Maintenance shall be $3,600.00 per month, but billing shall commence on September 1, 2029.',
        'Common Area Maintenance shall increase three percent (3%) on each June 1 beginning June 1, 2030.',
      ].join('\n'),
      [
        {
          label: 'Common Area Maintenance',
          bucketKey: 'cams',
          year1: 3600,
          escPct: 3,
          chargeStart: '09/01/2029',
          escStart: '06/01/2030',
        },
      ],
    );

    expect(irregularities).toEqual([]);
  });
});

describe('narrative recurring charge repair', () => {
  it('detects recurring charge rules from unstructured notes', () => {
    const charges = detectNarrativeRecurringCharges(
      'NNN escalate 2.5% every year, amt 10000',
    );

    expect(charges).toEqual([
      expect.objectContaining({
        label: 'NNN',
        bucketKey: 'cams',
        canonicalType: 'nnn',
        year1: 10000,
        escPct: 2.5,
      }),
    ]);
  });

  it('supplements missing recurring charges from narrative text during repair', () => {
    const repaired = repairNarrativeRecurringChargeSemantics(
      {
        recurringCharges: [],
        notices: [],
      },
      'NNN escalate 2.5% every year, amt 10000',
    );

    expect(repaired.recurringCharges).toEqual([
      expect.objectContaining({
        label: 'NNN',
        bucketKey: 'cams',
        year1: 10000,
        escPct: 2.5,
      }),
    ]);
    expect(repaired.notices[0]).toContain('recurring charge narrative rule');
  });
});

describe('repairRecurringChargeOverrideSemantics', () => {
  it('converts detected irregular recurring schedules into override hints and clears annual escalation fields', () => {
    const repaired = repairRecurringChargeOverrideSemantics(
      {
        recurringCharges: [
          {
            label: 'Operating Expenses',
            bucketKey: 'cams',
            year1: 3950,
            escPct: 3,
            chargeStart: '04/01/2028',
            escStart: '10/01/2030',
            confidence: 0.94,
          },
        ],
        notices: [],
      },
      [
        'Operating Expenses shall be $3,950.00 per month from April 1, 2028 through September 30, 2030.',
        'Beginning October 1, 2030, Operating Expenses shall be $4,275.00 per month.',
        'Beginning January 1, 2034, Operating Expenses shall be $4,620.00 per month through expiration.',
      ].join('\n'),
    );

    expect(repaired.recurringCharges[0]).toMatchObject({
      year1: 3950,
      chargeStart: '04/01/2028',
      escPct: null,
      escStart: null,
    });
    expect(repaired.recurringOverrideHints).toEqual([
      expect.objectContaining({ bucketKey: 'cams', date: '10/01/2030', amount: 4275 }),
      expect.objectContaining({ bucketKey: 'cams', date: '01/01/2034', amount: 4620 }),
    ]);
  });
});

describe('repairExtractionSemantics', () => {
  it('applies both sf-based rent repair and irregular recurring charge repair together', () => {
    const repaired = repairExtractionSemantics(
      {
        sfRequired: false,
        squareFootage: 20000,
        confidenceFlags: [],
        notices: [],
        recurringCharges: [
          {
            label: 'Insurance',
            bucketKey: 'insurance',
            year1: 650,
            escPct: 2,
            chargeStart: '02/01/2027',
            escStart: '08/01/2029',
            confidence: 0.9,
          },
        ],
      },
      [
        'Base Rent: $24.00 per rentable square foot per year.',
        'Insurance:',
        'February 1, 2027 through July 31, 2029: $650.00 per month',
        'August 1, 2029 through January 31, 2032: $725.00 per month',
      ].join('\n'),
    );

    expect(repaired.sfRequired).toBe(true);
    expect(repaired.recurringOverrideHints).toEqual([
      expect.objectContaining({ bucketKey: 'insurance', date: '08/01/2029', amount: 725 }),
    ]);
    expect(repaired.recurringCharges[0].escPct).toBeNull();
  });
});
