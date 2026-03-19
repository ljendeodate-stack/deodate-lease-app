/**
 * @fileoverview Confidence scoring for lease extraction results.
 *
 * Provides field-level and overall confidence scoring to help the app
 * decide whether to proceed normally or route the user to manual entry.
 *
 * All functions are pure — no UI dependencies.
 */

/**
 * @typedef {Object} ConfidenceResult
 * @property {number} overall          - 0.0 to 1.0 overall confidence
 * @property {'high'|'medium'|'low'} level
 * @property {string[]} reasons        - Why confidence is what it is
 * @property {Object<string, number>} fieldScores - Per-field confidence (0-1)
 */

/**
 * Score the confidence of an OCR extraction result.
 *
 * @param {import('../ocr/extractor.js').ExtractionResult} extractionResult
 * @param {{ periodStart: Date, periodEnd: Date, monthlyRent: number }[]} parsedSchedule
 *   The schedule rows after normalization (from parser or OCR).
 * @returns {ConfidenceResult}
 */
export function scoreExtraction(extractionResult, parsedSchedule) {
  const reasons = [];
  const fieldScores = {};

  // 1. Schedule completeness
  const scheduleRows = extractionResult?.rentSchedule ?? parsedSchedule ?? [];
  if (scheduleRows.length >= 3) {
    fieldScores.schedule = 1.0;
  } else if (scheduleRows.length > 0) {
    fieldScores.schedule = 0.5;
    reasons.push(`Only ${scheduleRows.length} rent period(s) extracted — typical leases have 3+.`);
  } else {
    fieldScores.schedule = 0.0;
    reasons.push('No rent schedule could be extracted.');
  }

  // 2. All rents are positive (or zero for abatement)
  const validRents = scheduleRows.filter((r) => {
    const rent = r.monthlyRent ?? r.monthlyBaseRent ?? 0;
    return typeof rent === 'number' && rent >= 0;
  });
  fieldScores.rentValues = scheduleRows.length > 0
    ? validRents.length / scheduleRows.length
    : 0;
  if (fieldScores.rentValues < 1.0) {
    reasons.push('Some rent values are missing or negative.');
  }

  // 3. OCR confidence flags
  const flagCount = extractionResult?.confidenceFlags?.length ?? 0;
  if (flagCount === 0) {
    fieldScores.ocrFlags = 1.0;
  } else if (flagCount <= 3) {
    fieldScores.ocrFlags = 0.6;
    reasons.push(`${flagCount} field(s) flagged with low OCR confidence.`);
  } else {
    fieldScores.ocrFlags = 0.2;
    reasons.push(`${flagCount} field(s) flagged — extraction may be unreliable.`);
  }

  // 4. Provider-reported confidence
  const providerConf = extractionResult?.overallConfidence ?? 'low';
  fieldScores.providerConfidence = providerConf === 'high' ? 1.0
    : providerConf === 'medium' ? 0.6
    : 0.2;
  if (providerConf === 'low') {
    reasons.push('OCR provider reported low extraction confidence.');
  }

  // 5. NNN data presence (optional, but boosts confidence if present)
  const hasNNN = ['cams', 'insurance', 'taxes'].some((key) => {
    const cat = extractionResult?.[key];
    return cat && (cat.year1 != null && cat.year1 > 0);
  });
  const hasAggNNN = (extractionResult?.estimatedNNNMonthly ?? 0) > 0;
  fieldScores.nnnData = hasNNN || hasAggNNN ? 1.0 : 0.5;
  if (!hasNNN && !hasAggNNN) {
    reasons.push('No NNN charge data extracted — will need manual entry.');
  }

  // 6. Date validity in schedule
  const validDates = (parsedSchedule ?? []).filter(
    (r) => r.periodStart instanceof Date && !isNaN(r.periodStart) &&
           r.periodEnd instanceof Date && !isNaN(r.periodEnd)
  );
  fieldScores.dateValidity = parsedSchedule && parsedSchedule.length > 0
    ? validDates.length / parsedSchedule.length
    : scheduleRows.length > 0 ? 0.5 : 0;
  if (fieldScores.dateValidity < 1.0 && parsedSchedule && parsedSchedule.length > 0) {
    const badCount = parsedSchedule.length - validDates.length;
    reasons.push(`${badCount} period row(s) have invalid or unparseable dates.`);
  }

  // Compute overall as weighted average
  const weights = {
    schedule: 3,
    rentValues: 2,
    ocrFlags: 1.5,
    providerConfidence: 1.5,
    nnnData: 0.5,
    dateValidity: 2,
  };

  let totalWeight = 0;
  let weightedSum = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (fieldScores[key] !== undefined) {
      weightedSum += fieldScores[key] * weight;
      totalWeight += weight;
    }
  }

  const overall = totalWeight > 0 ? weightedSum / totalWeight : 0;

  const level = overall >= 0.7 ? 'high'
    : overall >= 0.4 ? 'medium'
    : 'low';

  return { overall, level, reasons, fieldScores };
}

/**
 * Determine if the extraction confidence is too low to proceed without manual review.
 *
 * @param {ConfidenceResult} confidence
 * @returns {boolean} true if the app should route to manual fallback
 */
export function shouldFallbackToManual(confidence) {
  // Fallback if: overall below threshold OR schedule is empty
  return confidence.overall < 0.4 || confidence.fieldScores.schedule === 0;
}

/**
 * Build a summary of what was reliably extracted vs. what needs review.
 *
 * @param {import('../ocr/extractor.js').ExtractionResult} extractionResult
 * @param {ConfidenceResult} confidence
 * @returns {{ reliable: string[], uncertain: string[], missing: string[] }}
 */
export function categorizeFields(extractionResult, confidence) {
  const reliable = [];
  const uncertain = [];
  const missing = [];

  const flagSet = new Set(extractionResult?.confidenceFlags ?? []);

  // Schedule
  if (confidence.fieldScores.schedule >= 0.8) {
    reliable.push(`Rent schedule (${(extractionResult?.rentSchedule ?? []).length} periods)`);
  } else if (confidence.fieldScores.schedule > 0) {
    uncertain.push('Rent schedule (incomplete or may have issues)');
  } else {
    missing.push('Rent schedule');
  }

  // Basic fields
  const fields = [
    { key: 'leaseName',        label: 'Lease name' },
    { key: 'squareFootage',    label: 'Square footage' },
    { key: 'abatementEndDate', label: 'Abatement end date' },
    { key: 'abatementPct',     label: 'Abatement percentage' },
  ];

  for (const { key, label } of fields) {
    const val = extractionResult?.[key];
    if (val == null || val === '' || val === 0) {
      missing.push(label);
    } else if (flagSet.has(key)) {
      uncertain.push(label);
    } else {
      reliable.push(label);
    }
  }

  // NNN categories
  const nnnKeys = ['cams', 'insurance', 'taxes', 'security', 'otherItems'];
  for (const key of nnnKeys) {
    const cat = extractionResult?.[key];
    const label = key.charAt(0).toUpperCase() + key.slice(1);
    if (!cat || cat.year1 == null || cat.year1 === 0) {
      missing.push(`${label} charge`);
    } else if (flagSet.has(key) || flagSet.has(`${key}.year1`)) {
      uncertain.push(`${label} charge`);
    } else {
      reliable.push(`${label} charge`);
    }
  }

  return { reliable, uncertain, missing };
}
