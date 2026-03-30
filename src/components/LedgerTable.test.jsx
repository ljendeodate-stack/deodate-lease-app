import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import LedgerTable from './LedgerTable.jsx';

const SAMPLE_ROW = {
  periodStart: '2030-01-01',
  periodEnd: '2030-01-31',
  leaseYear: 1,
  leaseMonth: 1,
  scheduledBaseRent: 10000,
  baseRentApplied: 10000,
  abatementAmount: 0,
  baseRentProrationFactor: 1,
  chargeAmounts: {
    cams: 1000,
    insurance: 200,
    taxes: 300,
    security: 150,
    otherItems: 50,
  },
  totalNNNAmount: 1500,
  oneTimeChargesAmount: 250,
  oneTimeItemAmounts: { HVAC: 250 },
  totalOtherChargesAmount: 450,
  totalMonthlyObligation: 11950,
  effectivePerSF: 11.95,
  totalObligationRemaining: 50000,
  totalNNNRemaining: 7000,
  totalBaseRentRemaining: 32000,
};

describe('LedgerTable', () => {
  it('renders a visually separate renegotiation and exit block with explicit basis labels', () => {
    const html = renderToStaticMarkup(<LedgerTable rows={[SAMPLE_ROW]} />);

    expect(html).toContain('Lease Schedule');
    expect(html).toContain('Renegotiation');
    expect(html).toContain('Exit');
    expect(html).toContain('Renego: (base rent only) Modest (10%)');
    expect(html).toContain('Exit: (base rent, nets, and other obligations) Full Obligation (0%)');
    expect(html).toContain('$28,800.00');
    expect(html).toContain('$50,000.00');
    expect(html).toContain('background-color:#A95513');
    expect(html).toContain('background-color:#D07A2A');
  });
});
