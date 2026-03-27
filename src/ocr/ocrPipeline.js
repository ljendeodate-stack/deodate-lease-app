import { parseMDYStrict, parseExcelDate } from '../engine/yearMonth.js';
import { classifyExpenseLabel, NNN_BUCKET_KEYS } from '../engine/labelClassifier.js';
import { buildOCRConcessionForms, buildLegacyConcessionEventsFromOCR } from '../engine/leaseTerms.js';
import { buildChargesFromOCR, hasDetectedNNNCharges } from './chargeNormalizer.js';

export function ocrScheduleToPeriodRows(rentSchedule) {
  if (!Array.isArray(rentSchedule)) return [];
  return rentSchedule
    .map(({ periodStart, periodEnd, monthlyRent }) => ({
      periodStart: parseMDYStrict(periodStart) ?? parseExcelDate(periodStart),
      periodEnd: parseMDYStrict(periodEnd) ?? parseExcelDate(periodEnd),
      monthlyRent: Number(monthlyRent),
    }))
    .filter((row) => row.periodStart && row.periodEnd && !isNaN(row.monthlyRent));
}

function buildClassificationTrace(result) {
  const classifications = {};
  for (const key of NNN_BUCKET_KEYS) {
    const fieldValue = result[key];
    if (fieldValue?.year1 != null) {
      classifications[key] = classifyExpenseLabel(key);
    }
  }
  return Object.keys(classifications).length > 0 ? classifications : null;
}

function buildDetectedOneTimeItems(result) {
  if (Array.isArray(result.oneTimeCharges) && result.oneTimeCharges.length > 0) {
    return result.oneTimeCharges
      .map((charge) => ({
        name: String(charge.label || charge.name || '').trim(),
        amount: String(charge.amount ?? 0),
        date: String(charge.dueDate || charge.date || ''),
      }))
      .filter((charge) => charge.name);
  }

  if (result.securityDeposit != null && result.securityDeposit > 0) {
    return [{
      name: 'Security Deposit',
      amount: String(result.securityDeposit),
      date: result.securityDepositDate ?? result.rentSchedule?.[0]?.periodStart ?? '',
    }];
  }

  return [];
}

export function buildPrepopulatedFormFromOCR(result, rows = []) {
  const {
    charges: builtCharges,
    confidenceFlags: chargeFlags,
    notices: chargeNotices,
  } = buildChargesFromOCR(result);

  const hasNNNFromRecurring = hasDetectedNNNCharges(result);
  const hasIndividualNNN =
    result.cams?.year1 != null ||
    result.insurance?.year1 != null ||
    result.taxes?.year1 != null;

  let nnnMode = 'individual';
  let nnnAggregateForm = { year1: '', escPct: '' };

  if (
    result.estimatedNNNMonthly != null &&
    !hasIndividualNNN &&
    !hasNNNFromRecurring
  ) {
    nnnMode = 'aggregate';
    nnnAggregateForm = {
      year1: String(result.estimatedNNNMonthly),
      escPct: '',
    };
  }

  let confidenceFlags = [
    ...(result.confidenceFlags ?? []),
    ...chargeFlags,
  ];
  if (nnnMode === 'aggregate') {
    confidenceFlags = [...confidenceFlags, 'nnnAggregate.year1'];
  }

  const generatedConcessions = buildOCRConcessionForms(result, rows);
  const detectedOneTimeItems = buildDetectedOneTimeItems(result);
  const notices = [
    ...(result.notices ?? []),
    ...chargeNotices,
    ...generatedConcessions.notices,
  ];

  const formState = {
    leaseName: result.leaseName ?? '',
    squareFootage: result.squareFootage != null ? String(result.squareFootage) : '',
    nnnMode,
    nnnAggregate: nnnAggregateForm,
    charges: builtCharges,
    freeRentEvents: generatedConcessions.freeRentEvents,
    abatementEvents: generatedConcessions.abatementEvents,
    legacyConcessionEvents:
      generatedConcessions.freeRentEvents.length === 0 && generatedConcessions.abatementEvents.length === 0
        ? buildLegacyConcessionEventsFromOCR(result, rows)
        : [],
    oneTimeItems: (result.oneTimeItems?.length ? result.oneTimeItems : detectedOneTimeItems).map((item) => ({
      label: item.label ?? item.name ?? '',
      date: item.dueDate ?? item.date ?? '',
      amount: item.amount != null
        ? String(Math.abs(item.amount) * (item.sign === -1 ? -1 : 1))
        : '',
    })),
  };

  return {
    formState,
    confidenceFlags,
    notices,
    sfRequired: result.sfRequired ?? false,
    labelClassifications: buildClassificationTrace(result),
  };
}
