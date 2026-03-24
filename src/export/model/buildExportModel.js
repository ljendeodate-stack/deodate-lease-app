import { getActiveCategories, buildColumnLayout } from '../../engine/chargeCategories.js';

/**
 * Build the shared export model for the current workbook export.
 *
 * @param {object[]} rows
 * @param {object} params
 * @param {string} filename
 * @returns {import('../types.js').ExportModel}
 */
export function buildExportModel(rows, params = {}, filename = 'lease-schedule') {
  const nnnMode = params.nnnMode ?? 'individual';
  const activeCategories = getActiveCategories(rows, params, nnnMode);
  const assumptions = computeAssumptions(rows, params, activeCategories);
  const otLabels = deriveOneTimeLabels(rows);
  const columns = buildColumnLayout(activeCategories, otLabels, nnnMode);
  const assumptionEntries = buildAssumptionEntries(assumptions, activeCategories);

  return {
    rows,
    params,
    filename,
    nnnMode,
    activeCategories,
    assumptions,
    assumptionEntries,
    otLabels,
    columns,
  };
}

function deriveOneTimeLabels(rows) {
  const seenLabels = new Set();
  const otLabels = [];

  for (const row of rows) {
    for (const [label, amount] of Object.entries(row.oneTimeItemAmounts ?? {})) {
      if (amount > 0 && !seenLabels.has(label)) {
        seenLabels.add(label);
        otLabels.push(label);
      }
    }
  }

  return otLabels;
}

function buildAssumptionEntries(assumptions, activeCategories) {
  const entries = [
    { id: 'squareFootage', label: 'Rentable SF', kind: 'input', format: 'int', value: assumptions.squareFootage },
    { id: 'commencementDate', label: 'Lease Commencement Date', kind: 'date', format: 'date', value: assumptions.commencementDate },
    { id: 'expirationDate', label: 'Lease Expiration Date', kind: 'date', format: 'date', value: assumptions.expirationDate },
    { id: 'year1BaseRent', label: 'Year 1 Monthly Base Rent', kind: 'input', format: 'currency', value: assumptions.year1BaseRent },
    { id: 'annualEscRate', label: 'Annual Base Rent Escalation Rate (%)', kind: 'input', format: 'pct', value: assumptions.annualEscRate },
    { id: 'anniversaryMonth', label: 'Lease Anniversary Month', kind: 'input', format: 'int', value: assumptions.anniversaryMonth },
    { id: 'abatementMonths', label: 'Abatement Full-Month Count', kind: 'input', format: 'int', value: assumptions.fullAbatementMonths },
    { id: 'abatementPartialFactor', label: 'Abatement Partial-Month Proration Factor', kind: 'input', format: 'factor', value: assumptions.abatementPartialFactor },
  ];

  if (assumptions.nnnMode === 'aggregate') {
    entries.push(
      {
        id: 'nnnAgg_year1',
        label: 'NNN Combined Year 1 Monthly Amount',
        kind: 'input',
        format: 'currency',
        value: assumptions.nnnAggYear1 ?? 0,
      },
      {
        id: 'nnnAgg_escRate',
        label: 'NNN Combined Annual Escalation Rate (%)',
        kind: 'input',
        format: 'pct',
        value: assumptions.nnnAggEscRate ?? 0,
      },
    );
  }

  for (const category of activeCategories) {
    const catData = assumptions.categories[category.key] ?? { year1: 0, escRate: 0 };
    entries.push(
      {
        id: `${category.key}_year1`,
        label: category.assumptionLabels.year1,
        kind: 'input',
        format: 'currency',
        value: catData.year1,
      },
      {
        id: `${category.key}_escRate`,
        label: category.assumptionLabels.escRate,
        kind: 'input',
        format: 'pct',
        value: catData.escRate,
      },
    );
  }

  return entries;
}

function computeAssumptions(rows, params, activeCategories) {
  const nnnMode = params.nnnMode ?? 'individual';
  const isAggregate = nnnMode === 'aggregate';

  if (!rows || rows.length === 0) {
    const empty = {
      leaseName: params.leaseName || '',
      nnnMode,
      squareFootage: 0,
      commencementDate: null,
      expirationDate: null,
      year1BaseRent: 0,
      annualEscRate: 0,
      anniversaryMonth: 1,
      fullAbatementMonths: 0,
      abatementPartialFactor: 1,
      categories: {},
    };

    if (isAggregate) {
      empty.nnnAggYear1 = 0;
      empty.nnnAggEscRate = 0;
    }

    for (const category of activeCategories) {
      empty.categories[category.key] = { year1: 0, escRate: 0 };
    }

    return empty;
  }

  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];
  const year1BaseRent = firstRow.scheduledBaseRent ?? 0;

  const year2Row = rows.find((row) => (row.leaseYear ?? row['Year #']) === 2);
  let annualEscRate = 0;
  if (year2Row && year1BaseRent > 0) {
    annualEscRate = (year2Row.scheduledBaseRent ?? 0) / year1BaseRent - 1;
  }

  const fullAbatementMonths = rows.filter((row) => row.isAbatementRow).length;
  const boundaryRow = rows.find((row) => row.prorationBasis === 'abatement-boundary');
  const abatementPartialFactor = boundaryRow
    ? (boundaryRow.baseRentProrationFactor ?? 1)
    : 1;

  const assumptions = {
    leaseName: String(params.leaseName || ''),
    nnnMode,
    squareFootage: Number(params.squareFootage) || 0,
    commencementDate: firstRow.periodStart ?? null,
    expirationDate: lastRow.periodEnd ?? null,
    year1BaseRent,
    annualEscRate,
    anniversaryMonth: 1,
    fullAbatementMonths,
    abatementPartialFactor,
    categories: {},
  };

  if (isAggregate) {
    assumptions.nnnAggYear1 = Number(params.nnnAggregate?.year1) || 0;
    assumptions.nnnAggEscRate = (Number(params.nnnAggregate?.escPct) || 0) / 100;
  }

  for (const category of activeCategories) {
    assumptions.categories[category.key] = {
      year1: Number(params[category.paramKey]?.year1) || 0,
      escRate: (Number(params[category.paramKey]?.escPct) || 0) / 100,
    };
  }

  return assumptions;
}
