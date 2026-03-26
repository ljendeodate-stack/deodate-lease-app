import { describe, expect, it } from 'vitest';

import { formToCalculatorParams } from './App.jsx';

describe('formToCalculatorParams', () => {
  it('maps dynamic charge form state into legacy calculator params', () => {
    const params = formToCalculatorParams({
      leaseName: 'Manual lease',
      nnnMode: 'individual',
      squareFootage: '1234',
      abatementEndDate: '03/31/2026',
      abatementPct: '50',
      charges: [
        { key: 'cams', year1: '100', escPct: '3', chargeStart: '01/01/2026', escStart: '01/01/2027' },
        { key: 'insurance', year1: '25', escPct: '2', chargeStart: '', escStart: '' },
        { key: 'taxes', year1: '40', escPct: '1', chargeStart: '', escStart: '' },
        { key: 'security', year1: '15', escPct: '0', chargeStart: '02/01/2026', escStart: '' },
        { key: 'otherItems', year1: '10', escPct: '0', chargeStart: '', escStart: '' },
      ],
      oneTimeItems: [
        { label: 'Key Money', date: '04/15/2026', amount: '5000' },
      ],
    });

    expect(params.squareFootage).toBe(1234);
    expect(params.abatementPct).toBe(50);
    expect(params.cams.year1).toBe(100);
    expect(params.cams.escPct).toBe(3);
    expect(params.insurance.year1).toBe(25);
    expect(params.taxes.year1).toBe(40);
    expect(params.security.year1).toBe(15);
    expect(params.otherItems.year1).toBe(10);
    expect(params.oneTimeItems).toHaveLength(1);
    expect(params.oneTimeItems[0].label).toBe('Key Money');
    expect(params.oneTimeItems[0].amount).toBe(5000);
  });

  it('populates normalized charges array from form.charges', () => {
    const params = formToCalculatorParams({
      leaseName: 'Test',
      nnnMode: 'individual',
      squareFootage: '5000',
      charges: [
        { key: 'cams', canonicalType: 'nnn', displayLabel: 'CAMS', year1: '500', escPct: '3', escStart: '', chargeStart: '' },
        { key: 'custom_1', canonicalType: 'other', displayLabel: 'Parking', year1: '200', escPct: '0', escStart: '', chargeStart: '' },
      ],
      oneTimeItems: [],
    });

    expect(params.charges).toHaveLength(2);
    expect(params.charges[0]).toMatchObject({ key: 'cams', canonicalType: 'nnn', year1: 500, escPct: 3 });
    expect(params.charges[1]).toMatchObject({ key: 'custom_1', canonicalType: 'other', displayLabel: 'Parking', year1: 200 });
    // escStart / chargeStart are parsed to Date or null
    expect(params.charges[0].escStart).toBeNull();
    expect(params.charges[0].chargeStart).toBeNull();
  });

  it('preserves custom charge keys that have no legacy equivalent', () => {
    const params = formToCalculatorParams({
      nnnMode: 'individual',
      charges: [
        { key: 'custom_99', canonicalType: 'nnn', displayLabel: 'Admin Fee', year1: '75', escPct: '2', escStart: '', chargeStart: '' },
      ],
      oneTimeItems: [],
    });

    expect(params.charges).toHaveLength(1);
    expect(params.charges[0].key).toBe('custom_99');
    expect(params.charges[0].year1).toBe(75);
    // Legacy params for unknown key resolve to zero (no crash)
    expect(params.cams.year1).toBe(0);
  });

  it('falls back to the standard charge scaffold when form.charges is absent', () => {
    const params = formToCalculatorParams({ nnnMode: 'individual', oneTimeItems: [] });
    expect(params.charges).toHaveLength(5);
    expect(params.cams.year1).toBe(0);
  });

  it('normalizes dated free-rent and abatement events into one canonical concession array', () => {
    const params = formToCalculatorParams({
      nnnMode: 'individual',
      freeRentEvents: [{ date: '01/15/2026', label: 'Launch month' }],
      abatementEvents: [{ date: '03/20/2026', value: '50', label: 'Half rent' }],
      oneTimeItems: [],
    });

    expect(params.concessionEvents).toHaveLength(2);
    expect(params.concessionEvents[0]).toMatchObject({ type: 'free_rent', scope: 'monthly_row', value: 100 });
    expect(params.concessionEvents[1]).toMatchObject({ type: 'abatement', scope: 'monthly_row', value: 50 });
  });

  it('preserves rentCommencementDate and effectiveAnalysisDate in params', () => {
    const params = formToCalculatorParams({
      nnnMode: 'individual',
      rentCommencementDate: '02/01/2026',
      effectiveAnalysisDate: '03/24/2026',
      oneTimeItems: [],
    });
    expect(params.rentCommencementDate).not.toBeNull();
    expect(params.rentCommencementDate.getMonth()).toBe(1); // February = 1
    expect(params.effectiveAnalysisDate).not.toBeNull();
    expect(params.effectiveAnalysisDate.getDate()).toBe(24);
  });

  it('preserves legacy contiguous abatement fields for backward compatibility', () => {
    const params = formToCalculatorParams({
      nnnMode: 'individual',
      rentCommencementDate: '01/01/2026',
      abatementEndDate: '06/30/2026',
      abatementPct: '75',
      oneTimeItems: [],
    });

    expect(params.abatementPct).toBe(75);
    expect(params.abatementEndDate).not.toBeNull();
    expect(params.concessionEvents[0]).toMatchObject({
      scope: 'legacy_window',
      type: 'abatement',
      value: 75,
    });
  });
});
