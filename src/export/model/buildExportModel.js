import { getActiveCategories, buildColumnLayout } from '../../engine/chargeCategories.js';

/** Convert a Date object or ISO string to YYYY-MM-DD, or return null. */
function dateToISO(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.length === 10 ? d : null;
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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

/**
 * Build the full six-section assumption entries list.
 *
 * Entry layout (all entries always present, even when values are absent):
 *   Section 1 — LEASE DRIVERS          (7 entries: heading + 6 fields)
 *   Section 2 — MONTHLY RENT BREAKDOWN (5 entries: heading + mode + year1BaseRent + [nnnAgg?] + per-category year1)
 *   Section 3 — ESCALATION ASSUMPTIONS (5 entries: heading + annualEscRate + anniversaryMonth + [nnnAgg?] + per-category escRate)
 *   Section 4 — ABATEMENT              (5 entries: heading + 4 fields)
 *   Section 5 — FREE RENT              (3 entries: heading + 2 fields)
 *   Section 6 — NON-RECURRING CHARGES  (1 heading + max(M, 1) items or "(none)")
 *
 * Formula cells (referenced by buildDataSection via cellMap):
 *   squareFootage   → always index 2  → row 7
 *   year1BaseRent   → always index 9  → row 14
 *   annualEscRate   → always index 13 → row 18  (after 7+1+1+1 = 10 fixed, + 3 section3-offset = 13)
 *   abatementMonths → always index 18 → row 23
 *   abatementPartialFactor → always index 21 → row 26
 *   {key}_year1     → index 10 + catIdx (individual) or 10 + nnnAggOffset + catIdx
 *   {key}_escRate   → index 15 + catIdx (individual) or 15 + nnnAggOffset + catIdx
 */
function buildAssumptionEntries(assumptions, activeCategories) {
  const entries = [];
  const isAggregate = assumptions.nnnMode === 'aggregate';

  // ── Section 1: Lease Drivers ────────────────────────────────────────────
  entries.push({ id: 'section_leaseDrivers',   label: 'LEASE DRIVERS',              kind: 'heading' });
  entries.push({ id: 'leaseName',              label: 'Lease Name',                  kind: 'text', format: 'text', value: assumptions.leaseName || '' });
  entries.push({ id: 'squareFootage',          label: 'Rentable SF',                 kind: 'input', format: 'int', value: assumptions.squareFootage });
  entries.push({ id: 'commencementDate',       label: 'Lease Commencement Date',     kind: 'date', format: 'date', value: assumptions.commencementDate });
  entries.push({ id: 'expirationDate',         label: 'Lease Expiration Date',       kind: 'date', format: 'date', value: assumptions.expirationDate });
  entries.push({ id: 'rentCommencementDate',   label: 'Rent Commencement Date',      kind: 'date', format: 'date', value: assumptions.rentCommencementDate ?? null });
  entries.push({ id: 'effectiveAnalysisDate',  label: 'Effective Analysis Date',     kind: 'date', format: 'date', value: assumptions.effectiveAnalysisDate ?? null });

  // ── Section 2: Monthly Rent Breakdown ───────────────────────────────────
  entries.push({ id: 'section_monthlyRent',   label: 'MONTHLY RENT BREAKDOWN',      kind: 'heading' });
  entries.push({ id: 'nnnMode',               label: 'NNN Mode',                    kind: 'text', format: 'text', value: isAggregate ? 'Aggregate' : 'Individual' });
  entries.push({ id: 'year1BaseRent',         label: 'Year 1 Monthly Base Rent',    kind: 'input', format: 'currency', value: assumptions.year1BaseRent });
  if (isAggregate) {
    entries.push({ id: 'nnnAgg_year1', label: 'NNN Combined Year 1 Monthly Amount', kind: 'input', format: 'currency', value: assumptions.nnnAggYear1 ?? 0 });
  }
  for (const category of activeCategories) {
    const catData = assumptions.categories[category.key] ?? { year1: 0 };
    entries.push({ id: `${category.key}_year1`, label: category.assumptionLabels.year1, kind: 'input', format: 'currency', value: catData.year1 });
  }

  // ── Section 3: Escalation Assumptions ───────────────────────────────────
  entries.push({ id: 'section_escalations',   label: 'ESCALATION ASSUMPTIONS',      kind: 'heading' });
  entries.push({ id: 'annualEscRate',         label: 'Annual Base Rent Escalation Rate (%)', kind: 'input', format: 'pct', value: assumptions.annualEscRate });
  entries.push({ id: 'anniversaryMonth',      label: 'Lease Anniversary Month',     kind: 'input', format: 'int', value: assumptions.anniversaryMonth });
  if (isAggregate) {
    entries.push({ id: 'nnnAgg_escRate', label: 'NNN Combined Annual Escalation Rate (%)', kind: 'input', format: 'pct', value: assumptions.nnnAggEscRate ?? 0 });
  }
  for (const category of activeCategories) {
    const catData = assumptions.categories[category.key] ?? { escRate: 0 };
    entries.push({ id: `${category.key}_escRate`, label: category.assumptionLabels.escRate, kind: 'input', format: 'pct', value: catData.escRate });
  }

  // ── Section 4: Abatement ────────────────────────────────────────────────
  entries.push({ id: 'section_abatement',       label: 'ABATEMENT',                  kind: 'heading' });
  entries.push({ id: 'abatementMonths',          label: 'Abatement Full-Month Count', kind: 'input', format: 'int', value: assumptions.fullAbatementMonths });
  entries.push({ id: 'abatementEndDate',         label: 'Abatement End Date',         kind: 'date', format: 'date', value: assumptions.abatementEndDate ?? null });
  entries.push({ id: 'abatementPct',             label: 'Abatement Percentage (%)',   kind: 'input', format: 'pct', value: (assumptions.abatementPct ?? 0) / 100 });
  entries.push({ id: 'abatementPartialFactor',   label: 'Abatement Partial-Month Proration Factor', kind: 'input', format: 'factor', value: assumptions.abatementPartialFactor });

  // ── Section 5: Free Rent ────────────────────────────────────────────────
  entries.push({ id: 'section_freeRent',    label: 'FREE RENT',          kind: 'heading' });
  entries.push({ id: 'freeRentMonths',      label: 'Free Rent Months',   kind: 'input', format: 'int', value: assumptions.freeRentMonths ?? 0 });
  entries.push({ id: 'freeRentEndDate',     label: 'Free Rent End Date', kind: 'date', format: 'date', value: assumptions.freeRentEndDate ?? null });

  // ── Section 6: Non-Recurring Charges ────────────────────────────────────
  entries.push({ id: 'section_nonRecurring', label: 'NON-RECURRING CHARGES', kind: 'heading' });
  const otItems = assumptions.oneTimeItems ?? [];
  if (otItems.length === 0) {
    entries.push({ id: 'ot_none', label: '(none)', kind: 'text', format: 'text', value: '' });
  } else {
    otItems.forEach((item, idx) => {
      entries.push({
        id:      `ot_${idx}`,
        label:   item.label || '',
        kind:    'ot_item',
        format:  'currency',
        value:   item.amount ?? 0,
        otDate:  item.date ?? null,
      });
    });
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
      rentCommencementDate: dateToISO(params.rentCommencementDate),
      effectiveAnalysisDate: dateToISO(params.effectiveAnalysisDate),
      year1BaseRent: 0,
      annualEscRate: 0,
      anniversaryMonth: 1,
      fullAbatementMonths: 0,
      abatementPartialFactor: 1,
      abatementEndDate: dateToISO(params.abatementEndDate),
      abatementPct: Number(params.abatementPct) || 0,
      freeRentMonths: Number(params.freeRentMonths) || 0,
      freeRentEndDate: dateToISO(params.freeRentEndDate),
      oneTimeItems: (params.oneTimeItems ?? []).map((i) => ({
        label: i.label ?? '', date: dateToISO(i.date), amount: Number(i.amount) || 0,
      })),
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
    rentCommencementDate: dateToISO(params.rentCommencementDate),
    effectiveAnalysisDate: dateToISO(params.effectiveAnalysisDate),
    year1BaseRent,
    annualEscRate,
    anniversaryMonth: 1,
    fullAbatementMonths,
    abatementPartialFactor,
    abatementEndDate: dateToISO(params.abatementEndDate),
    abatementPct: Number(params.abatementPct) || 0,
    freeRentMonths: Number(params.freeRentMonths) || 0,
    freeRentEndDate: dateToISO(params.freeRentEndDate),
    oneTimeItems: (params.oneTimeItems ?? []).map((i) => ({
      label: i.label ?? '', date: dateToISO(i.date), amount: Number(i.amount) || 0,
    })),
    categories: {},
  };

  if (isAggregate) {
    assumptions.nnnAggYear1 = Number(params.nnnAggregate?.year1) || 0;
    assumptions.nnnAggEscRate = (Number(params.nnnAggregate?.escPct) || 0) / 100;
  }

  for (const category of activeCategories) {
    // Prefer direct lookup from params.charges when available; fall back to
    // legacy keyed params for the static 5-category path.
    const chargeFromArray = Array.isArray(params.charges)
      ? params.charges.find((c) => c.key === category.key)
      : null;
    assumptions.categories[category.key] = chargeFromArray
      ? { year1: Number(chargeFromArray.year1) || 0, escRate: (Number(chargeFromArray.escPct) || 0) / 100 }
      : { year1: Number(params[category.paramKey]?.year1) || 0, escRate: (Number(params[category.paramKey]?.escPct) || 0) / 100 };
  }

  // Normalized charges array consumed by leaseScheduleSpec for column layout and
  // assumption block rendering. When params.charges is present, use it directly.
  // Otherwise derive from activeCategories for backward compat.
  if (Array.isArray(params.charges) && params.charges.length > 0) {
    assumptions.charges = params.charges
      .filter((c) => !(isAggregate && c.canonicalType === 'nnn'))
      .map((c) => ({
        key:          c.key,
        canonicalType: c.canonicalType,
        displayLabel:  c.displayLabel,
        year1:        Number(c.year1) || 0,
        escRate:      (Number(c.escPct) || 0) / 100,
      }));
  } else {
    assumptions.charges = activeCategories.map((cat) => ({
      key:           cat.key,
      canonicalType: cat.group === 'nnn' ? 'nnn' : 'other',
      displayLabel:  cat.displayLabel,
      year1:         Number(params[cat.paramKey]?.year1) || 0,
      escRate:       (Number(params[cat.paramKey]?.escPct) || 0) / 100,
    }));
  }

  return assumptions;
}
