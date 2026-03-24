import { parseMDYStrict } from '../../../engine/yearMonth.js';

function d(value) {
  return parseMDYStrict(value);
}

function period(periodStart, periodEnd, monthlyRent) {
  return { periodStart: d(periodStart), periodEnd: d(periodEnd), monthlyRent };
}

function makeParams(overrides = {}) {
  return {
    leaseName: 'Annual Summary Fixture Lease',
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

// Single-year lease (12 months)
const singleYearPeriods = [
  period('01/01/2025', '12/31/2025', 10000),
];

// Two-year lease (24 months)
const twoYearPeriods = [
  period('01/01/2025', '12/31/2025', 10000),
  period('01/01/2026', '12/31/2026', 10300),
];

// Three-year lease with escalation
const threeYearPeriods = [
  period('01/01/2025', '12/31/2025', 10000),
  period('01/01/2026', '12/31/2026', 10300),
  period('01/01/2027', '12/31/2027', 10609),
];

export const annualSummaryFixtures = [
  {
    id: 'single-year',
    description: 'Single-year lease — Annual Summary should have exactly one data row.',
    filename: 'annual-summary-single-year',
    periodRows: singleYearPeriods,
    params: makeParams({ leaseName: 'Single Year Lease' }),
    expected: {
      yearCount: 1,
      hasAbatement: false,
      hasOneTimeCharges: false,
    },
  },
  {
    id: 'two-year',
    description: 'Two-year lease — Annual Summary should have exactly two data rows.',
    filename: 'annual-summary-two-year',
    periodRows: twoYearPeriods,
    params: makeParams({ leaseName: 'Two Year Lease' }),
    expected: {
      yearCount: 2,
      hasAbatement: false,
      hasOneTimeCharges: false,
    },
  },
  {
    id: 'three-year',
    description: 'Three-year lease — Annual Summary totals must tie to Lease Schedule data.',
    filename: 'annual-summary-three-year',
    periodRows: threeYearPeriods,
    params: makeParams({ leaseName: 'Three Year Lease' }),
    expected: {
      yearCount: 3,
      hasAbatement: false,
      hasOneTimeCharges: false,
    },
  },
  {
    id: 'abatement',
    description: 'Lease with abatement — abated months excluded from base rent totals.',
    filename: 'annual-summary-abatement',
    periodRows: singleYearPeriods,
    params: makeParams({
      leaseName: 'Abatement Lease',
      abatementEndDate: d('03/31/2025'),
      abatementPct: 100,
    }),
    expected: {
      yearCount: 1,
      hasAbatement: true,
      hasOneTimeCharges: false,
    },
  },
  {
    id: 'one-time-charges',
    description: 'Lease with one-time charges — charges should not inflate Total NNN.',
    filename: 'annual-summary-one-time-charges',
    periodRows: singleYearPeriods,
    params: makeParams({
      leaseName: 'One-Time Charges Lease',
      oneTimeItems: [
        { label: 'Broker Fee', amount: 5000, date: d('06/15/2025') },
      ],
    }),
    expected: {
      yearCount: 1,
      hasAbatement: false,
      hasOneTimeCharges: true,
    },
  },
];
