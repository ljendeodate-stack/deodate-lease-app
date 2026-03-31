/**
 * @fileoverview Core lease obligation calculation engine.
 */

import {
  parseISODate,
  addMonthsAnchored,
  daysBetweenInclusive,
  toISOLocal,
  parseMDYStrict,
} from './yearMonth.js';
import {
  CONCESSION_SCOPES,
  CONCESSION_TYPES,
  CONCESSION_VALUE_MODES,
  RECURRING_OVERRIDE_TARGETS,
  resolveMonthlyRowIndex,
} from './leaseTerms.js';

function parseLooseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = parseISODate(value);
    if (!parsed) return null;
    const [year, month, day] = value.split('-').map(Number);
    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      return null;
    }
    return parsed;
  }
  return parseMDYStrict(value);
}

function yearsSinceStart(rowDate, startDate) {
  if (!startDate) return null;
  if (rowDate < startDate) return 0;
  const rowY = rowDate.getFullYear();
  const rowM = rowDate.getMonth();
  const startY = startDate.getFullYear();
  const startM = startDate.getMonth();
  const monthDiff = (rowY * 12 + rowM) - (startY * 12 + startM);
  return Math.floor(monthDiff / 12);
}

function isChargeActive(rowDate, chargeStartDate) {
  if (!chargeStartDate) return true;
  if (!rowDate) return false;
  return rowDate.getTime() >= chargeStartDate.getTime();
}

function computePeriodFactor(rowIndex, totalRows, periodStart, periodEnd) {
  const isLast = rowIndex === totalRows - 1;
  if (!isLast || !periodStart || !periodEnd) {
    return { factor: 1, actualDays: 1, calMonthDays: 1 };
  }

  const nextAnchor = addMonthsAnchored(periodStart, 1);
  const naturalEnd = new Date(nextAnchor.getTime() - 86400000);
  naturalEnd.setHours(0, 0, 0, 0);

  if (periodEnd.getTime() >= naturalEnd.getTime()) {
    return { factor: 1, actualDays: 1, calMonthDays: 1 };
  }

  const calMonthStart = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1);
  const calMonthEnd = new Date(periodEnd.getFullYear(), periodEnd.getMonth() + 1, 0);
  const calMonthDays = daysBetweenInclusive(calMonthStart, calMonthEnd);
  const actualDays = daysBetweenInclusive(periodStart, periodEnd);
  if (calMonthDays <= 0) return { factor: 0, actualDays: 0, calMonthDays: 0 };
  return { factor: actualDays / calMonthDays, actualDays, calMonthDays };
}

function computeChargeAmount(year1, escRate, escYears, leaseYear, periodFactor) {
  const exponent = escYears !== null ? escYears : leaseYear - 1;
  return year1 * Math.pow(1 + escRate, exponent) * periodFactor;
}

function getRowBounds(rows, index) {
  const row = rows[index];
  const periodStart = parseISODate(row.date ?? row.periodStart);
  let periodEnd = null;

  if (index < rows.length - 1) {
    const nextDate = parseISODate(rows[index + 1].date ?? rows[index + 1].periodStart);
    if (nextDate) {
      periodEnd = new Date(nextDate.getTime() - 86400000);
      periodEnd.setHours(0, 0, 0, 0);
    }
  } else if (row.periodEnd) {
    periodEnd = parseISODate(row.periodEnd);
  }

  if (!periodEnd && periodStart) {
    periodEnd = new Date(addMonthsAnchored(periodStart, 1).getTime() - 86400000);
    periodEnd.setHours(0, 0, 0, 0);
  }

  return { periodStart, periodEnd };
}

function clampPercent(value) {
  return Math.min(Math.max(Number(value) || 0, 0), 100);
}

function buildLegacyWindowConcessions(params, rows) {
  const explicitLegacyEvents = Array.isArray(params.concessionEvents)
    ? params.concessionEvents.filter((event) => event?.scope === CONCESSION_SCOPES.LEGACY_WINDOW)
    : [];
  if (explicitLegacyEvents.length > 0) return explicitLegacyEvents;

  const endDate = parseLooseDate(params.abatementEndDate);
  const pct = clampPercent(params.abatementPct);
  if (!endDate || pct <= 0 || rows.length === 0) return [];

  const leaseStart = parseISODate(rows[0].date ?? rows[0].periodStart);
  if (!leaseStart) return [];

  return [{
    id: 'legacy_helper_abatement',
    type: pct === 100 ? CONCESSION_TYPES.FREE_RENT : CONCESSION_TYPES.ABATEMENT,
    scope: CONCESSION_SCOPES.LEGACY_WINDOW,
    startDate: leaseStart,
    endDate,
    valueMode: CONCESSION_VALUE_MODES.PERCENT,
    value: pct,
    source: 'legacy',
    confidence: 'high',
    label: pct === 100 ? 'Legacy Free Rent Window' : 'Legacy Abatement Window',
    assumptionNote: 'Legacy contiguous concession preserved for backward compatibility.',
    rawText: '',
  }];
}

function normalizeConcessionEngineState(rows, params) {
  const events = Array.isArray(params.concessionEvents) ? params.concessionEvents : [];
  const explicitMap = new Map();

  for (const event of events) {
    if (event?.scope !== CONCESSION_SCOPES.MONTHLY_ROW) continue;
    const effectiveDate = parseLooseDate(event.effectiveDate ?? event.date);
    const rowIndex = resolveMonthlyRowIndex(rows, effectiveDate);
    if (rowIndex >= 0 && !explicitMap.has(rowIndex)) {
      explicitMap.set(rowIndex, { ...event, effectiveDate });
    }
  }

  return {
    explicitMap,
    legacyWindows: buildLegacyWindowConcessions(params, rows),
  };
}

function normalizeRecurringOverrideState(rows, params) {
  const byRow = new Map();
  const overrides = Array.isArray(params.recurringOverrides) ? params.recurringOverrides : [];

  for (const override of overrides) {
    const effectiveDate = parseLooseDate(override?.effectiveDate ?? override?.date);
    const rowIndex = resolveMonthlyRowIndex(rows, effectiveDate);
    if (rowIndex < 0) continue;

    const normalized = {
      ...override,
      targetKey: String(override?.targetKey || RECURRING_OVERRIDE_TARGETS.BASE_RENT),
      effectiveDate,
      amount: Number(override?.amount) || 0,
    };

    if (!byRow.has(rowIndex)) byRow.set(rowIndex, []);
    byRow.get(rowIndex).push(normalized);
  }

  for (const rowOverrides of byRow.values()) {
    rowOverrides.sort((a, b) => {
      const left = a.effectiveDate?.getTime?.() ?? 0;
      const right = b.effectiveDate?.getTime?.() ?? 0;
      return left - right;
    });
  }

  return { byRow };
}

function resolveActiveRecurringOverridesForRow(recurringOverrideState, rowIndex, activeOverrides) {
  const rowOverrides = recurringOverrideState.byRow.get(rowIndex) ?? [];
  for (const override of rowOverrides) {
    activeOverrides.set(override.targetKey, override);
  }
  return activeOverrides;
}

function computeRecurringOverrideAmount(override, periodFactor) {
  return Number(((Number(override?.amount) || 0) * periodFactor).toFixed(2));
}

function roundCurrency(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function currencyClose(a, b, tolerance = 0.01) {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) <= tolerance;
}

function expectedAnnualBaseRentForRow(row, year1BaseRent, annualEscRate) {
  const leaseYear = Number(row?.leaseYear ?? row?.['Year #'] ?? 0);
  if (!leaseYear) return 0;
  return roundCurrency(
    (Number(year1BaseRent) || 0) * Math.pow(1 + (Number(annualEscRate) || 0), leaseYear - 1),
  );
}

function inferAnnualBaseEscRate(rows) {
  const year1BaseRent = Number(rows?.[0]?.scheduledBaseRent ?? 0);
  if (year1BaseRent <= 0) {
    return { year1BaseRent, annualEscRate: 0 };
  }

  const year2Row = rows.find((candidate) =>
    (candidate?.leaseYear ?? candidate?.['Year #']) === 2 && !candidate?.baseRentOverrideApplied,
  );

  let annualEscRate = 0;
  if (year2Row) {
    annualEscRate = (Number(year2Row.scheduledBaseRent ?? 0) / year1BaseRent) - 1;
  }

  return { year1BaseRent, annualEscRate };
}

function applyExplicitConcession(event, scheduledBaseRent, periodFactor) {
  const periodAdjustedBaseRent = scheduledBaseRent * periodFactor;
  if (!event) {
    return {
      appliedBaseRent: periodAdjustedBaseRent,
      abatementAmount: 0,
      baseFactor: periodFactor,
      prorationBasis: periodFactor < 1 ? 'final-month' : 'full',
      isConcessionRow: false,
      abatementDays: 0,
      fullRentDays: 0,
      totalDays: 0,
      concessionEventId: null,
      concessionType: null,
      concessionScope: null,
      concessionValueMode: null,
      concessionValue: null,
      concessionTriggerDate: null,
      concessionStartDate: null,
      concessionEndDate: null,
      concessionSource: null,
      concessionConfidence: null,
      concessionLabel: null,
      concessionAssumptionNote: null,
    };
  }

  let appliedBaseRent = periodAdjustedBaseRent;
  if (event.type === CONCESSION_TYPES.FREE_RENT) {
    appliedBaseRent = 0;
  } else if (event.valueMode === CONCESSION_VALUE_MODES.FIXED_AMOUNT) {
    appliedBaseRent = Math.max(0, periodAdjustedBaseRent - (Number(event.value) || 0));
  } else if (event.valueMode === CONCESSION_VALUE_MODES.PERCENT) {
    appliedBaseRent = periodAdjustedBaseRent * (1 - clampPercent(event.value) / 100);
  }

  return {
    appliedBaseRent,
    abatementAmount: Math.max(0, periodAdjustedBaseRent - appliedBaseRent),
    baseFactor: scheduledBaseRent === 0 ? 0 : appliedBaseRent / scheduledBaseRent,
    prorationBasis: 'concession-event',
    isConcessionRow: true,
    abatementDays: 0,
    fullRentDays: 0,
    totalDays: 0,
    concessionEventId: event.id ?? null,
    concessionType: event.type ?? null,
    concessionScope: event.scope ?? null,
    concessionValueMode: event.valueMode ?? null,
    concessionValue: event.type === CONCESSION_TYPES.FREE_RENT ? 100 : Number(event.value) || 0,
    concessionTriggerDate: event.effectiveDate ? toISOLocal(event.effectiveDate) : null,
    concessionStartDate: null,
    concessionEndDate: null,
    concessionSource: event.source ?? null,
    concessionConfidence: event.confidence ?? null,
    concessionLabel: event.label ?? null,
    concessionAssumptionNote: event.assumptionNote ?? null,
  };
}

function getOverlapDays(periodStart, periodEnd, startDate, endDate) {
  if (!periodStart || !periodEnd || !startDate || !endDate) return 0;
  const overlapStart = periodStart.getTime() > startDate.getTime() ? periodStart : startDate;
  const overlapEnd = periodEnd.getTime() < endDate.getTime() ? periodEnd : endDate;
  if (overlapEnd.getTime() < overlapStart.getTime()) return 0;
  return daysBetweenInclusive(overlapStart, overlapEnd);
}

function applyLegacyWindowConcession(event, periodStart, periodEnd, scheduledBaseRent, periodFactor) {
  const periodAdjustedBaseRent = scheduledBaseRent * periodFactor;
  if (!event || !periodStart || !periodEnd) {
    return applyExplicitConcession(null, scheduledBaseRent, periodFactor);
  }

  const startDate = parseLooseDate(event.startDate);
  const endDate = parseLooseDate(event.endDate);
  const totalDays = daysBetweenInclusive(periodStart, periodEnd);
  const overlapDays = getOverlapDays(periodStart, periodEnd, startDate, endDate);

  if (!overlapDays || totalDays <= 0) {
    return applyExplicitConcession(null, scheduledBaseRent, periodFactor);
  }

  const overlapFraction = overlapDays / totalDays;
  let discountedAmount = periodAdjustedBaseRent;

  if (event.type === CONCESSION_TYPES.FREE_RENT) {
    discountedAmount = periodAdjustedBaseRent * (1 - overlapFraction);
  } else if (event.valueMode === CONCESSION_VALUE_MODES.FIXED_AMOUNT) {
    discountedAmount = Math.max(0, periodAdjustedBaseRent - ((Number(event.value) || 0) * overlapFraction));
  } else if (event.valueMode === CONCESSION_VALUE_MODES.PERCENT) {
    discountedAmount = periodAdjustedBaseRent * (1 - (clampPercent(event.value) / 100) * overlapFraction);
  }

  const isPartial = overlapDays < totalDays;

  return {
    appliedBaseRent: discountedAmount,
    abatementAmount: Math.max(0, periodAdjustedBaseRent - discountedAmount),
    baseFactor: scheduledBaseRent === 0 ? 0 : discountedAmount / scheduledBaseRent,
    prorationBasis: isPartial
      ? 'concession-boundary'
      : (periodFactor < 1 ? 'final-month' : 'full'),
    isConcessionRow: true,
    abatementDays: overlapDays,
    fullRentDays: Math.max(0, totalDays - overlapDays),
    totalDays,
    concessionEventId: event.id ?? null,
    concessionType: event.type ?? null,
    concessionScope: event.scope ?? null,
    concessionValueMode: event.valueMode ?? null,
    concessionValue: event.type === CONCESSION_TYPES.FREE_RENT ? 100 : Number(event.value) || 0,
    concessionTriggerDate: null,
    concessionStartDate: startDate ? toISOLocal(startDate) : null,
    concessionEndDate: endDate ? toISOLocal(endDate) : null,
    concessionSource: event.source ?? null,
    concessionConfidence: event.confidence ?? null,
    concessionLabel: event.label ?? null,
    concessionAssumptionNote: event.assumptionNote ?? null,
  };
}

function getLegacyConcessionForRow(legacyWindows, periodStart, periodEnd) {
  return legacyWindows.find((event) => getOverlapDays(
    periodStart,
    periodEnd,
    parseLooseDate(event.startDate),
    parseLooseDate(event.endDate),
  ) > 0) ?? null;
}

export function calculateAllCharges(expandedRows, params) {
  if (!expandedRows || expandedRows.length === 0) return [];

  const {
    squareFootage,
    nnnMode,
    nnnAggregate,
    cams,
    insurance,
    taxes,
    security,
    otherItems,
    oneTimeItems = [],
    charges: paramCharges = [],
  } = params;

  const isAggregate = nnnMode === 'aggregate';
  const useDynamicCharges = Array.isArray(paramCharges) && paramCharges.length > 0;
  const nnnAggEsc = (Number(nnnAggregate?.escPct) || 0) / 100;
  const camsEsc = (Number(cams?.escPct) || 0) / 100;
  const insuranceEsc = (Number(insurance?.escPct) || 0) / 100;
  const taxesEsc = (Number(taxes?.escPct) || 0) / 100;
  const securityEsc = (Number(security?.escPct) || 0) / 100;
  const otherItemsEsc = (Number(otherItems?.escPct) || 0) / 100;

  const rows = expandedRows
    .map((row) => ({ ...row }))
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));

  const totalRows = rows.length;
  const concessionState = normalizeConcessionEngineState(rows, params);
  const recurringOverrideState = normalizeRecurringOverrideState(rows, params);
  const activeRecurringOverrides = new Map();

  const seenOTLabels = new Set();
  const otLabelOrder = [];
  for (const item of oneTimeItems) {
    if (!(Number(item.amount) || 0)) continue;
    const label = String(item.label || '').trim() || 'One-time Charge';
    if (!seenOTLabels.has(label)) {
      seenOTLabels.add(label);
      otLabelOrder.push(label);
    }
  }

  const oneTimeByRow = Array.from({ length: totalRows }, () => {
    const result = {};
    for (const label of otLabelOrder) result[label] = 0;
    return result;
  });

  for (const item of oneTimeItems) {
    const amount = Number(item.amount) || 0;
    if (!amount) continue;
    const label = String(item.label || '').trim() || 'One-time Charge';
    const itemDate = parseLooseDate(item.date);

    if (!itemDate) {
      oneTimeByRow[0][label] = (oneTimeByRow[0][label] || 0) + amount;
      continue;
    }

    const rowIndex = resolveMonthlyRowIndex(rows, itemDate);
    const targetRow = rowIndex >= 0 ? rowIndex : 0;
    oneTimeByRow[targetRow][label] = (oneTimeByRow[targetRow][label] || 0) + amount;
  }

  for (let i = 0; i < totalRows; i += 1) {
    const row = rows[i];
    resolveActiveRecurringOverridesForRow(recurringOverrideState, i, activeRecurringOverrides);

    const leaseYear = Number(row['Year #'] || row.leaseYear || 1);
    const leaseMonth = Number(row['Month #'] || row.leaseMonth || i + 1);
    const { periodStart, periodEnd } = getRowBounds(rows, i);

    const {
      factor: periodFactor,
      actualDays,
      calMonthDays,
    } = computePeriodFactor(i, totalRows, periodStart, periodEnd);

    const baseRentOverride = activeRecurringOverrides.get(RECURRING_OVERRIDE_TARGETS.BASE_RENT) ?? null;
    const scheduledBaseRent = Number(baseRentOverride?.amount ?? row.monthlyRent ?? row.scheduledBaseRent ?? 0);
    const periodAdjustedBaseRent = scheduledBaseRent * periodFactor;

    const explicitEvent = concessionState.explicitMap.get(i) ?? null;
    const legacyEvent = explicitEvent ? null : getLegacyConcessionForRow(concessionState.legacyWindows, periodStart, periodEnd);
    const concessionResult = explicitEvent
      ? applyExplicitConcession(explicitEvent, scheduledBaseRent, periodFactor)
      : applyLegacyWindowConcession(legacyEvent, periodStart, periodEnd, scheduledBaseRent, periodFactor);

    const chargeAmounts = {};
    const chargeDetails = {};

    let camsAmount = 0;
    let camsEscYears = null;
    let camsActive = false;
    let insuranceAmount = 0;
    let insuranceEscYears = null;
    let insuranceActive = false;
    let taxesAmount = 0;
    let taxesEscYears = null;
    let taxesActive = false;
    let nnnAggregateAmount = 0;
    let securityAmount = 0;
    let securityEscYears = null;
    let securityActive = false;
    let otherItemsAmount = 0;
    let otherItemsEscYears = null;
    let otherItemsActive = false;

    let trueNNN = 0;
    let otherChargesBase = 0;

    if (isAggregate) {
      const aggregateOverride = activeRecurringOverrides.get(RECURRING_OVERRIDE_TARGETS.NNN_AGGREGATE) ?? null;
      nnnAggregateAmount = aggregateOverride
        ? computeRecurringOverrideAmount(aggregateOverride, periodFactor)
        : Number(computeChargeAmount(
          Number(nnnAggregate?.year1) || 0,
          nnnAggEsc,
          null,
          leaseYear,
          periodFactor,
        ).toFixed(2));
      trueNNN = nnnAggregateAmount;
      chargeAmounts.nnnAggregate = nnnAggregateAmount;
      chargeDetails.nnnAggregate = {
        displayLabel: 'NNN (Aggregate)',
        canonicalType: 'nnn',
        active: true,
        escYears: null,
        escPct: aggregateOverride ? 0 : Number(nnnAggregate?.escPct) || 0,
        overrideApplied: Boolean(aggregateOverride),
      };
    }

    if (useDynamicCharges) {
      for (const charge of paramCharges) {
        if (isAggregate && charge.canonicalType === 'nnn') continue;

        const overrideEvent = activeRecurringOverrides.get(charge.key) ?? null;
        const escRate = (Number(charge.escPct) || 0) / 100;
        const active = overrideEvent ? true : isChargeActive(periodStart, charge.chargeStart);
        const escYears = overrideEvent ? null : (active ? yearsSinceStart(periodStart, charge.escStart) : null);
        const amount = overrideEvent
          ? computeRecurringOverrideAmount(overrideEvent, periodFactor)
          : (
            active
              ? Number(computeChargeAmount(Number(charge.year1) || 0, escRate, escYears, leaseYear, periodFactor).toFixed(2))
              : 0
          );

        chargeAmounts[charge.key] = amount;
        chargeDetails[charge.key] = {
          displayLabel: charge.displayLabel,
          canonicalType: charge.canonicalType,
          active,
          escYears,
          escPct: overrideEvent ? 0 : Number(charge.escPct) || 0,
          overrideApplied: Boolean(overrideEvent),
        };

        if (charge.canonicalType === 'nnn') {
          trueNNN += amount;
        } else {
          otherChargesBase += amount;
        }

        switch (charge.key) {
          case 'cams':
            camsAmount = amount;
            camsEscYears = escYears;
            camsActive = active;
            break;
          case 'insurance':
            insuranceAmount = amount;
            insuranceEscYears = escYears;
            insuranceActive = active;
            break;
          case 'taxes':
            taxesAmount = amount;
            taxesEscYears = escYears;
            taxesActive = active;
            break;
          case 'security':
            securityAmount = amount;
            securityEscYears = escYears;
            securityActive = active;
            break;
          case 'otherItems':
            otherItemsAmount = amount;
            otherItemsEscYears = escYears;
            otherItemsActive = active;
            break;
        }
      }
    } else {
      if (!isAggregate) {
        const camsOverride = activeRecurringOverrides.get('cams') ?? null;
        camsActive = camsOverride ? true : isChargeActive(periodStart, cams?.chargeStart);
        camsEscYears = camsOverride ? null : (camsActive ? yearsSinceStart(periodStart, cams?.escStart) : null);
        camsAmount = camsOverride
          ? computeRecurringOverrideAmount(camsOverride, periodFactor)
          : (
            camsActive
              ? Number(computeChargeAmount(Number(cams?.year1) || 0, camsEsc, camsEscYears, leaseYear, periodFactor).toFixed(2))
              : 0
          );

        const insuranceOverride = activeRecurringOverrides.get('insurance') ?? null;
        insuranceActive = insuranceOverride ? true : isChargeActive(periodStart, insurance?.chargeStart);
        insuranceEscYears = insuranceOverride ? null : (insuranceActive ? yearsSinceStart(periodStart, insurance?.escStart) : null);
        insuranceAmount = insuranceOverride
          ? computeRecurringOverrideAmount(insuranceOverride, periodFactor)
          : (
            insuranceActive
              ? Number(computeChargeAmount(Number(insurance?.year1) || 0, insuranceEsc, insuranceEscYears, leaseYear, periodFactor).toFixed(2))
              : 0
          );

        const taxesOverride = activeRecurringOverrides.get('taxes') ?? null;
        taxesActive = taxesOverride ? true : isChargeActive(periodStart, taxes?.chargeStart);
        taxesEscYears = taxesOverride ? null : (taxesActive ? yearsSinceStart(periodStart, taxes?.escStart) : null);
        taxesAmount = taxesOverride
          ? computeRecurringOverrideAmount(taxesOverride, periodFactor)
          : (
            taxesActive
              ? Number(computeChargeAmount(Number(taxes?.year1) || 0, taxesEsc, taxesEscYears, leaseYear, periodFactor).toFixed(2))
              : 0
          );

        trueNNN = camsAmount + insuranceAmount + taxesAmount;
      }

      const securityOverride = activeRecurringOverrides.get('security') ?? null;
      securityActive = securityOverride ? true : isChargeActive(periodStart, security?.chargeStart);
      securityEscYears = securityOverride ? null : (securityActive ? yearsSinceStart(periodStart, security?.escStart) : null);
      securityAmount = securityOverride
        ? computeRecurringOverrideAmount(securityOverride, periodFactor)
        : (
          securityActive
            ? Number(computeChargeAmount(Number(security?.year1) || 0, securityEsc, securityEscYears, leaseYear, periodFactor).toFixed(2))
            : 0
        );

      const otherItemsOverride = activeRecurringOverrides.get('otherItems') ?? null;
      otherItemsActive = otherItemsOverride ? true : isChargeActive(periodStart, otherItems?.chargeStart);
      otherItemsEscYears = otherItemsOverride ? null : (otherItemsActive ? yearsSinceStart(periodStart, otherItems?.escStart) : null);
      otherItemsAmount = otherItemsOverride
        ? computeRecurringOverrideAmount(otherItemsOverride, periodFactor)
        : (
          otherItemsActive
            ? Number(computeChargeAmount(Number(otherItems?.year1) || 0, otherItemsEsc, otherItemsEscYears, leaseYear, periodFactor).toFixed(2))
            : 0
        );

      otherChargesBase = securityAmount + otherItemsAmount;

      if (!isAggregate) {
        chargeAmounts.cams = camsAmount;
        chargeAmounts.insurance = insuranceAmount;
        chargeAmounts.taxes = taxesAmount;
        chargeDetails.cams = { displayLabel: 'CAMS', canonicalType: 'nnn', active: camsActive, escYears: camsEscYears, escPct: activeRecurringOverrides.get('cams') ? 0 : Number(cams?.escPct) || 0, overrideApplied: Boolean(activeRecurringOverrides.get('cams')) };
        chargeDetails.insurance = { displayLabel: 'Insurance', canonicalType: 'nnn', active: insuranceActive, escYears: insuranceEscYears, escPct: activeRecurringOverrides.get('insurance') ? 0 : Number(insurance?.escPct) || 0, overrideApplied: Boolean(activeRecurringOverrides.get('insurance')) };
        chargeDetails.taxes = { displayLabel: 'Taxes', canonicalType: 'nnn', active: taxesActive, escYears: taxesEscYears, escPct: activeRecurringOverrides.get('taxes') ? 0 : Number(taxes?.escPct) || 0, overrideApplied: Boolean(activeRecurringOverrides.get('taxes')) };
      }

      chargeAmounts.security = securityAmount;
      chargeAmounts.otherItems = otherItemsAmount;
      chargeDetails.security = { displayLabel: 'Security', canonicalType: 'other', active: securityActive, escYears: securityEscYears, escPct: activeRecurringOverrides.get('security') ? 0 : Number(security?.escPct) || 0, overrideApplied: Boolean(activeRecurringOverrides.get('security')) };
      chargeDetails.otherItems = { displayLabel: 'Other Items', canonicalType: 'other', active: otherItemsActive, escYears: otherItemsEscYears, escPct: activeRecurringOverrides.get('otherItems') ? 0 : Number(otherItems?.escPct) || 0, overrideApplied: Boolean(activeRecurringOverrides.get('otherItems')) };
    }

    const oneTimeItemAmounts = oneTimeByRow[i];
    const oneTimeChargesAmount = Number(Object.values(oneTimeItemAmounts).reduce((sum, value) => sum + value, 0).toFixed(2));
    const totalOtherChargesAmount = Number((otherChargesBase + oneTimeChargesAmount).toFixed(2));
    const baseRentApplied = Number(concessionResult.appliedBaseRent.toFixed(2));
    const abatementAmount = Number(concessionResult.abatementAmount.toFixed(2));
    const totalMonthlyObligation = Number((baseRentApplied + trueNNN + totalOtherChargesAmount).toFixed(2));
    const effectivePerSF = squareFootage > 0
      ? Number((totalMonthlyObligation / squareFootage).toFixed(6))
      : null;

    Object.assign(row, {
      periodStart: toISOLocal(periodStart),
      periodEnd: periodEnd ? toISOLocal(periodEnd) : null,
      leaseYear,
      leaseMonth,
      scheduledBaseRent: Number(scheduledBaseRent.toFixed(2)),
      periodAdjustedBaseRent: Number(periodAdjustedBaseRent.toFixed(2)),
      baseRentOverrideApplied: Boolean(baseRentOverride),
      baseRentApplied,
      abatementAmount,
      baseRentProrationFactor: Number(concessionResult.baseFactor.toFixed(6)),
      isConcessionRow: concessionResult.isConcessionRow,
      isAbatementRow: concessionResult.isConcessionRow,
      periodFactor: Number(periodFactor.toFixed(6)),
      prorationBasis: concessionResult.prorationBasis,
      abatementDays: concessionResult.abatementDays,
      fullRentDays: concessionResult.fullRentDays,
      totalDays: concessionResult.totalDays,
      actualDays,
      calMonthDays,
      nnnMode: isAggregate ? 'aggregate' : 'individual',
      nnnAggregateAmount,
      chargeAmounts,
      chargeDetails,
      camsAmount,
      camsEscPct: Number(cams?.escPct) || 0,
      camsEscYears,
      camsActive,
      insuranceAmount,
      insuranceEscPct: Number(insurance?.escPct) || 0,
      insuranceEscYears,
      insuranceActive,
      taxesAmount,
      taxesEscPct: Number(taxes?.escPct) || 0,
      taxesEscYears,
      taxesActive,
      securityAmount,
      securityEscPct: Number(security?.escPct) || 0,
      securityEscYears,
      securityActive,
      otherItemsAmount,
      otherItemsEscPct: Number(otherItems?.escPct) || 0,
      otherItemsEscYears,
      otherItemsActive,
      oneTimeItemAmounts,
      oneTimeChargesAmount,
      totalOtherChargesAmount,
      totalNNNAmount: Number(trueNNN.toFixed(2)),
      totalMonthlyObligation,
      effectivePerSF,
      totalObligationRemaining: 0,
      totalNNNRemaining: 0,
      totalBaseRentRemaining: 0,
      totalOtherChargesRemaining: 0,
      concessionEventId: concessionResult.concessionEventId,
      concessionType: concessionResult.concessionType,
      concessionScope: concessionResult.concessionScope,
      concessionValueMode: concessionResult.concessionValueMode,
      concessionValue: concessionResult.concessionValue,
      concessionTriggerDate: concessionResult.concessionTriggerDate,
      concessionStartDate: concessionResult.concessionStartDate,
      concessionEndDate: concessionResult.concessionEndDate,
      concessionSource: concessionResult.concessionSource,
      concessionConfidence: concessionResult.concessionConfidence,
      concessionLabel: concessionResult.concessionLabel,
      concessionAssumptionNote: concessionResult.concessionAssumptionNote,
      sourcePeriodIndex: row.sourcePeriodIndex ?? null,
      sourcePeriodStart: row.sourcePeriodStart ?? null,
      sourcePeriodEnd: row.sourcePeriodEnd ?? null,
    });
  }

  const { year1BaseRent, annualEscRate } = inferAnnualBaseEscRate(rows);
  for (const row of rows) {
    const irregularEscalationTargets = [];
    const irregularEscalationLabels = [];
    const expectedAnnualBaseRent = expectedAnnualBaseRentForRow(row, year1BaseRent, annualEscRate);
    const annualTol = Math.max(0.01, Math.abs(expectedAnnualBaseRent) * 0.0015);
    const isIrregularBaseRent = Boolean(row.baseRentOverrideApplied) ||
      Math.abs((row.scheduledBaseRent ?? 0) - expectedAnnualBaseRent) > annualTol;

    if (isIrregularBaseRent) {
      irregularEscalationTargets.push(RECURRING_OVERRIDE_TARGETS.BASE_RENT);
      irregularEscalationLabels.push('Base Rent');
    }

    for (const [key, detail] of Object.entries(row.chargeDetails ?? {})) {
      if (!detail?.overrideApplied) continue;
      irregularEscalationTargets.push(key);
      irregularEscalationLabels.push(detail.displayLabel || key);
    }

    row.inferredAnnualBaseRent = expectedAnnualBaseRent;
    row.isIrregularBaseRent = isIrregularBaseRent;
    row.baseRentEscalationType = isIrregularBaseRent ? 'irregular' : 'annual';
    row.hasIrregularEscalation = irregularEscalationTargets.length > 0;
    row.irregularEscalationTargets = irregularEscalationTargets;
    row.irregularEscalationLabels = irregularEscalationLabels;
  }

  let runningTotal = 0;
  let runningNNN = 0;
  let runningBase = 0;
  let runningOtherCharges = 0;

  for (let i = totalRows - 1; i >= 0; i -= 1) {
    const row = rows[i];
    runningTotal += row.totalMonthlyObligation;
    runningNNN += row.totalNNNAmount;
    runningBase += row.baseRentApplied;
    runningOtherCharges += row.totalOtherChargesAmount;

    row.totalObligationRemaining = Number(runningTotal.toFixed(2));
    row.totalNNNRemaining = Number(runningNNN.toFixed(2));
    row.totalBaseRentRemaining = Number(runningBase.toFixed(2));
    row.totalOtherChargesRemaining = Number(runningOtherCharges.toFixed(2));
  }

  return rows;
}
