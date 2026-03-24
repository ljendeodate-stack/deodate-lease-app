const REQUIRED_HEADERS = [
  'Period Start',
  'Period End',
  'Lease Year',
  'Months',
  'Base Rent Applied',
  'Total NNN',
  'Total Monthly Obligation',
  '% of Grand Total',
];

function check(name, passed, details, severity = 'error') {
  return { name, passed, details, severity };
}

/**
 * Evaluate an Annual Summary fixture result.
 *
 * @param {object} fixture  — fixture definition (expected values)
 * @param {object} summary  — output from readAnnualSummaryWorkbook()
 * @returns {{ fixtureId, passed, checks }}
 */
export function evaluateAnnualSummaryFixture(fixture, summary) {
  const checks = [];
  const fs = summary.formulaSemantics;

  // ── C1: No formula errors ─────────────────────────────────────────────────
  checks.push(check(
    'no-formula-errors',
    summary.formulaErrors.length === 0,
    summary.formulaErrors.length === 0
      ? 'No explicit formula error cells in Annual Summary.'
      : `Formula errors at: ${summary.formulaErrors.map((e) => e.address).join(', ')}.`,
  ));

  // ── C2: Required headers present ─────────────────────────────────────────
  const headerValues = summary.headers.map((h) => h.value);
  const missingHeaders = REQUIRED_HEADERS.filter((h) => !headerValues.includes(h));
  checks.push(check(
    'required-headers-present',
    missingHeaders.length === 0,
    missingHeaders.length === 0
      ? `All ${REQUIRED_HEADERS.length} required headers are present.`
      : `Missing headers: ${missingHeaders.join(', ')}.`,
  ));

  // ── C3: Year row count matches fixture expectation ────────────────────────
  const expectedYears = fixture.expected?.yearCount ?? null;
  if (expectedYears !== null) {
    checks.push(check(
      'year-row-count',
      summary.yearCount === expectedYears,
      `Annual Summary has ${summary.yearCount} year row(s); expected ${expectedYears}.`,
    ));
  }

  // ── C4: Cross-sheet formulas reference 'Lease Schedule' ──────────────────
  checks.push(check(
    'references-lease-schedule',
    fs.referencesLeaseSchedule,
    fs.referencesLeaseSchedule
      ? "Cross-sheet formulas reference 'Lease Schedule'."
      : "Cross-sheet formulas do NOT reference 'Lease Schedule'.",
  ));

  // ── C5: No legacy sheet name ──────────────────────────────────────────────
  checks.push(check(
    'no-legacy-sheet-name',
    fs.noLegacySheetName,
    fs.noLegacySheetName
      ? "No reference to legacy 'Lease Schedule (populated)' found."
      : "LEGACY sheet name 'Lease Schedule (populated)' detected in formulas.",
  ));

  // ── C6: Base rent uses correct column (F = baseRentApplied, always fixed) ─
  checks.push(check(
    'base-rent-col-correct',
    fs.baseRentUsesLeaseScheduleF,
    fs.baseRentUsesLeaseScheduleF
      ? 'Base Rent Applied SUMIF references column F (baseRentApplied) as expected.'
      : 'Base Rent Applied SUMIF does NOT reference column F — possible column mismatch.',
  ));

  // ── C7: Year# lookup column present (D = yearNum, always fixed) ───────────
  checks.push(check(
    'year-num-col-correct',
    fs.yearNumUsesLeaseScheduleD,
    fs.yearNumUsesLeaseScheduleD
      ? 'SUMIF/COUNTIF lookup key references column D (Lease Year #) as expected.'
      : 'SUMIF/COUNTIF lookup key does NOT reference column D — possible column mismatch.',
  ));

  // ── C8: SUMIF used for value columns ─────────────────────────────────────
  checks.push(check(
    'sumif-used-for-values',
    fs.sumifUsedForValues,
    fs.sumifUsedForValues
      ? 'SUMIF formula pattern confirmed for annual value aggregation.'
      : 'Expected SUMIF formula not found in value column.',
  ));

  // ── C9: COUNTIF used for Months column ───────────────────────────────────
  checks.push(check(
    'countif-used-for-months',
    fs.countifUsedForMonths,
    fs.countifUsedForMonths
      ? 'COUNTIF formula confirmed for Months aggregation.'
      : 'Expected COUNTIF formula not found in Months column.',
  ));

  // ── C10: % of Grand Total formula references the grand total row ──────────
  checks.push(check(
    'pct-formula-refs-total-row',
    fs.pctFormulaRefsTotRow,
    fs.pctFormulaRefsTotRow
      ? '% of Grand Total formula correctly references the grand total row.'
      : '% of Grand Total formula does not reference the grand total row — may produce incorrect percentages.',
  ));

  // ── C11: Grand total label ────────────────────────────────────────────────
  const grandTotalLabel = summary.totalRow.label?.value ?? '';
  checks.push(check(
    'grand-total-label',
    /grand total/i.test(grandTotalLabel),
    `/grand total/i test on label "${grandTotalLabel}".`,
  ));

  // ── C12: Month counts are plausible (style warning) ──────────────────────
  if (summary.yearRows.length > 0) {
    const { grandTotalMonths } = summary.expectedTotals;
    checks.push(check(
      'month-count-plausible',
      grandTotalMonths > 0,
      `Total processed rows: ${grandTotalMonths}. Expected at least 1 month.`,
      'warning',
    ));
  }

  return {
    fixtureId: fixture.id,
    passed: checks.every((item) => item.passed || item.severity === 'warning'),
    checks,
  };
}
