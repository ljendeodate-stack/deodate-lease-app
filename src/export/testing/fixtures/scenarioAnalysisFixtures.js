import { parseMDYStrict } from '../../../engine/yearMonth.js';

function d(value) {
  return parseMDYStrict(value);
}

function period(periodStart, periodEnd, monthlyRent) {
  return { periodStart: d(periodStart), periodEnd: d(periodEnd), monthlyRent };
}

function makeParams(overrides = {}) {
  return {
    leaseName: 'Semantic Fixture Lease',
    nnnMode: 'individual',
    squareFootage: 10000,
    abatementEndDate: null,
    abatementPct: 0,
    nnnAggregate: { year1: 0, escPct: 0 },
    cams: { year1: 1200, escPct: 3, escStart: null, chargeStart: null },
    insurance: { year1: 300, escPct: 3, escStart: null, chargeStart: null },
    taxes: { year1: 500, escPct: 3, escStart: null, chargeStart: null },
    security: { year1: 150, escPct: 2, escStart: null, chargeStart: null },
    otherItems: { year1: 75, escPct: 2, escStart: null, chargeStart: null },
    oneTimeItems: [],
    ...overrides,
  };
}

const basePeriods = [
  period('01/01/2025', '12/31/2025', 10000),
];

export const scenarioAnalysisFixtures = [
  {
    id: 'standard-nonzero',
    description: 'Standard lease with non-zero base rent and NNN.',
    filename: 'semantic-standard-nonzero',
    periodRows: basePeriods,
    params: makeParams({ leaseName: 'Standard Non-Zero Lease' }),
    expected: {
      requiresApproximateRouting: false,
      hasOneTimeCharges: false,
      hasAbatement: false,
    },
  },
  {
    id: 'abatement',
    description: 'Lease with full abatement through the first quarter.',
    filename: 'semantic-abatement',
    periodRows: basePeriods,
    params: makeParams({
      leaseName: 'Abatement Lease',
      abatementEndDate: d('03/31/2025'),
      abatementPct: 100,
    }),
    expected: {
      requiresApproximateRouting: false,
      hasOneTimeCharges: false,
      hasAbatement: true,
    },
  },
  {
    id: 'free-rent',
    description: 'Lease with free-rent months that should flow through the live lease schedule total into Scenario Analysis.',
    filename: 'semantic-free-rent',
    periodRows: basePeriods,
    params: makeParams({
      leaseName: 'Free Rent Lease',
      concessionEvents: [
        { id: 'free_1', type: 'free_rent', scope: 'monthly_row', effectiveDate: d('01/01/2025'), valueMode: 'percent', value: 100, label: 'Opening month' },
        { id: 'free_2', type: 'free_rent', scope: 'monthly_row', effectiveDate: d('02/01/2025'), valueMode: 'percent', value: 100, label: 'Launch support' },
      ],
    }),
    expected: {
      requiresApproximateRouting: false,
      hasOneTimeCharges: false,
      hasAbatement: false,
    },
  },
  {
    id: 'one-time-charges',
    description: 'Lease with separate one-time charges that should not route into Additional Rent.',
    filename: 'semantic-one-time-charges',
    periodRows: basePeriods,
    params: makeParams({
      leaseName: 'One-Time Charges Lease',
      oneTimeItems: [
        { label: 'Broker Fee', amount: 5000, date: d('06/15/2025') },
        { label: 'Signage Allowance', amount: -1200, date: d('08/15/2025') },
      ],
    }),
    analysisDate: d('07/01/2025'),
    expected: {
      requiresApproximateRouting: false,
      hasOneTimeCharges: true,
      hasAbatement: false,
    },
  },
  {
    id: 'non-anchor-analysis-date',
    description: 'Lease where the selected analysis date falls between schedule anchors.',
    filename: 'semantic-non-anchor-analysis-date',
    periodRows: basePeriods,
    params: makeParams({ leaseName: 'Non-Anchor Analysis Date Lease' }),
    analysisDate: d('02/15/2025'),
    expected: {
      requiresApproximateRouting: true,
      hasOneTimeCharges: false,
      hasAbatement: false,
    },
  },
];
