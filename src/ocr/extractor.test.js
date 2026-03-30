import { describe, expect, it } from 'vitest';

import {
  detectNarrativeRecurringCharges,
  detectRecurringChargeIrregularities,
  documentIndicatesSfBasedRent,
  repairDirectLeaseFactSemantics,
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

describe('repairDirectLeaseFactSemantics', () => {
  it('recovers premises rentable area, security deposit, and initial free-rent months from lease text', () => {
    const repaired = repairDirectLeaseFactSemantics(
      {
        squareFootage: null,
        securityDeposit: null,
        securityDepositDate: null,
        oneTimeItems: [],
        oneTimeCharges: [],
        freeRentEvents: [],
        confidenceFlags: ['squareFootage'],
        notices: [],
      },
      [
        '(10) Rentable Area of the Premises: 12,025 square feet',
        '(11) Security Deposit: Eighteen Thousand Seven Hundred Eighty-Nine and 06/100 Dollars ($18,789.06)',
        'Tenant shall be excused of its obligation to pay each monthly installment of Monthly Base Rent due and payable hereunder for the first three (3) full calendar months of the Term.',
      ].join('\n'),
    );

    expect(repaired.squareFootage).toBe(12025);
    expect(repaired.confidenceFlags).not.toContain('squareFootage');
    expect(repaired.securityDeposit).toBe(18789.06);
    expect(repaired.oneTimeItems).toEqual([
      expect.objectContaining({ label: 'Security Deposit', amount: 18789.06, dueDate: null, sign: 1 }),
    ]);
    expect(repaired.oneTimeCharges).toEqual([
      expect.objectContaining({ label: 'Security Deposit', amount: 18789.06, dueDate: null, sign: 1 }),
    ]);
    expect(repaired.freeRentEvents).toEqual([
      expect.objectContaining({ monthNumber: 1, label: 'Conditionally Excused Rent' }),
      expect.objectContaining({ monthNumber: 2, label: 'Conditionally Excused Rent' }),
      expect.objectContaining({ monthNumber: 3, label: 'Conditionally Excused Rent' }),
    ]);
  });

  it('merges missing free-rent months into a partial OCR concession set and recovers allowance tranches', () => {
    const repaired = repairDirectLeaseFactSemantics(
      {
        squareFootage: null,
        securityDeposit: null,
        securityDepositDate: null,
        oneTimeItems: [],
        oneTimeCharges: [],
        freeRentEvents: [{ monthNumber: 1, label: 'Free Rent', rawText: 'month 1 free' }],
        confidenceFlags: [],
        notices: [],
      },
      [
        'The Premises contain 12,025 rentable square feet.',
        'Tenant Improvement Allowance: $175,312.50 initial funding and the remaining 75% in the amount of $525,937.50 after receipt of invoices.',
        'Tenant shall be excused of its obligation to pay each monthly installment of Monthly Base Rent due and payable hereunder for the first three (3) full calendar months of the Term.',
      ].join('\n'),
    );

    expect(repaired.freeRentEvents.map((event) => event.monthNumber)).toEqual([1, 2, 3]);
    expect(repaired.oneTimeItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Tenant Improvement Allowance - Initial Funding', sign: -1, amount: 175312.5 }),
        expect.objectContaining({ label: 'Tenant Improvement Allowance - Final Funding', sign: -1, amount: 525937.5 }),
      ]),
    );
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

  it('keeps recurring obligations even when lease prose names the charge but omits a dollar amount', () => {
    const charges = detectNarrativeRecurringCharges(
      'Tenant shall pay Operating Expenses as Additional Rent throughout the Term.',
    );

    expect(charges).toEqual([
      expect.objectContaining({
        label: 'Operating Expenses',
        bucketKey: 'cams',
        year1: null,
        sourceKind: 'narrative_obligation',
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

  it('preserves recovered lease facts through the full repair pipeline', () => {
    const repaired = repairExtractionSemantics(
      {
        sfRequired: false,
        squareFootage: null,
        securityDeposit: null,
        securityDepositDate: null,
        oneTimeItems: [],
        oneTimeCharges: [],
        freeRentEvents: [],
        confidenceFlags: [],
        notices: [],
        recurringCharges: [],
        rentSchedule: [],
        rentCommencementDate: null,
      },
      [
        'Commencement Date shall be February 1, 2022.',
        'Monthly Base Rent:',
        'Months 1 - 24 $18,789.06',
        'Months 124 – 183 $24,551.04',
        '(10) Rentable Area of the Premises: 12,025 square feet',
        '(11) Security Deposit: Eighteen Thousand Seven Hundred Eighty-Nine and 06/100 Dollars ($18,789.06)',
        'Tenant shall be excused of its obligation to pay each monthly installment of Monthly Base Rent for the first three (3) full calendar months of the Term.',
      ].join('\n'),
    );

    expect(repaired.squareFootage).toBe(12025);
    expect(repaired.securityDeposit).toBe(18789.06);
    expect(repaired.freeRentEvents).toHaveLength(3);
    expect(repaired.rentSchedule).toEqual([
      { periodStart: '02/01/2022', periodEnd: '01/31/2024', monthlyRent: 18789.06 },
      { periodStart: '05/01/2032', periodEnd: '04/30/2037', monthlyRent: 24551.04 },
    ]);
  });

  it('recovers explicit dated rent rows directly from OCR text when the structured rent schedule is omitted', () => {
    const repaired = repairExtractionSemantics(
      {
        leaseName: 'Explicit Dated OCR Lease',
        sfRequired: false,
        squareFootage: null,
        confidenceFlags: [],
        notices: [],
        rentSchedule: [],
        recurringCharges: [],
      },
      [
        'Minimum Annual Rent:',
        '3/1/18-2/28/19    $98,463.60',
        '3/1/19-2/29/20    $101,417.51',
        '3/1/20-2/28/21    $104,460.03',
      ].join('\n'),
    );

    expect(repaired.rentSchedule).toEqual([
      { periodStart: '03/01/2018', periodEnd: '02/28/2019', monthlyRent: 98463.6 },
      { periodStart: '03/01/2019', periodEnd: '02/29/2020', monthlyRent: 101417.51 },
      { periodStart: '03/01/2020', periodEnd: '02/28/2021', monthlyRent: 104460.03 },
    ]);
    expect(repaired.notices).toContain(
      'Base-rent schedule was recovered directly from explicit dated rent rows in lease text after OCR omitted the structured schedule.',
    );
  });

  it('does not misclassify per-square-foot rates as explicit monthly rent rows', () => {
    const repaired = repairExtractionSemantics(
      {
        leaseName: 'Rate Schedule Misfire Guard',
        sfRequired: false,
        squareFootage: null,
        confidenceFlags: [],
        notices: [],
        rentSchedule: [],
        recurringCharges: [],
      },
      [
        'Base Rent:',
        '3/1/19-2/29/20    $3.00 per rentable square foot per month',
      ].join('\n'),
    );

    expect(repaired.rentSchedule).toEqual([]);
    expect(repaired.notices).not.toContain(
      'Base-rent schedule was recovered directly from explicit dated rent rows in lease text after OCR omitted the structured schedule.',
    );
  });

  it('runs explicit text fallback even when LLM returned rows that all fail date parsing', () => {
    // Simulates the "junk row suppresses fallback" failure mode:
    // LLM returns a non-empty rentSchedule with an unparseable date string,
    // which previously blocked detectExplicitDatedRentSchedule from running.
    const repaired = repairExtractionSemantics(
      {
        leaseName: 'Junk Row Suppression Guard',
        sfRequired: false,
        squareFootage: null,
        confidenceFlags: [],
        notices: [],
        rentSchedule: [
          { periodStart: 'NOT A DATE', periodEnd: 'ALSO NOT A DATE', monthlyRent: 98463.6 },
        ],
        recurringCharges: [],
      },
      [
        'Minimum Annual Rent:',
        '3/1/18-2/28/19    $98,463.60',
        '3/1/19-2/29/20    $101,417.51',
      ].join('\n'),
    );

    expect(repaired.rentSchedule).toEqual([
      { periodStart: '03/01/2018', periodEnd: '02/28/2019', monthlyRent: 98463.6 },
      { periodStart: '03/01/2019', periodEnd: '02/29/2020', monthlyRent: 101417.51 },
    ]);
    expect(repaired.notices.some((n) => n.includes('could not be parsed'))).toBe(true);
  });

  it('recovers explicit dated rows when date range and amount are separated by wide column spacing', () => {
    // PDF text extraction can produce 30+ spaces between table columns.
    // The previous 12-char separator window would have dropped these rows silently.
    const repaired = repairExtractionSemantics(
      {
        leaseName: 'Wide Column Spacing Guard',
        sfRequired: false,
        squareFootage: null,
        confidenceFlags: [],
        notices: [],
        rentSchedule: [],
        recurringCharges: [],
      },
      [
        'Period                                Monthly Rent',
        '3/1/18-2/28/19                        $98,463.60',
        '3/1/19-2/29/20                        $101,417.51',
      ].join('\n'),
    );

    expect(repaired.rentSchedule).toHaveLength(2);
    expect(repaired.rentSchedule[0]).toMatchObject({ periodStart: '03/01/2018', monthlyRent: 98463.6 });
    expect(repaired.rentSchedule[1]).toMatchObject({ periodStart: '03/01/2019', monthlyRent: 101417.51 });
  });

  it('recovers explicit dated rows when the amount falls on the continuation line', () => {
    // Y-coordinate bucketing in PDF extraction can split date ranges and amounts
    // onto separate lines. The continuation-line lookup must bridge the gap.
    const repaired = repairExtractionSemantics(
      {
        leaseName: 'Continuation Line Guard',
        sfRequired: false,
        squareFootage: null,
        confidenceFlags: [],
        notices: [],
        rentSchedule: [],
        recurringCharges: [],
      },
      [
        '3/1/18-2/28/19',
        '$98,463.60',
        '3/1/19-2/29/20',
        '$101,417.51',
      ].join('\n'),
    );

    expect(repaired.rentSchedule).toHaveLength(2);
    expect(repaired.rentSchedule[0]).toMatchObject({ periodStart: '03/01/2018', monthlyRent: 98463.6 });
    expect(repaired.rentSchedule[1]).toMatchObject({ periodStart: '03/01/2019', monthlyRent: 101417.51 });
  });
});
