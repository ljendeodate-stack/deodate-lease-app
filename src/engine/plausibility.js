/**
 * @fileoverview Plausibility checks for lease schedule data.
 *
 * Detects issues that don't necessarily prevent processing but indicate
 * the data may be incorrect, incomplete, or need manual review.
 * All functions are pure — no UI dependencies.
 *
 * Each check returns an array of { field, message, severity } objects.
 * severity: 'warning' (proceed but flag) | 'error' (should block)
 */

/**
 * @typedef {Object} PlausibilityIssue
 * @property {string} field    - Which field/area the issue relates to
 * @property {string} message  - Human-readable description
 * @property {'warning'|'error'} severity
 */

/**
 * Run all plausibility checks on a rent schedule.
 *
 * @param {{ periodStart: Date, periodEnd: Date, monthlyRent: number }[]} periodRows
 * @returns {PlausibilityIssue[]}
 */
export function checkSchedulePlausibility(periodRows) {
  const issues = [];
  if (!periodRows || periodRows.length === 0) return issues;

  issues.push(...checkScheduleGaps(periodRows));
  issues.push(...checkScheduleOverlaps(periodRows));
  issues.push(...checkRentValues(periodRows));
  issues.push(...checkDatePlausibility(periodRows));
  issues.push(...checkTermLength(periodRows));
  issues.push(...checkEscalationPattern(periodRows));

  return issues;
}

/**
 * Check for gaps > 30 days between consecutive periods.
 */
function checkScheduleGaps(periodRows) {
  const issues = [];
  const sorted = [...periodRows].sort((a, b) => a.periodStart - b.periodStart);

  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].periodEnd;
    const currStart = sorted[i].periodStart;
    if (!prevEnd || !currStart) continue;

    const gapDays = Math.round((currStart.getTime() - prevEnd.getTime()) / 86400000);
    if (gapDays > 31) {
      issues.push({
        field: 'rentSchedule',
        message: `${gapDays}-day gap between period ${i} (ending ${fmtDate(prevEnd)}) and period ${i + 1} (starting ${fmtDate(currStart)}). Is this intentional?`,
        severity: 'warning',
      });
    }
  }
  return issues;
}

/**
 * Check for overlapping periods.
 */
function checkScheduleOverlaps(periodRows) {
  const issues = [];
  const sorted = [...periodRows].sort((a, b) => a.periodStart - b.periodStart);

  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].periodEnd;
    const currStart = sorted[i].periodStart;
    if (!prevEnd || !currStart) continue;

    if (currStart.getTime() <= prevEnd.getTime()) {
      issues.push({
        field: 'rentSchedule',
        message: `Period ${i + 1} (starting ${fmtDate(currStart)}) overlaps with period ${i} (ending ${fmtDate(prevEnd)}).`,
        severity: 'warning',
      });
    }
  }
  return issues;
}

/**
 * Check for implausible rent values.
 */
function checkRentValues(periodRows) {
  const issues = [];
  for (let i = 0; i < periodRows.length; i++) {
    const rent = periodRows[i].monthlyRent;
    if (rent < 0) {
      issues.push({
        field: 'rentSchedule',
        message: `Period ${i + 1}: negative rent ($${rent.toFixed(2)}). Is this abatement or a credit?`,
        severity: 'warning',
      });
    }
    if (rent > 1000000) {
      issues.push({
        field: 'rentSchedule',
        message: `Period ${i + 1}: unusually high rent ($${rent.toLocaleString()}/month). Verify this is correct.`,
        severity: 'warning',
      });
    }
    if (rent > 0 && rent < 1) {
      issues.push({
        field: 'rentSchedule',
        message: `Period ${i + 1}: rent is $${rent.toFixed(2)}/month — this may be a $/SF value that needs multiplication.`,
        severity: 'warning',
      });
    }
  }
  return issues;
}

/**
 * Check for implausible dates.
 */
function checkDatePlausibility(periodRows) {
  const issues = [];
  const minYear = 1970;
  const maxYear = 2070;

  for (let i = 0; i < periodRows.length; i++) {
    const { periodStart, periodEnd } = periodRows[i];

    if (periodStart && (periodStart.getFullYear() < minYear || periodStart.getFullYear() > maxYear)) {
      issues.push({
        field: 'rentSchedule',
        message: `Period ${i + 1}: start date ${fmtDate(periodStart)} is outside plausible range (${minYear}–${maxYear}).`,
        severity: 'warning',
      });
    }

    if (periodEnd && (periodEnd.getFullYear() < minYear || periodEnd.getFullYear() > maxYear)) {
      issues.push({
        field: 'rentSchedule',
        message: `Period ${i + 1}: end date ${fmtDate(periodEnd)} is outside plausible range (${minYear}–${maxYear}).`,
        severity: 'warning',
      });
    }

    if (periodStart && periodEnd && periodEnd.getTime() < periodStart.getTime()) {
      issues.push({
        field: 'rentSchedule',
        message: `Period ${i + 1}: end date (${fmtDate(periodEnd)}) is before start date (${fmtDate(periodStart)}).`,
        severity: 'error',
      });
    }
  }
  return issues;
}

/**
 * Check for implausible lease term length.
 */
function checkTermLength(periodRows) {
  const issues = [];
  if (periodRows.length === 0) return issues;

  const sorted = [...periodRows].sort((a, b) => a.periodStart - b.periodStart);
  const firstStart = sorted[0].periodStart;
  const lastEnd    = sorted[sorted.length - 1].periodEnd;

  if (firstStart && lastEnd) {
    const years = (lastEnd.getTime() - firstStart.getTime()) / (365.25 * 86400000);
    if (years > 30) {
      issues.push({
        field: 'leaseTerm',
        message: `Lease term spans ${years.toFixed(1)} years. Terms over 30 years are unusual — verify dates are correct.`,
        severity: 'warning',
      });
    }
    if (years < 1 / 12) {
      issues.push({
        field: 'leaseTerm',
        message: `Lease term is less than 1 month. This may indicate missing periods.`,
        severity: 'warning',
      });
    }
  }
  return issues;
}

/**
 * Check for implausible escalation patterns between periods.
 */
function checkEscalationPattern(periodRows) {
  const issues = [];
  const sorted = [...periodRows].sort((a, b) => a.periodStart - b.periodStart);

  for (let i = 1; i < sorted.length; i++) {
    const prevRent = sorted[i - 1].monthlyRent;
    const currRent = sorted[i].monthlyRent;
    if (prevRent <= 0 || currRent <= 0) continue;

    const pctChange = (currRent - prevRent) / prevRent;
    if (pctChange > 0.15) {
      issues.push({
        field: 'rentSchedule',
        message: `Period ${i + 1}: rent increased ${(pctChange * 100).toFixed(1)}% from previous period. Escalations over 15% are unusual.`,
        severity: 'warning',
      });
    }
    if (pctChange < -0.5 && currRent > 0) {
      issues.push({
        field: 'rentSchedule',
        message: `Period ${i + 1}: rent decreased ${(Math.abs(pctChange) * 100).toFixed(1)}% from previous period. Verify this is intentional.`,
        severity: 'warning',
      });
    }
  }
  return issues;
}

/**
 * Run plausibility checks on NNN/charge parameters.
 *
 * @param {Object} params - Calculator params
 * @param {{ periodStart: string, periodEnd: string }[]} expandedRows - Monthly rows
 * @returns {PlausibilityIssue[]}
 */
export function checkParamsPlausibility(params, expandedRows) {
  const issues = [];
  if (!params) return issues;

  // Check abatement
  if (params.abatementPct > 0 && params.abatementPct < 100 && params.abatementPct !== 50) {
    issues.push({
      field: 'abatementPct',
      message: `Abatement percentage is ${params.abatementPct}%. Common values are 100% (full) or 50% (half). Verify this is correct.`,
      severity: 'warning',
    });
  }

  // Check coverage: what fraction of the lease term has rent data
  if (expandedRows && expandedRows.length > 0) {
    const zeroRentRows = expandedRows.filter((r) => (r.monthlyRent ?? 0) === 0 && !r.isAbatementRow).length;
    const zeroRatio = zeroRentRows / expandedRows.length;
    if (zeroRatio > 0.5) {
      issues.push({
        field: 'rentSchedule',
        message: `${(zeroRatio * 100).toFixed(0)}% of months have $0 rent (outside abatement). This may indicate missing rent data.`,
        severity: 'warning',
      });
    }
  }

  return issues;
}

function fmtDate(d) {
  if (!d) return '?';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}
