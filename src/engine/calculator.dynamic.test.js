/**
 * Tests for the dynamic charges path in calculateAllCharges().
 *
 * Verifies that params.charges[] drives charge computation, emits
 * chargeAmounts/chargeDetails on each row, and correctly classifies
 * NNN vs Other charges for bucket totals and remaining balances.
 */

import { describe, expect, it } from 'vitest';
import { calculateAllCharges } from './calculator.js';
import { expandPeriods } from './expander.js';
import { parseMDYStrict } from './yearMonth.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePeriods(start, end, rent) {
  return [{ periodStart: parseMDYStrict(start), periodEnd: parseMDYStrict(end), monthlyRent: rent }];
}

function baseParams(overrides = {}) {
  return {
    leaseName: 'Dynamic Test',
    nnnMode: 'individual',
    squareFootage: 10000,
    abatementEndDate: null,
    abatementPct: 0,
    nnnAggregate: { year1: 0, escPct: 0 },
    oneTimeItems: [],
    charges: [],
    ...overrides,
  };
}

function expand(periodRows) {
  const { rows } = expandPeriods(periodRows);
  return rows;
}

// ── Custom recurring NNN charge ───────────────────────────────────────────────

describe('custom recurring NNN charge', () => {
  it('computes amount and classifies as NNN', () => {
    const rows = expand(makePeriods('01/01/2025', '12/31/2025', 10000));
    const params = baseParams({
      charges: [
        { key: 'custom_nnn', canonicalType: 'nnn', displayLabel: 'Admin Fee', year1: 500, escPct: 0, escStart: null, chargeStart: null },
      ],
    });

    const result = calculateAllCharges(rows, params);
    expect(result).toHaveLength(12);

    const first = result[0];
    expect(first.chargeAmounts['custom_nnn']).toBe(500);
    expect(first.chargeDetails['custom_nnn'].canonicalType).toBe('nnn');
    expect(first.chargeDetails['custom_nnn'].displayLabel).toBe('Admin Fee');
    expect(first.totalNNNAmount).toBe(500);
    expect(first.totalOtherChargesAmount).toBe(0);
    expect(first.totalMonthlyObligation).toBe(10500);
  });
});

// ── Custom recurring Other charge ─────────────────────────────────────────────

describe('custom recurring Other charge', () => {
  it('computes amount and classifies as Other', () => {
    const rows = expand(makePeriods('01/01/2025', '12/31/2025', 8000));
    const params = baseParams({
      charges: [
        { key: 'parking', canonicalType: 'other', displayLabel: 'Parking', year1: 300, escPct: 0, escStart: null, chargeStart: null },
      ],
    });

    const result = calculateAllCharges(rows, params);
    const first = result[0];
    expect(first.chargeAmounts['parking']).toBe(300);
    expect(first.chargeDetails['parking'].canonicalType).toBe('other');
    expect(first.totalNNNAmount).toBe(0);
    expect(first.totalOtherChargesAmount).toBe(300);
    expect(first.totalMonthlyObligation).toBe(8300);
  });
});

// ── Mixed NNN + Other dynamic charges ─────────────────────────────────────────

describe('mixed NNN and Other dynamic charges', () => {
  it('splits charges into correct buckets', () => {
    const rows = expand(makePeriods('01/01/2025', '12/31/2025', 5000));
    const params = baseParams({
      charges: [
        { key: 'cams',    canonicalType: 'nnn',   displayLabel: 'CAMS',    year1: 400, escPct: 0, escStart: null, chargeStart: null },
        { key: 'taxes',   canonicalType: 'nnn',   displayLabel: 'Taxes',   year1: 200, escPct: 0, escStart: null, chargeStart: null },
        { key: 'parking', canonicalType: 'other', displayLabel: 'Parking', year1: 150, escPct: 0, escStart: null, chargeStart: null },
      ],
    });

    const result = calculateAllCharges(rows, params);
    const first = result[0];
    expect(first.totalNNNAmount).toBe(600);      // 400 + 200
    expect(first.totalOtherChargesAmount).toBe(150);
    expect(first.totalMonthlyObligation).toBe(5750);
  });
});

// ── Delayed billing start ──────────────────────────────────────────────────────

describe('delayed billing start', () => {
  it('charge is inactive before chargeStart date', () => {
    const rows = expand(makePeriods('01/01/2025', '06/30/2025', 4000));
    const params = baseParams({
      charges: [
        { key: 'cams', canonicalType: 'nnn', displayLabel: 'CAMS', year1: 300, escPct: 0, escStart: null, chargeStart: parseMDYStrict('04/01/2025') },
      ],
    });

    const result = calculateAllCharges(rows, params);
    // Jan/Feb/Mar rows should have cams = 0
    expect(result[0].chargeAmounts['cams']).toBe(0);
    expect(result[0].chargeDetails['cams'].active).toBe(false);
    // April row should have cams = 300
    expect(result[3].chargeAmounts['cams']).toBe(300);
    expect(result[3].chargeDetails['cams'].active).toBe(true);
  });
});

// ── Component escalation via explicit escStart ────────────────────────────────

describe('explicit escalation start', () => {
  it('escalation year count is anchored to escStart, not lease start', () => {
    const rows = expand([
      { periodStart: parseMDYStrict('01/01/2025'), periodEnd: parseMDYStrict('12/31/2025'), monthlyRent: 10000 },
      { periodStart: parseMDYStrict('01/01/2026'), periodEnd: parseMDYStrict('12/31/2026'), monthlyRent: 10300 },
    ]);
    // escStart set to one year before the lease, so Jan 2025 row has escYears=1
    const escStart = parseMDYStrict('01/01/2024');
    const params = baseParams({
      charges: [
        { key: 'cams', canonicalType: 'nnn', displayLabel: 'CAMS', year1: 500, escPct: 3, escStart, chargeStart: null },
      ],
    });

    const result = calculateAllCharges(rows, params);
    // Jan 2025 row: monthDiff = (2025*12+0) - (2024*12+0) = 12 → escYears = 1
    expect(result[0].chargeDetails['cams'].escYears).toBe(1);
    expect(result[0].chargeAmounts['cams']).toBeCloseTo(515, 1); // 500 * 1.03^1

    // Jan 2026 row: monthDiff = 24 → escYears = 2
    expect(result[12].chargeDetails['cams'].escYears).toBe(2);
    expect(result[12].chargeAmounts['cams']).toBeCloseTo(530.45, 0); // 500 * 1.03^2
  });
});

// ── Abatement boundary month ───────────────────────────────────────────────────

describe('abatement boundary month', () => {
  it('boundary month is not flagged isAbatementRow', () => {
    const rows = expand(makePeriods('01/01/2025', '06/30/2025', 6000));
    const params = baseParams({
      abatementEndDate: parseMDYStrict('01/31/2025'),
      abatementPct: 100,
      charges: [
        { key: 'cams', canonicalType: 'nnn', displayLabel: 'CAMS', year1: 600, escPct: 0, escStart: null, chargeStart: null },
      ],
    });

    const result = calculateAllCharges(rows, params);
    // Jan row: entire period within abatement → amber
    expect(result[0].isAbatementRow).toBe(true);
    expect(result[0].baseRentApplied).toBe(0);
    // Feb row: after abatement → full rent
    expect(result[1].isAbatementRow).toBe(false);
    expect(result[1].baseRentApplied).toBe(6000);
  });
});

// ── One-time charge timing ─────────────────────────────────────────────────────

describe('one-time charge timing', () => {
  it('assigns charge to the correct row by date', () => {
    const rows = expand(makePeriods('01/01/2025', '06/30/2025', 5000));
    const params = baseParams({
      charges: [],
      oneTimeItems: [
        { label: 'Key Money', amount: 10000, date: parseMDYStrict('03/15/2025') },
      ],
    });

    const result = calculateAllCharges(rows, params);
    // March row (index 2) should carry the one-time charge
    expect(result[2].oneTimeItemAmounts['Key Money']).toBe(10000);
    expect(result[2].oneTimeChargesAmount).toBe(10000);
    // Other months should have zero
    expect(result[0].oneTimeChargesAmount).toBe(0);
    expect(result[1].oneTimeChargesAmount).toBe(0);
  });
});

// ── Remaining obligation splits by bucket ─────────────────────────────────────

describe('remaining obligation splits', () => {
  it('first row remaining equals sum of all monthly obligations', () => {
    const rows = expand(makePeriods('01/01/2025', '12/31/2025', 8000));
    const params = baseParams({
      charges: [
        { key: 'cams',    canonicalType: 'nnn',   displayLabel: 'CAMS',    year1: 500, escPct: 0, escStart: null, chargeStart: null },
        { key: 'parking', canonicalType: 'other', displayLabel: 'Parking', year1: 100, escPct: 0, escStart: null, chargeStart: null },
      ],
    });

    const result = calculateAllCharges(rows, params);
    const sumTotal = result.reduce((s, r) => s + r.totalMonthlyObligation, 0);
    const sumNNN   = result.reduce((s, r) => s + r.totalNNNAmount, 0);
    const sumBase  = result.reduce((s, r) => s + r.baseRentApplied, 0);
    const sumOther = result.reduce((s, r) => s + r.totalOtherChargesAmount, 0);

    expect(result[0].totalObligationRemaining).toBeCloseTo(sumTotal, 1);
    expect(result[0].totalNNNRemaining).toBeCloseTo(sumNNN, 1);
    expect(result[0].totalBaseRentRemaining).toBeCloseTo(sumBase, 1);
    expect(result[0].totalOtherChargesRemaining).toBeCloseTo(sumOther, 1);
  });
});

// ── chargeAmounts / chargeDetails always emitted ──────────────────────────────

describe('normalized row outputs', () => {
  it('chargeAmounts and chargeDetails are always present even in legacy mode', () => {
    const rows = expand(makePeriods('01/01/2025', '03/31/2025', 5000));
    const params = {
      leaseName: 'Legacy',
      nnnMode: 'individual',
      squareFootage: 1000,
      abatementEndDate: null,
      abatementPct: 0,
      nnnAggregate: { year1: 0, escPct: 0 },
      oneTimeItems: [],
      // No charges[] — legacy path
      cams:       { year1: 300, escPct: 3, escStart: null, chargeStart: null },
      insurance:  { year1: 100, escPct: 0, escStart: null, chargeStart: null },
      taxes:      { year1: 150, escPct: 0, escStart: null, chargeStart: null },
      security:   { year1: 50,  escPct: 0, escStart: null, chargeStart: null },
      otherItems: { year1: 0,   escPct: 0, escStart: null, chargeStart: null },
    };

    const result = calculateAllCharges(rows, params);
    expect(result[0].chargeAmounts).toBeDefined();
    expect(result[0].chargeAmounts.cams).toBe(300);
    expect(result[0].chargeDetails).toBeDefined();
    expect(result[0].chargeDetails.cams.displayLabel).toBe('CAMS');
    expect(result[0].chargeDetails.cams.canonicalType).toBe('nnn');
  });
});
