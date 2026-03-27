import { defaultChargesForm } from './chargeTypes.js';
import { addMonthsAnchored, parseISODate, parseMDYStrict } from './yearMonth.js';

export const CONCESSION_TYPES = {
  FREE_RENT: 'free_rent',
  ABATEMENT: 'abatement',
};

export const CONCESSION_SCOPES = {
  MONTHLY_ROW: 'monthly_row',
  LEGACY_WINDOW: 'legacy_window',
};

export const CONCESSION_VALUE_MODES = {
  PERCENT: 'percent',
  FIXED_AMOUNT: 'fixed_amount',
};

export const RECURRING_OVERRIDE_TARGETS = {
  BASE_RENT: 'base_rent',
  NNN_AGGREGATE: 'nnn_aggregate',
};

export function emptyFreeRentEventForm() {
  return { monthNumber: '', label: '' };
}

export function emptyAbatementEventForm() {
  return {
    monthNumber: '',
    value: '',
    valueMode: CONCESSION_VALUE_MODES.PERCENT,
    label: '',
  };
}

export function emptyRecurringOverrideForm(targetKey = RECURRING_OVERRIDE_TARGETS.BASE_RENT) {
  return {
    targetKey,
    date: '',
    amount: '',
    label: '',
  };
}

function parseFormDate(value) {
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

function normalizeMonthNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const monthNumber = Number(value);
  if (!Number.isInteger(monthNumber) || monthNumber <= 0) return null;
  return monthNumber;
}

function resolveDateFromMonthNumber(rows = [], monthNumber) {
  if (!monthNumber || rows.length === 0) return null;
  const row = rows[monthNumber - 1];
  if (!row) return null;
  return parseISODate(row.date ?? row.periodStart);
}

function resolveMonthNumberFromDate(rows = [], targetDate) {
  if (!targetDate || rows.length === 0) return null;
  const rowIndex = resolveMonthlyRowIndex(rows, targetDate);
  return rowIndex >= 0 ? rowIndex + 1 : null;
}

function buildFallbackChargeForms(form) {
  return defaultChargesForm().map((template) => ({
    ...template,
    ...(form?.[template.key] ?? {}),
  }));
}

export function getRawChargeForms(form) {
  if (Array.isArray(form?.charges) && form.charges.length > 0) {
    return form.charges;
  }
  return buildFallbackChargeForms(form);
}

export function normalizeCharges(form) {
  return getRawChargeForms(form).map((charge) => ({
    key: charge.key,
    canonicalType: charge.canonicalType ?? 'other',
    displayLabel: charge.displayLabel ?? charge.key,
    year1: Number(charge.year1) || 0,
    escPct: Number(charge.escPct) || 0,
    escStart: parseFormDate(charge.escStart),
    chargeStart: parseFormDate(charge.chargeStart),
  }));
}

function emptyLegacyCharge() {
  return { year1: 0, escPct: 0, escStart: null, chargeStart: null };
}

export function buildLegacyChargeMap(charges) {
  const byKey = Object.fromEntries((charges ?? []).map((charge) => [charge.key, charge]));
  return {
    cams: byKey.cams ?? emptyLegacyCharge(),
    insurance: byKey.insurance ?? emptyLegacyCharge(),
    taxes: byKey.taxes ?? emptyLegacyCharge(),
    security: byKey.security ?? emptyLegacyCharge(),
    otherItems: byKey.otherItems ?? emptyLegacyCharge(),
  };
}

function normalizeExplicitFreeRentEvent(event, index, rows = []) {
  const explicitMonthNumber = normalizeMonthNumber(event?.monthNumber);
  const datedMonthNumber = explicitMonthNumber == null
    ? resolveMonthNumberFromDate(rows, parseFormDate(event?.date))
    : null;
  const monthNumber = explicitMonthNumber ?? datedMonthNumber;
  const effectiveDate = resolveDateFromMonthNumber(rows, monthNumber) ?? parseFormDate(event?.date);
  if (!effectiveDate || !monthNumber) return null;
  return {
    id: event.id ?? `free_rent_${index + 1}`,
    type: CONCESSION_TYPES.FREE_RENT,
    scope: CONCESSION_SCOPES.MONTHLY_ROW,
    monthNumber,
    effectiveDate,
    startDate: null,
    endDate: null,
    valueMode: CONCESSION_VALUE_MODES.PERCENT,
    value: 100,
    source: event.source ?? 'manual',
    confidence: event.confidence ?? 'high',
    assumptionNote: event.assumptionNote ?? '',
    label: event.label ?? 'Free Rent',
    rawText: event.rawText ?? '',
  };
}

function normalizeExplicitAbatementEvent(event, index, rows = []) {
  const explicitMonthNumber = normalizeMonthNumber(event?.monthNumber);
  const datedMonthNumber = explicitMonthNumber == null
    ? resolveMonthNumberFromDate(rows, parseFormDate(event?.date))
    : null;
  const monthNumber = explicitMonthNumber ?? datedMonthNumber;
  const effectiveDate = resolveDateFromMonthNumber(rows, monthNumber) ?? parseFormDate(event?.date);
  if (!effectiveDate || !monthNumber) return null;
  const valueMode = event?.valueMode === CONCESSION_VALUE_MODES.FIXED_AMOUNT
    ? CONCESSION_VALUE_MODES.FIXED_AMOUNT
    : CONCESSION_VALUE_MODES.PERCENT;
  const value = Number(event?.value);
  if (!Number.isFinite(value)) return null;
  return {
    id: event.id ?? `abatement_${index + 1}`,
    type: CONCESSION_TYPES.ABATEMENT,
    scope: CONCESSION_SCOPES.MONTHLY_ROW,
    monthNumber,
    effectiveDate,
    startDate: null,
    endDate: null,
    valueMode,
    value,
    source: event.source ?? 'manual',
    confidence: event.confidence ?? 'high',
    assumptionNote: event.assumptionNote ?? '',
    label: event.label ?? 'Abatement',
    rawText: event.rawText ?? '',
  };
}

function buildLegacyHelperConcession(form) {
  const abatementEndDate = parseFormDate(form?.abatementEndDate);
  const abatementPct = Number(form?.abatementPct) || 0;
  if (!abatementEndDate || abatementPct <= 0) return [];

  return [{
    id: 'legacy_helper_abatement',
    type: abatementPct === 100 ? CONCESSION_TYPES.FREE_RENT : CONCESSION_TYPES.ABATEMENT,
    scope: CONCESSION_SCOPES.LEGACY_WINDOW,
    startDate: parseFormDate(form?.legacyConcessionStartDate),
    endDate: abatementEndDate,
    valueMode: CONCESSION_VALUE_MODES.PERCENT,
    value: abatementPct,
    source: 'legacy',
    confidence: 'high',
    assumptionNote: 'Legacy contiguous abatement preserved for backward compatibility.',
    label: abatementPct === 100 ? 'Legacy Free Rent Window' : 'Legacy Abatement Window',
    rawText: '',
  }];
}

function normalizeLegacyConcessionEvent(event, index, leaseStartDate, rows = []) {
  const scope = event?.scope === CONCESSION_SCOPES.MONTHLY_ROW
    ? CONCESSION_SCOPES.MONTHLY_ROW
    : CONCESSION_SCOPES.LEGACY_WINDOW;
  const type = event?.type === CONCESSION_TYPES.FREE_RENT
    ? CONCESSION_TYPES.FREE_RENT
    : CONCESSION_TYPES.ABATEMENT;
  const valueMode = event?.valueMode === CONCESSION_VALUE_MODES.FIXED_AMOUNT
    ? CONCESSION_VALUE_MODES.FIXED_AMOUNT
    : CONCESSION_VALUE_MODES.PERCENT;
  const value = type === CONCESSION_TYPES.FREE_RENT
    ? 100
    : (Number(event?.value) || 0);

  if (scope === CONCESSION_SCOPES.MONTHLY_ROW) {
    const effectiveDate = parseFormDate(event?.effectiveDate ?? event?.date);
    const monthNumber = normalizeMonthNumber(event?.monthNumber) ?? resolveMonthNumberFromDate(rows ?? [], effectiveDate);
    if (!effectiveDate || !monthNumber) return null;
    return {
      id: event.id ?? `legacy_event_${index + 1}`,
      type,
      scope,
      monthNumber,
      effectiveDate,
      startDate: null,
      endDate: null,
      valueMode,
      value,
      source: event.source ?? 'legacy',
      confidence: event.confidence ?? 'medium',
      assumptionNote: event.assumptionNote ?? '',
      label: event.label ?? (type === CONCESSION_TYPES.FREE_RENT ? 'Imported Free Rent' : 'Imported Abatement'),
      rawText: event.rawText ?? '',
    };
  }

  const startDate = parseFormDate(event?.startDate) ?? leaseStartDate ?? null;
  const endDate = parseFormDate(event?.endDate);
  if (!startDate || !endDate) return null;

  return {
    id: event.id ?? `legacy_window_${index + 1}`,
    type,
    scope,
    effectiveDate: null,
    startDate,
    endDate,
    valueMode,
    value,
    source: event.source ?? 'legacy',
    confidence: event.confidence ?? 'medium',
    assumptionNote: event.assumptionNote ?? '',
    label: event.label ?? (type === CONCESSION_TYPES.FREE_RENT ? 'Imported Free Rent Window' : 'Imported Abatement Window'),
    rawText: event.rawText ?? '',
  };
}

export function normalizeConcessionEvents(form, rows = []) {
  const leaseStartDate = rows.length > 0
    ? parseISODate(rows[0].date ?? rows[0].periodStart)
    : parseFormDate(form?.legacyConcessionStartDate ?? form?.rentCommencementDate);

  const legacyInputs = Array.isArray(form?.legacyConcessionEvents) && form.legacyConcessionEvents.length > 0
    ? form.legacyConcessionEvents
    : buildLegacyHelperConcession(form);

  const legacyEvents = legacyInputs
    .map((event, index) => normalizeLegacyConcessionEvent(event, index, leaseStartDate, rows))
    .filter((event) => event && (event.type === CONCESSION_TYPES.FREE_RENT || event.value > 0));

  const freeRentEvents = (form?.freeRentEvents ?? [])
    .map((event, index) => normalizeExplicitFreeRentEvent(event, index, rows))
    .filter(Boolean);

  const abatementEvents = (form?.abatementEvents ?? [])
    .map((event, index) => normalizeExplicitAbatementEvent(event, index, rows))
    .filter((event) => event && event.value > 0);

  return [...legacyEvents, ...freeRentEvents, ...abatementEvents];
}

function normalizeRecurringOverride(event, index) {
  const effectiveDate = parseFormDate(event?.date);
  if (!effectiveDate) return null;
  const amount = Number(event?.amount);
  if (!Number.isFinite(amount)) return null;

  return {
    id: event.id ?? `recurring_override_${index + 1}`,
    targetKey: String(event?.targetKey || RECURRING_OVERRIDE_TARGETS.BASE_RENT),
    effectiveDate,
    amount,
    source: event?.source ?? 'manual',
    confidence: event?.confidence ?? 'high',
    assumptionNote: event?.assumptionNote ?? '',
    label: event?.label ?? '',
    rawText: event?.rawText ?? '',
  };
}

export function normalizeRecurringOverrides(form) {
  return (form?.recurringOverrides ?? [])
    .map((event, index) => normalizeRecurringOverride(event, index))
    .filter(Boolean);
}

export function normalizeFormToCalculatorParams(form, rows = []) {
  const charges = normalizeCharges(form);
  const legacyCharges = buildLegacyChargeMap(charges);

  return {
    leaseName: String(form?.leaseName || '').trim(),
    nnnMode: form?.nnnMode ?? 'individual',
    nnnAggregate: {
      year1: Number(form?.nnnAggregate?.year1) || 0,
      escPct: Number(form?.nnnAggregate?.escPct) || 0,
    },
    squareFootage: Number(form?.squareFootage) || 0,
    rentCommencementDate: parseFormDate(form?.rentCommencementDate),
    effectiveAnalysisDate: parseFormDate(form?.effectiveAnalysisDate),
    concessionEvents: normalizeConcessionEvents(form, rows),
    recurringOverrides: normalizeRecurringOverrides(form),
    oneTimeItems: (form?.oneTimeItems ?? [])
      .map((item) => ({
        label: item.label ?? '',
        date: parseFormDate(item.date),
        amount: Number(item.amount) || 0,
      }))
      .filter((item) => item.amount !== 0),
    charges,
    ...legacyCharges,
    abatementEndDate: parseFormDate(form?.abatementEndDate),
    abatementPct: Number(form?.abatementPct) || 0,
    freeRentMonths: 0,
    freeRentEndDate: null,
  };
}

export function buildOCRCharges(result) {
  const recurringCharges = Array.isArray(result?.recurringCharges) ? result.recurringCharges : null;
  if (recurringCharges && recurringCharges.length > 0) {
    return recurringCharges.map((charge, index) => ({
      key: charge.key ?? `charge_${index + 1}`,
      canonicalType: charge.canonicalType ?? 'other',
      displayLabel: charge.displayLabel ?? charge.label ?? charge.key ?? `Charge ${index + 1}`,
      year1: charge.year1 != null ? String(charge.year1) : '',
      escPct: charge.escPct != null ? String(charge.escPct) : '',
      chargeStart: charge.chargeStart ?? '',
      escStart: charge.escStart ?? '',
    }));
  }

  return defaultChargesForm().map((template) => {
    const source = result?.[template.key] ?? {};
    return {
      ...template,
      year1: source?.year1 != null ? String(source.year1) : '',
      escPct: source?.escPct != null ? String(source.escPct) : '',
      chargeStart: source?.chargeStart ?? '',
      escStart: source?.escStart ?? '',
    };
  });
}

function fmtDate(date) {
  if (!date) return '';
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function toFormMonthNumber(rows = [], event) {
  const explicitMonthNumber = normalizeMonthNumber(event?.monthNumber);
  if (explicitMonthNumber != null) return explicitMonthNumber;
  const eventDate = parseFormDate(event?.effectiveDate ?? event?.date);
  return resolveMonthNumberFromDate(rows, eventDate);
}

function toDetectedFreeRentFormEvent(event, rows = [], index = 0) {
  const monthNumber = toFormMonthNumber(rows, event);
  const resolvedDate = resolveDateFromMonthNumber(rows, monthNumber) ?? parseFormDate(event?.effectiveDate ?? event?.date);
  if (!monthNumber || !resolvedDate) return null;
  return {
    id: event?.id ?? `ocr_free_rent_${index + 1}`,
    monthNumber: String(monthNumber),
    label: event?.label ?? 'Imported Free Rent',
    source: event?.source ?? 'ocr',
    confidence: event?.confidence ?? 'medium',
    assumptionNote: event?.assumptionNote ?? '',
    rawText: event?.rawText ?? '',
    date: fmtDate(resolvedDate),
  };
}

function toDetectedAbatementFormEvent(event, rows = [], index = 0) {
  const monthNumber = toFormMonthNumber(rows, event);
  const resolvedDate = resolveDateFromMonthNumber(rows, monthNumber) ?? parseFormDate(event?.effectiveDate ?? event?.date);
  if (!monthNumber || !resolvedDate) return null;
  const value = Number(event?.value);
  if (!Number.isFinite(value)) return null;
  return {
    id: event?.id ?? `ocr_abatement_${index + 1}`,
    monthNumber: String(monthNumber),
    value: String(value),
    valueMode: event?.valueMode === CONCESSION_VALUE_MODES.FIXED_AMOUNT
      ? CONCESSION_VALUE_MODES.FIXED_AMOUNT
      : CONCESSION_VALUE_MODES.PERCENT,
    label: event?.label ?? 'Imported Abatement',
    source: event?.source ?? 'ocr',
    confidence: event?.confidence ?? 'medium',
    assumptionNote: event?.assumptionNote ?? '',
    rawText: event?.rawText ?? '',
    date: fmtDate(resolvedDate),
  };
}

function getOCRLegacyWindow(result, rows = []) {
  const abatementEndDate = parseFormDate(result?.abatementEndDate);
  const abatementPct = Number(result?.abatementPct) || 0;
  if (!abatementEndDate || abatementPct <= 0) return null;

  const leaseStartDate = rows.length > 0
    ? parseISODate(rows[0].date ?? rows[0].periodStart)
    : parseFormDate(result?.rentSchedule?.[0]?.periodStart);
  if (!leaseStartDate) return null;

  const flagged = (result?.confidenceFlags ?? []).includes('abatementEndDate') ||
    (result?.confidenceFlags ?? []).includes('abatementPct');

  return {
    startDate: leaseStartDate,
    endDate: abatementEndDate,
    pct: abatementPct,
    confidence: flagged ? 'low' : 'medium',
    source: 'parsed',
    assumptionNote: 'Generated from OCR as dated monthly concession events from a legacy contiguous window. Review the generated dates before processing.',
  };
}

function rowOverlapsWindow(range, startDate, endDate) {
  if (!range?.start || !range?.end || !startDate || !endDate) return false;
  return range.start.getTime() <= endDate.getTime() && range.end.getTime() >= startDate.getTime();
}

export function buildResolvedRowRanges(rows = []) {
  return rows.map((row, index) => {
    const start = parseISODate(row.date ?? row.periodStart);
    let end = null;
    if (index < rows.length - 1) {
      const nextStart = parseISODate(rows[index + 1].date ?? rows[index + 1].periodStart);
      if (nextStart) {
        end = new Date(nextStart.getTime() - 86400000);
        end.setHours(0, 0, 0, 0);
      }
    }
    if (!end && start) {
      end = row.periodEnd
        ? parseISODate(row.periodEnd)
        : new Date(addMonthsAnchored(start, 1).getTime() - 86400000);
      end?.setHours?.(0, 0, 0, 0);
    }
    return { start, end };
  });
}

export function resolveMonthlyRowIndex(rows = [], targetDate) {
  if (!targetDate || rows.length === 0) return -1;
  const ranges = buildResolvedRowRanges(rows);
  for (let i = 0; i < ranges.length; i += 1) {
    const range = ranges[i];
    if (!range.start || !range.end) continue;
    if (targetDate.getTime() >= range.start.getTime() && targetDate.getTime() <= range.end.getTime()) {
      return i;
    }
  }
  const firstStart = ranges[0]?.start;
  const lastEnd = ranges[ranges.length - 1]?.end;
  if (firstStart && targetDate.getTime() < firstStart.getTime()) return 0;
  if (lastEnd && targetDate.getTime() > lastEnd.getTime()) return rows.length - 1;
  return -1;
}

export function buildOCRConcessionForms(result, rows = []) {
  const explicitFreeRentEvents = Array.isArray(result?.freeRentEvents)
    ? result.freeRentEvents
        .map((event, index) => toDetectedFreeRentFormEvent(event, rows, index))
        .filter(Boolean)
    : [];
  const explicitAbatementEvents = Array.isArray(result?.abatementEvents)
    ? result.abatementEvents
        .map((event, index) => toDetectedAbatementFormEvent(event, rows, index))
        .filter(Boolean)
    : [];

  if (explicitFreeRentEvents.length > 0 || explicitAbatementEvents.length > 0) {
    return {
      freeRentEvents: explicitFreeRentEvents,
      abatementEvents: explicitAbatementEvents,
      notices: [],
    };
  }

  const legacyWindow = getOCRLegacyWindow(result, rows);
  if (!legacyWindow) {
    return { freeRentEvents: [], abatementEvents: [], notices: [] };
  }

  const ranges = buildResolvedRowRanges(rows);
  const overlappingRows = ranges
    .map((range, index) => ({ range, index }))
    .filter(({ range }) => rowOverlapsWindow(range, legacyWindow.startDate, legacyWindow.endDate));

  if (overlappingRows.length === 0) {
    return { freeRentEvents: [], abatementEvents: [], notices: [] };
  }

  const baseEvent = {
    source: legacyWindow.source,
    confidence: legacyWindow.confidence,
    assumptionNote: legacyWindow.assumptionNote,
    rawText: '',
  };

  const freeRentEvents = [];
  const abatementEvents = [];

  for (const { range, index } of overlappingRows) {
    const triggerDate = fmtDate(range.start);
    if (legacyWindow.pct === 100) {
      freeRentEvents.push({
        ...baseEvent,
        id: `ocr_free_rent_${index + 1}`,
        monthNumber: String(index + 1),
        date: triggerDate,
        label: 'Imported Free Rent',
      });
      continue;
    }

    abatementEvents.push({
      ...baseEvent,
      id: `ocr_abatement_${index + 1}`,
      monthNumber: String(index + 1),
      date: triggerDate,
      value: String(legacyWindow.pct),
      valueMode: CONCESSION_VALUE_MODES.PERCENT,
      label: 'Imported Abatement',
    });
  }

  const notices = [
    `${legacyWindow.pct === 100 ? 'Imported free-rent' : 'Imported abatement'} window was converted into ${overlappingRows.length} dated monthly event${overlappingRows.length === 1 ? '' : 's'}. Review the generated concession dates before processing.`,
  ];

  return { freeRentEvents, abatementEvents, notices };
}

export function buildLegacyConcessionEventsFromOCR(result, rows = []) {
  return [];
}

export function describeLegacyConcessionEvent(event) {
  const startLabel = event?.startDate || 'lease commencement';
  const endLabel = event?.endDate || 'unknown end date';
  const valueLabel = event?.type === CONCESSION_TYPES.FREE_RENT
    ? '100% free rent'
    : `${event?.value ?? 0}${event?.valueMode === CONCESSION_VALUE_MODES.FIXED_AMOUNT ? ' fixed reduction' : '% abatement'}`;
  return `${valueLabel} from ${startLabel} through ${endLabel}`;
}
