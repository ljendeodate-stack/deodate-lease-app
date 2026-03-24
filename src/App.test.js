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
});
