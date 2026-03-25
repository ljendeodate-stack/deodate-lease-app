import { getActiveCategories, buildColumnLayout } from '../../engine/chargeCategories.js';

/** Number of NRC input slots always emitted in the assumptions block. */
const NRC_SLOT_COUNT = 11;

/** Default NRC labels for empty slots — user can overwrite in the workbook. */
const DEFAULT_NRC_LABELS = [
  'Tenant Improvement Allowance',
  'Landlord Work',
  'Leasing Commission',
  'HVAC Upgrade',
  'After-Hours HVAC',
  'Roof Curb Installation',
  'Parking',
  'Moving Allowance',
  'Signage',
  'Additional NRC 1',
  'Additional NRC 2',
];

/** Pad oneTimeItems to exactly NRC_SLOT_COUNT entries. */
function padNrcItems(items) {
  const result = items.slice(0, NRC_SLOT_COUNT).map((i) => ({
    label: i.label ?? '',
    date: i.date ?? null,
    amount: Number(i.amount) || 0,
  }));
  const usedLabels = new Set(result.map((i) => i.label));
  for (const defaultLabel of DEFAULT_NRC_LABELS) {
    if (result.length >= NRC_SLOT_COUNT) break;
    if (!usedLabels.has(defaultLabel)) {
      result.push({ label: defaultLabel, date: null, amount: 0 });
    }
  }
  while (result.length < NRC_SLOT_COUNT) {
    result.push({ label: `NRC Item ${result.length + 1}`, date: null, amount: 0 });
  }
  return result;
}

/** First day of the current month as ISO string (YYYY-MM-DD). */
function currentMonthFirstDayISO() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
}

/** Convert a Date object, ISO string (YYYY-MM-DD), or MM/DD/YYYY string to YYYY-MM-DD, or return null. */
function dateToISO(d) {
  if (!d) return null;
  if (typeof d === 'string') {
    const s = d.trim();
    // Validate YYYY-MM-DD by checking dash positions (avoids false-positive on MM/DD/YYYY)
    if (s.length === 10 && s[4] === '-' && s[7] === '-') return s;
    // Accept MM/DD/YYYY or M/D/YYYY and normalise to ISO
    const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdy) {
      const [, m, day, yr] = mdy;
      return `${yr}-${m.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return null;
  }
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
 *   Section 1 — LEASE DRIVERS          (11 entries: heading + 6 fields + 4 computed)
 *   Section 2 — MONTHLY RENT BREAKDOWN (5 entries: heading + mode + year1BaseRent + [nnnAgg?] + per-category year1)
 *   Section 3 — ESCALATION ASSUMPTIONS (5 entries: heading + annualEscRate + anniversaryMonth + [nnnAgg?] + per-category escRate)
 *   Section 4 — ABATEMENT              (8 entries: heading + 7 fields)
 *   Section 5 — FREE RENT              (6 entries: heading + 5 fields)
 *   Section 6 — NON-RECURRING CHARGES  (1 heading + max(M, 1) items or "(none)")
 *
 * Formula cells (referenced by buildDataSection via cellMap):
 *   squareFootage          → always index 2  → row 7
 *   totalLeaseTerm         → always index 7  → row 12   (NEW: Section 1 computed)
 *   effectiveMonth         → always index 8  → row 13   (NEW: Section 1 computed)
 *   monthsRemaining        → always index 9  → row 14   (NEW: Section 1 computed)
 *   monthsUntilNextEsc     → always index 10 → row 15   (NEW: Section 1 computed)
 *   year1BaseRent          → always index 13 → row 18
 *   annualEscRate          → always index 17 → row 22
 *   abatementMonths        → always index 25 → row 30
 *   abatementPartialFactor → always index 27 → row 32
 *   {key}_year1     → index 14 + catIdx (individual) or 14 + nnnAggOffset + catIdx
 *   {key}_escRate   → index 19 + catIdx (individual) or 19 + nnnAggOffset + catIdx
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
  // Dependent/display fields — computed from the editable inputs above
  entries.push({
    id: 'totalLeaseTerm', label: 'Total Lease Term (Months)', kind: 'computed', format: 'int',
    value: assumptions.totalLeaseTerm ?? 0,
    formulaFn: (cellMap) =>
      `IF(AND(${cellMap.commencementDate}<>"",${cellMap.expirationDate}<>""),DATEDIF(${cellMap.commencementDate},${cellMap.expirationDate},"M")+1,0)`,
  });
  entries.push({
    id: 'effectiveMonth', label: 'Effective Month', kind: 'computed', format: 'int',
    value: assumptions.effectiveMonth ?? 0,
    formulaFn: (cellMap, layout) => {
      if (!layout?.colByKey?.periodStart) return '0';
      const col = layout.colByKey.periodStart.letter;
      return `IFERROR(MATCH(${cellMap.effectiveAnalysisDate},${col}${layout.firstDataRow}:${col}${layout.lastDataRow},1),0)`;
    },
  });
  entries.push({
    id: 'monthsRemaining', label: 'Months Remaining', kind: 'computed', format: 'int',
    value: assumptions.monthsRemaining ?? 0,
    formulaFn: (cellMap) => `MAX(0,${cellMap.totalLeaseTerm}-${cellMap.effectiveMonth})`,
  });
  entries.push({
    id: 'monthsUntilNextEsc', label: 'Months Until Next Base Rent Escalation', kind: 'computed', format: 'int',
    value: assumptions.monthsUntilNextEsc ?? 12,
    formulaFn: (cellMap) =>
      `IF(${cellMap.effectiveMonth}=0,12,12-MOD(${cellMap.effectiveMonth}-1,12))`,
  });

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
  entries.push({ id: 'section_abatement',         label: 'ABATEMENT',                                kind: 'heading' });
  entries.push({ id: 'abatementStart',             label: 'Abatement Start Date',                    kind: 'date',     format: 'date',     value: assumptions.abatementStart ?? null });
  entries.push({ id: 'abatementEnd',               label: 'Abatement End Date',                      kind: 'date',     format: 'date',     value: assumptions.abatementEndDate ?? null });
  entries.push({ id: 'abatementAmount',            label: 'Abatement Amount (Monthly, $)',            kind: 'input',    format: 'currency', value: assumptions.abatementAmount });
  entries.push({
    id: 'abatementMonths', label: 'Abatement Duration (months)', kind: 'computed', format: 'int', value: assumptions.fullAbatementMonths,
    formulaFn: (cellMap) => `IF(AND(${cellMap.abatementStart}<>"",${cellMap.abatementEnd}<>""),DATEDIF(${cellMap.abatementStart},${cellMap.abatementEnd},"M")+1,0)`,
  });
  entries.push({
    id: 'abatementPct', label: 'Abatement % of Full Rent', kind: 'computed', format: 'pct', value: (assumptions.abatementPct ?? 0) / 100,
    formulaFn: (cellMap) => `IF(${cellMap.year1BaseRent}=0,0,${cellMap.abatementAmount}/${cellMap.year1BaseRent})`,
  });
  entries.push({ id: 'abatementPartialFactor',     label: 'Abatement Partial-Month Proration Factor',                                kind: 'input', format: 'factor', value: assumptions.abatementPartialFactor });
  entries.push({ id: 'additionalAbatementFlag',    label: 'Additional abatement later in lease? (If yes, hardcode schedule values)', kind: 'text',  format: 'text',   value: assumptions.additionalAbatementFlag });

  // ── Section 5: Free Rent ────────────────────────────────────────────────
  entries.push({ id: 'section_freeRent',        label: 'FREE RENT',                                                                  kind: 'heading' });
  entries.push({ id: 'freeRentStart',           label: 'Free Rent Start Date',                                                       kind: 'date',    format: 'date',    value: assumptions.freeRentStart ?? null });
  entries.push({ id: 'freeRentEnd',             label: 'Free Rent End Date',                                                         kind: 'date',    format: 'date',    value: assumptions.freeRentEndDate ?? null });
  entries.push({
    id: 'freeRentMonths', label: 'Free Rent Duration (months)', kind: 'computed', format: 'int', value: assumptions.freeRentMonths ?? 0,
    formulaFn: (cellMap) => `IF(AND(${cellMap.freeRentStart}<>"",${cellMap.freeRentEnd}<>""),DATEDIF(${cellMap.freeRentStart},${cellMap.freeRentEnd},"M")+1,0)`,
  });
  entries.push({ id: 'freeRentPct',            label: 'Free Rent Assumption',                                                        kind: 'text',    format: 'text',    value: '100%' });
  entries.push({ id: 'additionalFreeRentFlag', label: 'Additional free rent later in lease? (If yes, hardcode schedule values)',      kind: 'text',    format: 'text',    value: assumptions.additionalFreeRentFlag });

  // ── Section 6: Non-Recurring Charges (always 11 slots) ──────────────────
  entries.push({ id: 'section_nonRecurring', label: 'NON-RECURRING CHARGES', kind: 'heading' });
  const otItems = assumptions.oneTimeItems ?? [];
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

  return entries;
}

function computeAssumptions(rows, params, activeCategories) {
  const nnnMode = params.nnnMode ?? 'individual';
  const isAggregate = nnnMode === 'aggregate';

  if (!rows || rows.length === 0) {
    const rawOt = (params.oneTimeItems ?? []).map((i) => ({
      label: i.label ?? '', date: dateToISO(i.date), amount: Number(i.amount) || 0,
    }));
    const empty = {
      leaseName: params.leaseName || '',
      nnnMode,
      squareFootage: 0,
      commencementDate: null,
      expirationDate: null,
      rentCommencementDate: dateToISO(params.rentCommencementDate) ?? null,
      effectiveAnalysisDate: dateToISO(params.effectiveAnalysisDate) ?? currentMonthFirstDayISO(),
      totalLeaseTerm: 0,
      effectiveMonth: 0,
      monthsRemaining: 0,
      monthsUntilNextEsc: 12,
      year1BaseRent: 0,
      annualEscRate: 0,
      anniversaryMonth: 1,
      fullAbatementMonths: 0,
      abatementPartialFactor: 1,
      abatementStart: dateToISO(params.abatementStart) ?? null,
      abatementEndDate: dateToISO(params.abatementEndDate),
      abatementAmount: Number(params.abatementAmount) || 0,
      abatementPct: Number(params.abatementPct) || 0,
      additionalAbatementFlag: params.additionalAbatementFlag ?? 'No',
      freeRentMonths: Number(params.freeRentMonths) || 0,
      freeRentStart: dateToISO(params.freeRentStart) ?? null,
      freeRentEndDate: dateToISO(params.freeRentEndDate),
      additionalFreeRentFlag: params.additionalFreeRentFlag ?? 'No',
      oneTimeItems: padNrcItems(rawOt),
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

  // Derived Lease Driver computed fields
  const totalLeaseTerm = rows.length;
  let effectiveMonth = 0;
  const effDateISO = dateToISO(params.effectiveAnalysisDate);
  if (effDateISO) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if ((rows[i].periodStart ?? '') <= effDateISO) {
        effectiveMonth = rows[i].leaseMonth ?? rows[i]['Month #'] ?? (i + 1);
        break;
      }
    }
  }
  const monthsRemaining = Math.max(0, totalLeaseTerm - effectiveMonth);
  const monthsUntilNextEsc = effectiveMonth > 0 ? 12 - ((effectiveMonth - 1) % 12) : 12;

  const commencementDate = firstRow.periodStart ?? null;
  const rawOt = (params.oneTimeItems ?? []).map((i) => ({
    label: i.label ?? '', date: dateToISO(i.date), amount: Number(i.amount) || 0,
  }));

  const assumptions = {
    leaseName: String(params.leaseName || ''),
    nnnMode,
    squareFootage: Number(params.squareFootage) || 0,
    commencementDate,
    expirationDate: lastRow.periodEnd ?? null,
    // Spec §10: default rentCommencementDate to commencementDate
    rentCommencementDate: dateToISO(params.rentCommencementDate) ?? commencementDate,
    // Spec §7: default analysisDate to first of current month
    effectiveAnalysisDate: dateToISO(params.effectiveAnalysisDate) ?? currentMonthFirstDayISO(),
    totalLeaseTerm,
    effectiveMonth,
    monthsRemaining,
    monthsUntilNextEsc,
    year1BaseRent,
    annualEscRate,
    anniversaryMonth: 1,
    fullAbatementMonths,
    abatementPartialFactor,
    abatementStart: dateToISO(params.abatementStart) ?? null,
    abatementEndDate: dateToISO(params.abatementEndDate),
    abatementAmount: Number(params.abatementAmount) || 0,
    abatementPct: Number(params.abatementPct) || 0,
    additionalAbatementFlag: params.additionalAbatementFlag ?? 'No',
    freeRentMonths: Number(params.freeRentMonths) || 0,
    freeRentStart: dateToISO(params.freeRentStart) ?? null,
    freeRentEndDate: dateToISO(params.freeRentEndDate),
    additionalFreeRentFlag: params.additionalFreeRentFlag ?? 'No',
    // Spec §6.1: always emit exactly 11 NRC slots
    oneTimeItems: padNrcItems(rawOt),
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
