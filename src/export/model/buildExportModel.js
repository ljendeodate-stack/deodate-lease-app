import { getActiveCategories, buildColumnLayout, colIndexToLetter } from '../../engine/chargeCategories.js';
import { INLINE_SCENARIO_COLUMNS } from '../derived/inlineScenarioColumns.js';

const NRC_SLOT_COUNT = 11;
const CONCESSION_SLOT_COUNT = 10;

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

function padNrcItems(items) {
  const result = items.slice(0, NRC_SLOT_COUNT).map((item) => ({
    label: item.label ?? '',
    date: item.date ?? null,
    amount: Number(item.amount) || 0,
  }));
  const usedLabels = new Set(result.map((item) => item.label));
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

function dateToISO(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized.length === 10 && normalized[4] === '-' && normalized[7] === '-') return normalized;
    const mdy = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdy) {
      const [, month, day, year] = mdy;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return null;
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function padConcessionItems(items, buildBlankItem) {
  const result = items.slice(0, CONCESSION_SLOT_COUNT);
  while (result.length < CONCESSION_SLOT_COUNT) {
    result.push(buildBlankItem(result.length));
  }
  return result;
}

function getLeaseMonthNumber(row, index = 0) {
  const monthNumber = Number(row?.leaseMonth ?? row?.['Month #'] ?? index + 1);
  return Number.isInteger(monthNumber) && monthNumber > 0 ? monthNumber : null;
}

function buildFreeRentConcessionRows(rows = []) {
  const concessionsByMonth = new Map();

  rows.forEach((row, index) => {
    if (row?.concessionScope !== 'monthly_row' || row?.concessionType !== 'free_rent') return;
    const monthNumber = getLeaseMonthNumber(row, index);
    if (!monthNumber || concessionsByMonth.has(monthNumber)) return;

    concessionsByMonth.set(monthNumber, {
      label: 'Free rent month',
      monthNumber,
      date: dateToISO(row.periodStart ?? row.date),
      amount: Number(row.scheduledBaseRent ?? 0),
    });
  });

  const items = Array.from(concessionsByMonth.values()).sort((left, right) => left.monthNumber - right.monthNumber);
  return padConcessionItems(items, () => ({
    label: 'Free rent month',
    monthNumber: null,
    date: null,
    amount: null,
  }));
}

function buildAbatementConcessionRows(rows = []) {
  const concessionsByMonth = new Map();

  rows.forEach((row, index) => {
    if (row?.concessionScope !== 'monthly_row' || row?.concessionType !== 'abatement') return;
    const monthNumber = getLeaseMonthNumber(row, index);
    if (!monthNumber || concessionsByMonth.has(monthNumber)) return;

    const scheduledBaseRent = Number(row.scheduledBaseRent ?? 0);
    const derivedPct = row?.concessionValueMode === 'percent'
      ? Number(row.concessionValue ?? 0)
      : (scheduledBaseRent > 0 ? ((Number(row.abatementAmount ?? 0) / scheduledBaseRent) * 100) : 0);

    concessionsByMonth.set(monthNumber, {
      label: 'Abatement month',
      monthNumber,
      date: dateToISO(row.periodStart ?? row.date),
      amount: Number(row.abatementAmount ?? 0),
      pct: Number.isFinite(derivedPct) ? derivedPct / 100 : 0,
    });
  });

  const items = Array.from(concessionsByMonth.values()).sort((left, right) => left.monthNumber - right.monthNumber);
  return padConcessionItems(items, () => ({
    label: 'Abatement month',
    monthNumber: null,
    date: null,
    amount: null,
    pct: null,
  }));
}

function getConcessionRows(rows = [], type) {
  return rows
    .filter((row) => row?.concessionScope === 'monthly_row' && row?.concessionType === type)
    .slice()
    .sort((left, right) => {
      const leftMonth = getLeaseMonthNumber(left, 0) ?? Number.MAX_SAFE_INTEGER;
      const rightMonth = getLeaseMonthNumber(right, 0) ?? Number.MAX_SAFE_INTEGER;
      return leftMonth - rightMonth;
    });
}

function deriveFreeRentSummary(rows = []) {
  const freeRentRows = getConcessionRows(rows, 'free_rent');
  if (freeRentRows.length === 0) {
    return {
      freeRentStart: null,
      freeRentEndDate: null,
      freeRentPct: 0,
      freeRentMonths: 0,
    };
  }

  const firstRow = freeRentRows[0];
  const lastRow = freeRentRows[freeRentRows.length - 1];
  const explicitPctRow = freeRentRows.find((row) => row?.concessionValueMode === 'percent' && Number.isFinite(Number(row?.concessionValue)));
  const freeRentPct = explicitPctRow
    ? Number(explicitPctRow.concessionValue) / 100
    : 1;

  return {
    freeRentStart: firstRow.periodStart ?? firstRow.date ?? null,
    freeRentEndDate: lastRow.periodEnd ?? lastRow.periodStart ?? lastRow.date ?? null,
    freeRentPct,
    freeRentMonths: freeRentRows.length,
  };
}

function deriveAbatementSummary(rows = []) {
  const abatementRows = getConcessionRows(rows, 'abatement');
  if (abatementRows.length === 0) {
    return {
      abatementStart: null,
      abatementEndDate: null,
      abatementPct: 0,
      abatementAmount: 0,
    };
  }

  const firstRow = abatementRows[0];
  const lastRow = abatementRows[abatementRows.length - 1];
  const explicitPctRow = abatementRows.find((row) => row?.concessionValueMode === 'percent' && Number.isFinite(Number(row?.concessionValue)));
  const abatementAmount = Number(firstRow.abatementAmount ?? 0) || 0;
  const derivedPct = explicitPctRow
    ? Number(explicitPctRow.concessionValue) / 100
    : (
        Number(firstRow.scheduledBaseRent ?? 0) > 0
          ? abatementAmount / Number(firstRow.scheduledBaseRent)
          : 0
      );

  return {
    abatementStart: firstRow.periodStart ?? firstRow.date ?? null,
    abatementEndDate: lastRow.periodEnd ?? lastRow.periodStart ?? lastRow.date ?? null,
    abatementPct: derivedPct,
    abatementAmount,
  };
}

export function buildExportModel(rows, params = {}, filename = 'lease-schedule') {
  const nnnMode = params.nnnMode ?? 'individual';
  const activeCategories = getActiveCategories(rows, params, nnnMode);
  const assumptions = computeAssumptions(rows, params, activeCategories);
  const otLabels = deriveOneTimeLabels(rows);
  const baseColumns = buildColumnLayout(activeCategories, otLabels, nnnMode);
  const columns = [
    ...baseColumns,
    ...INLINE_SCENARIO_COLUMNS.map((column, offset) => {
      const index = baseColumns.length + offset;
      return {
        ...column,
        index,
        letter: colIndexToLetter(index),
      };
    }),
  ];
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
  const entries = [];
  const isAggregate = assumptions.nnnMode === 'aggregate';

  entries.push({ id: 'section_leaseDrivers', label: 'LEASE DRIVERS', kind: 'heading' });
  entries.push({ id: 'leaseName', label: 'Lease Name', kind: 'text', format: 'text', value: assumptions.leaseName || '' });
  entries.push({ id: 'squareFootage', label: 'Rentable SF', kind: 'input', format: 'int', value: assumptions.squareFootage });
  entries.push({ id: 'commencementDate', label: 'Lease Commencement Date', kind: 'date', format: 'date', value: assumptions.commencementDate });
  entries.push({ id: 'expirationDate', label: 'Lease Expiration Date', kind: 'date', format: 'date', value: assumptions.expirationDate });
  entries.push({ id: 'rentCommencementDate', label: 'Rent Commencement Date', kind: 'date', format: 'date', value: assumptions.rentCommencementDate ?? null });
  entries.push({ id: 'effectiveAnalysisDate', label: 'Effective Analysis Date', kind: 'date', format: 'date', value: assumptions.effectiveAnalysisDate ?? null });
  entries.push({
    id: 'totalLeaseTerm',
    label: 'Total Lease Term (Months)',
    kind: 'computed',
    format: 'int',
    value: assumptions.totalLeaseTerm ?? 0,
    formulaFn: (cellMap) =>
      `IF(AND(${cellMap.commencementDate}<>"",${cellMap.expirationDate}<>""),DATEDIF(${cellMap.commencementDate},${cellMap.expirationDate},"M")+1,0)`,
  });
  entries.push({
    id: 'effectiveMonth',
    label: 'Effective Month',
    kind: 'computed',
    format: 'int',
    value: assumptions.effectiveMonth ?? 0,
    formulaFn: (cellMap, layout) => {
      if (!layout?.colByKey?.periodStart) return '0';
      const col = layout.colByKey.periodStart.letter;
      return `IFERROR(MATCH(${cellMap.effectiveAnalysisDate},${col}${layout.firstDataRow}:${col}${layout.lastDataRow},1),0)`;
    },
  });
  entries.push({
    id: 'monthsRemaining',
    label: 'Months Remaining',
    kind: 'computed',
    format: 'int',
    value: assumptions.monthsRemaining ?? 0,
    formulaFn: (cellMap) => `MAX(0,${cellMap.totalLeaseTerm}-${cellMap.effectiveMonth})`,
  });
  entries.push({
    id: 'monthsUntilNextEsc',
    label: 'Months Until Next Base Rent Escalation',
    kind: 'computed',
    format: 'int',
    value: assumptions.monthsUntilNextEsc ?? 12,
    formulaFn: (cellMap) => `IF(${cellMap.effectiveMonth}=0,12,12-MOD(${cellMap.effectiveMonth}-1,12))`,
  });

  entries.push({ id: 'section_monthlyRent', label: 'MONTHLY RENT BREAKDOWN', kind: 'heading' });
  entries.push({ id: 'nnnMode', label: 'NNN Mode', kind: 'text', format: 'text', value: isAggregate ? 'Aggregate' : 'Individual' });
  entries.push({ id: 'year1BaseRent', label: 'Year 1 Monthly Base Rent', kind: 'input', format: 'currency', value: assumptions.year1BaseRent });
  if (isAggregate) {
    entries.push({ id: 'nnnAgg_year1', label: 'NNN Combined Year 1 Monthly Amount', kind: 'input', format: 'currency', value: assumptions.nnnAggYear1 ?? 0 });
  }
  for (const category of activeCategories) {
    const catData = assumptions.categories[category.key] ?? { year1: 0 };
    entries.push({ id: `${category.key}_year1`, label: category.assumptionLabels.year1, kind: 'input', format: 'currency', value: catData.year1 });
  }

  entries.push({ id: 'section_escalations', label: 'ESCALATION ASSUMPTIONS', kind: 'heading' });
  entries.push({ id: 'annualEscRate', label: 'Annual Base Rent Escalation Rate (%)', kind: 'input', format: 'pct', value: assumptions.annualEscRate });
  entries.push({ id: 'anniversaryMonth', label: 'Lease Anniversary Month', kind: 'input', format: 'int', value: assumptions.anniversaryMonth });
  if (isAggregate) {
    entries.push({ id: 'nnnAgg_escRate', label: 'NNN Combined Annual Escalation Rate (%)', kind: 'input', format: 'pct', value: assumptions.nnnAggEscRate ?? 0 });
  }
  for (const category of activeCategories) {
    const catData = assumptions.categories[category.key] ?? { escRate: 0 };
    entries.push({ id: `${category.key}_escRate`, label: category.assumptionLabels.escRate, kind: 'input', format: 'pct', value: catData.escRate });
  }

  entries.push({ id: 'section_nonRecurring', label: 'NON-RECURRING CHARGES', kind: 'heading' });
  for (const [index, item] of (assumptions.oneTimeItems ?? []).entries()) {
    entries.push({
      id: `ot_${index}`,
      label: item.label || '',
      kind: 'ot_item',
      format: 'currency',
      value: item.amount ?? 0,
      otDate: item.date ?? null,
    });
  }

  return entries;
}

function computeAssumptions(rows, params, activeCategories) {
  const nnnMode = params.nnnMode ?? 'individual';
  const isAggregate = nnnMode === 'aggregate';

  if (!rows || rows.length === 0) {
    const rawOt = (params.oneTimeItems ?? []).map((item) => ({
      label: item.label ?? '',
      date: dateToISO(item.date),
      amount: Number(item.amount) || 0,
    }));
    const empty = {
      leaseName: params.leaseName || '',
      nnnMode,
      squareFootage: 0,
      commencementDate: null,
      expirationDate: null,
      rentCommencementDate: dateToISO(params.rentCommencementDate) ?? null,
      effectiveAnalysisDate: dateToISO(params.effectiveAnalysisDate) ?? null,
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
      abatementEndDate: dateToISO(params.abatementEndDate) ?? null,
      abatementPct: (Number(params.abatementPct) || 0) / 100,
      abatementAmount: 0,
      freeRentStart: dateToISO(params.freeRentStart) ?? null,
      freeRentEndDate: dateToISO(params.freeRentEndDate) ?? null,
      freeRentPct: 0,
      freeRentMonths: 0,
      freeRentConcessions: padConcessionItems([], () => ({
        label: 'Free rent month',
        monthNumber: null,
        date: null,
        amount: null,
      })),
      abatementConcessions: padConcessionItems([], () => ({
        label: 'Abatement month',
        monthNumber: null,
        date: null,
        amount: null,
        pct: null,
      })),
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

  const fullAbatementMonths = rows.filter((row) =>
    (row.abatementAmount ?? 0) > 0 && (row.baseRentApplied ?? 0) === 0
  ).length;
  const boundaryRow = rows.find((row) =>
    row.prorationBasis === 'abatement-boundary' || row.prorationBasis === 'concession-boundary'
  );
  const abatementPartialFactor = boundaryRow
    ? (boundaryRow.baseRentProrationFactor ?? 1)
    : 1;

  const totalLeaseTerm = rows.length;
  let effectiveMonth = 0;
  const effDateISO = dateToISO(params.effectiveAnalysisDate);
  if (effDateISO) {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if ((rows[index].periodStart ?? '') <= effDateISO) {
        effectiveMonth = rows[index].leaseMonth ?? rows[index]['Month #'] ?? (index + 1);
        break;
      }
    }
  }
  const monthsRemaining = Math.max(0, totalLeaseTerm - effectiveMonth);
  const monthsUntilNextEsc = effectiveMonth > 0 ? 12 - ((effectiveMonth - 1) % 12) : 12;

  const rawOt = (params.oneTimeItems ?? []).map((item) => ({
    label: item.label ?? '',
    date: dateToISO(item.date),
    amount: Number(item.amount) || 0,
  }));
  const freeRentSummary = deriveFreeRentSummary(rows);
  const abatementSummary = deriveAbatementSummary(rows);

  const assumptions = {
    leaseName: String(params.leaseName || ''),
    nnnMode,
    squareFootage: Number(params.squareFootage) || 0,
    commencementDate: firstRow.periodStart ?? null,
    expirationDate: lastRow.periodEnd ?? null,
    rentCommencementDate: dateToISO(params.rentCommencementDate) ?? (firstRow.periodStart ?? null),
    effectiveAnalysisDate: dateToISO(params.effectiveAnalysisDate) ?? (firstRow.periodStart ?? null),
    totalLeaseTerm,
    effectiveMonth,
    monthsRemaining,
    monthsUntilNextEsc,
    year1BaseRent,
    annualEscRate,
    anniversaryMonth: 1,
    fullAbatementMonths,
    abatementPartialFactor,
    abatementStart: dateToISO(params.abatementStart) ?? abatementSummary.abatementStart,
    abatementEndDate: dateToISO(params.abatementEndDate) ?? abatementSummary.abatementEndDate,
    abatementPct: Number(params.abatementPct)
      ? (Number(params.abatementPct) || 0) / 100
      : abatementSummary.abatementPct,
    abatementAmount: abatementSummary.abatementAmount,
    freeRentStart: dateToISO(params.freeRentStart) ?? freeRentSummary.freeRentStart,
    freeRentEndDate: dateToISO(params.freeRentEndDate) ?? freeRentSummary.freeRentEndDate,
    freeRentPct: freeRentSummary.freeRentPct,
    freeRentMonths: freeRentSummary.freeRentMonths,
    freeRentConcessions: buildFreeRentConcessionRows(rows),
    abatementConcessions: buildAbatementConcessionRows(rows),
    oneTimeItems: padNrcItems(rawOt),
    categories: {},
  };

  if (isAggregate) {
    assumptions.nnnAggYear1 = Number(params.nnnAggregate?.year1) || 0;
    assumptions.nnnAggEscRate = (Number(params.nnnAggregate?.escPct) || 0) / 100;
  }

  for (const category of activeCategories) {
    const chargeFromArray = Array.isArray(params.charges)
      ? params.charges.find((charge) => charge.key === category.key)
      : null;
    assumptions.categories[category.key] = chargeFromArray
      ? { year1: Number(chargeFromArray.year1) || 0, escRate: (Number(chargeFromArray.escPct) || 0) / 100 }
      : { year1: Number(params[category.paramKey]?.year1) || 0, escRate: (Number(params[category.paramKey]?.escPct) || 0) / 100 };
  }

  if (Array.isArray(params.charges) && params.charges.length > 0) {
    assumptions.charges = params.charges
      .filter((charge) => !(isAggregate && charge.canonicalType === 'nnn'))
      .map((charge) => ({
        key: charge.key,
        canonicalType: charge.canonicalType,
        displayLabel: charge.displayLabel,
        year1: Number(charge.year1) || 0,
        escRate: (Number(charge.escPct) || 0) / 100,
      }));
  } else {
    assumptions.charges = activeCategories.map((category) => ({
      key: category.key,
      canonicalType: category.group === 'nnn' ? 'nnn' : 'other',
      displayLabel: category.displayLabel,
      year1: Number(params[category.paramKey]?.year1) || 0,
      escRate: (Number(params[category.paramKey]?.escPct) || 0) / 100,
    }));
  }

  return assumptions;
}
