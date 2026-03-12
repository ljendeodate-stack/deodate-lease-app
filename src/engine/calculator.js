/**
 * @fileoverview Core lease obligation calculation engine.
 *
 * Replicates n8n node: "Calculate All Charges + Obligations"
 * with all Section 7 flaws corrected.
 *
 * Processing model:
 *   Pass 1 (forward)  — per-row charges, proration, abatement, periodFactor
 *   Pass 2 (reverse)  — remaining balance accumulation (last row → first row)
 *
 * No UI dependencies. All functions are pure given the same inputs.
 */

import {
  parseISODate,
  addMonthsAnchored,
  daysBetweenInclusive,
  toISOLocal,
} from './yearMonth.js';

// ---------------------------------------------------------------------------
// Internal pure helpers
// ---------------------------------------------------------------------------

/**
 * Compute the number of full escalation years elapsed between an anchor date
 * and a row's period start date.
 *
 * Returns null when no explicit startDate is provided — the caller must then
 * fall back to (leaseYear − 1) as the exponent, matching the n8n workflow
 * behaviour for charges with no explicit escalation start date.
 *
 * @param {Date} rowDate    - The anchor date for this monthly row.
 * @param {Date|null} startDate - The escalation start date (escStart from form).
 * @returns {number|null}   - Full years elapsed since startDate (≥ 0), or null.
 *
 * @n8nNode "Calculate All Charges + Obligations" → yearsSinceStart
 */
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

/**
 * Determine whether a charge category is active (billable) on a given date.
 * Returns true when no chargeStartDate is configured (charge is always active).
 *
 * @param {Date} rowDate              - Anchor date for the row.
 * @param {Date|null} chargeStartDate - Date when billing begins (chargeStart from form).
 * @returns {boolean}
 *
 * @n8nNode "Calculate All Charges + Obligations" → isChargeActive
 */
function isChargeActive(rowDate, chargeStartDate) {
  if (!chargeStartDate) return true;
  if (!rowDate) return false;
  return rowDate.getTime() >= chargeStartDate.getTime();
}

/**
 * Compute the base-rent proration factor for a single monthly row.
 *
 * Convention: `abatementEndDate` is the LAST day of abatement (inclusive),
 * matching standard lease language ("until June 30, 2018").
 * `rentStartDate` = abatementEndDate + 1 day = first day full rent is owed.
 *
 * Four cases:
 *   1. No abatement configured → factor = 1
 *   2. Row falls entirely within abatement (periodEnd ≤ abatementEndDate)
 *      → factor = tenantPaysFraction
 *   3. Row straddles the abatement boundary (periodStart ≤ abatementEndDate < periodEnd)
 *      → day-weighted blend: (abatedDays × tenantPaysFraction + fullRentDays × 1) / totalDays
 *   4. Row falls entirely after abatement (periodStart > abatementEndDate) → factor = 1
 *
 * @param {Date}      periodStart        - First day of the monthly anchor period.
 * @param {Date}      periodEnd          - Last day of the monthly anchor period.
 * @param {Date|null} abatementEndDate   - Last day of the abatement period (inclusive).
 * @param {number}    tenantPaysFraction - 1 − (abatementPct / 100).
 * @returns {number}                     - Proration factor in [0, 1].
 *
 * @n8nNode "Calculate All Charges + Obligations" → baseRentProrationFactor
 */
function baseRentProrationFactor(periodStart, periodEnd, abatementEndDate, tenantPaysFraction) {
  if (!abatementEndDate) return 1;

  // First day full rent is owed (one day after the last abated day)
  const rentStartDate = new Date(abatementEndDate.getTime() + 86400000);

  // Entire month after abatement ends
  if (rentStartDate.getTime() <= periodStart.getTime()) return 1;

  // Entire month still within abatement (periodEnd on or before last abated day)
  if (periodEnd.getTime() <= abatementEndDate.getTime()) return tenantPaysFraction;

  // Boundary month: straddles the abatement/full-rent transition
  const totalDays = daysBetweenInclusive(periodStart, periodEnd);
  if (totalDays <= 0) return 0;

  const abatementDays = daysBetweenInclusive(periodStart, abatementEndDate);
  const fullRentDays  = daysBetweenInclusive(rentStartDate, periodEnd);

  return (abatementDays * tenantPaysFraction + fullRentDays * 1) / totalDays;
}

/**
 * Compute the period factor for a single monthly row.
 *
 * Factor = 1.0 for all months except the final lease month when the expiry date
 * falls before the natural end of the final anchor cycle.
 * Final partial month factor = actualDays / calendarDaysInExpiryMonth.
 *
 * Returns metadata needed by the TracePanel to describe the proration.
 *
 * @param {number} rowIndex    - Zero-based index of this row in the sorted array.
 * @param {number} totalRows   - Total number of monthly rows.
 * @param {Date}   periodStart - Anchor start date for this row.
 * @param {Date|null} periodEnd - Explicit period end date (available on last row only).
 * @returns {{ factor: number, actualDays: number, calMonthDays: number }}
 *
 * @n8nNode "Calculate All Charges + Obligations" → periodFactor logic
 */
function computePeriodFactor(rowIndex, totalRows, periodStart, periodEnd) {
  const isLast = rowIndex === totalRows - 1;

  if (!isLast || !periodStart || !periodEnd) {
    return { factor: 1, actualDays: 1, calMonthDays: 1 };
  }

  // Natural end of the anchor month for this row
  const nextAnchor = addMonthsAnchored(periodStart, 1);
  const naturalEnd = new Date(nextAnchor.getTime() - 86400000);
  naturalEnd.setHours(0, 0, 0, 0);

  if (periodEnd.getTime() >= naturalEnd.getTime()) {
    // Lease expires at or after the natural anchor end — full month
    return { factor: 1, actualDays: 1, calMonthDays: 1 };
  }

  // Genuine partial final month — prorate by actual days over calendar days
  const calMonthStart = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1);
  const calMonthEnd   = new Date(periodEnd.getFullYear(), periodEnd.getMonth() + 1, 0);
  const calMonthDays  = daysBetweenInclusive(calMonthStart, calMonthEnd);
  const actualDays    = daysBetweenInclusive(periodStart, periodEnd);
  const factor        = actualDays / calMonthDays;

  return { factor, actualDays, calMonthDays };
}

/**
 * Compute the compounded annual charge amount for one NNN category in one row.
 * Applies the period factor to the result.
 *
 * @param {number}      year1      - Year 1 monthly base amount.
 * @param {number}      escRate    - Annual escalation rate as a decimal (e.g. 0.03).
 * @param {number|null} escYears   - Escalation year index from yearsSinceStart,
 *                                   or null to use (leaseYear − 1).
 * @param {number}      leaseYear  - The row's 'Year #' value (1-indexed).
 * @param {number}      periodFactor
 * @returns {number}               - Computed monthly charge amount.
 *
 * @n8nNode "Calculate All Charges + Obligations" → CAMS / Insurance / Taxes / Security / Other Items blocks
 */
function computeChargeAmount(year1, escRate, escYears, leaseYear, periodFactor) {
  const exponent = escYears !== null ? escYears : leaseYear - 1;
  return year1 * Math.pow(1 + escRate, exponent) * periodFactor;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Main calculation engine. Two-pass processing of expanded monthly rows.
 *
 * Pass 1 (forward): for each row, compute all charge amounts, proration factors,
 * abatement application, period factor, and per-row totals.
 *
 * Pass 2 (reverse): accumulate remaining balance totals from last row to first,
 * replicating the reverse-pass logic in the n8n workflow.
 *
 * @param {Object[]} expandedRows
 *   Monthly rows from expander.js. Each row must contain:
 *   { date: string, periodEnd: string|null, monthlyRent: number,
 *     year: number, 'Month #': number, 'Year #': number }
 *
 * @param {Object}    params
 * @param {number}    params.squareFootage
 * @param {Date|null} params.abatementEndDate
 * @param {number}    params.abatementPct        - 0–100 whole number (Flaw 4 fix: explicit).
 * @param {Object}    params.cams                - { year1, escPct, escStart, chargeStart }
 * @param {Object}    params.insurance
 * @param {Object}    params.taxes
 * @param {Object}    params.security
 * @param {Object}    params.otherItems
 *
 * @returns {Object[]} Processed ledger rows with all output fields populated.
 *
 * @n8nNode "Calculate All Charges + Obligations" (complete node, with all Section 7 corrections applied)
 */
export function calculateAllCharges(expandedRows, params) {
  if (!expandedRows || expandedRows.length === 0) return [];

  const {
    squareFootage,
    abatementEndDate,
    abatementPct,
    cams,
    insurance,
    taxes,
    security,
    otherItems,
    oneTimeItems = [],
  } = params;

  // Flaw 4 fix: convention explicitly enforced — 100 = full abatement (tenant pays 0).
  const tenantPaysFraction = 1 - (Math.min(Math.max(Number(abatementPct) || 0, 0), 100) / 100);

  // Pre-compute escalation rates as decimals
  const camsEsc       = (Number(cams.escPct)       || 0) / 100;
  const insuranceEsc  = (Number(insurance.escPct)  || 0) / 100;
  const taxesEsc      = (Number(taxes.escPct)      || 0) / 100;
  const securityEsc   = (Number(security.escPct)   || 0) / 100;
  const otherItemsEsc = (Number(otherItems.escPct) || 0) / 100;

  // Sort rows ascending by date (defensive — expander already sorts)
  const rows = expandedRows
    .map((r) => ({ ...r }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalRows = rows.length;

  // Collect unique OT labels in insertion order (non-zero items only).
  const seenOTLabels = new Set();
  const otLabelOrder = [];
  for (const item of oneTimeItems) {
    if (!(Number(item.amount) || 0)) continue;
    const lbl = String(item.label || '').trim() || 'One-time Charge';
    if (!seenOTLabels.has(lbl)) { seenOTLabels.add(lbl); otLabelOrder.push(lbl); }
  }

  // Pre-assign one-time items to row indices, tracked per label.
  // Items with no date go to row 0 (lease commencement).
  // Items before lease start → row 0; after lease end → last row.
  const oneTimeByRow = Array.from({ length: totalRows }, () => {
    const obj = {};
    for (const lbl of otLabelOrder) obj[lbl] = 0;
    return obj;
  });

  for (const item of oneTimeItems) {
    const amount = Number(item.amount) || 0;
    if (!amount) continue;
    const lbl = String(item.label || '').trim() || 'One-time Charge';

    if (!item.date) {
      oneTimeByRow[0][lbl] = (oneTimeByRow[0][lbl] || 0) + amount;
      continue;
    }

    let assigned = false;
    for (let i = 0; i < totalRows; i++) {
      const rowStart = parseISODate(rows[i].date);
      let rowEnd = null;
      if (i < totalRows - 1) {
        const nextStart = parseISODate(rows[i + 1].date);
        if (nextStart) rowEnd = new Date(nextStart.getTime() - 86400000);
      } else {
        rowEnd = rows[i].periodEnd ? parseISODate(rows[i].periodEnd) : null;
        if (!rowEnd && rowStart) {
          rowEnd = new Date(addMonthsAnchored(rowStart, 1).getTime() - 86400000);
        }
      }
      if (rowStart && rowEnd &&
          item.date.getTime() >= rowStart.getTime() &&
          item.date.getTime() <= rowEnd.getTime()) {
        oneTimeByRow[i][lbl] = (oneTimeByRow[i][lbl] || 0) + amount;
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      const leaseStart = parseISODate(rows[0].date);
      const targetRow = leaseStart && item.date < leaseStart ? 0 : totalRows - 1;
      oneTimeByRow[targetRow][lbl] = (oneTimeByRow[targetRow][lbl] || 0) + amount;
    }
  }

  // -------------------------------------------------------------------------
  // Pass 1: forward — compute all per-row values
  // -------------------------------------------------------------------------
  for (let i = 0; i < totalRows; i++) {
    const row = rows[i];

    const leaseYear  = Number(row['Year #']  || 1);
    const leaseMonth = Number(row['Month #'] || i + 1);

    const periodStart = parseISODate(row.date);

    // Derive periodEnd: next row's date − 1 day for non-final rows;
    // the explicit periodEnd from the expander for the final row.
    let periodEnd = null;
    if (i < totalRows - 1) {
      const nextDate = parseISODate(rows[i + 1].date);
      if (nextDate) {
        periodEnd = new Date(nextDate.getTime() - 86400000);
        periodEnd.setHours(0, 0, 0, 0);
      }
    } else {
      // Final row: use explicit periodEnd if present, else treat as full anchor month
      if (row.periodEnd) {
        periodEnd = parseISODate(row.periodEnd);
      }
      if (!periodEnd && periodStart) {
        const nextAnchor = addMonthsAnchored(periodStart, 1);
        periodEnd = new Date(nextAnchor.getTime() - 86400000);
        periodEnd.setHours(0, 0, 0, 0);
      }
    }

    // --- Period factor ---
    const { factor: periodFactor, actualDays, calMonthDays } =
      computePeriodFactor(i, totalRows, periodStart, periodEnd);

    // --- Base rent proration and abatement ---
    const scheduledBaseRent = Number(row.monthlyRent || 0);
    let baseFactor = 1;
    let prorationBasis = 'full';
    let abatementDays = 0;
    let fullRentDays = 0;
    let totalDays = 0;

    if (abatementEndDate && periodStart && periodEnd) {
      // abatementEndDate = last day of abatement (inclusive).
      // rentStartDate    = first day full rent is owed.
      const rentStartDate = new Date(abatementEndDate.getTime() + 86400000);

      if (rentStartDate.getTime() <= periodStart.getTime()) {
        // Entire month is post-abatement
        baseFactor = 1;
        prorationBasis = 'full';
      } else if (periodEnd.getTime() <= abatementEndDate.getTime()) {
        // Entire month is within abatement (periodEnd on or before last abated day)
        baseFactor = tenantPaysFraction;
        prorationBasis = 'full'; // full abatement application, not a blend
      } else {
        // Boundary month: straddles the abatement/full-rent transition
        totalDays     = daysBetweenInclusive(periodStart, periodEnd);
        abatementDays = daysBetweenInclusive(periodStart, abatementEndDate);
        fullRentDays  = daysBetweenInclusive(rentStartDate, periodEnd);
        prorationBasis = 'abatement-boundary';
        baseFactor = baseRentProrationFactor(periodStart, periodEnd, abatementEndDate, tenantPaysFraction);
      }
    } else if (abatementEndDate && periodStart && !periodEnd) {
      baseFactor = periodStart.getTime() <= abatementEndDate.getTime() ? tenantPaysFraction : 1;
    }

    // Apply period factor on top of the base proration factor
    const combinedProrationFactor = baseFactor * periodFactor;

    // Detect final partial month for trace panel
    if (i === totalRows - 1 && periodFactor < 1) {
      prorationBasis = 'final-month';
    }

    const baseRentApplied = scheduledBaseRent * combinedProrationFactor;
    // A row is an abatement row when its entire period falls on or before the
    // last abated day (abatementEndDate inclusive). Boundary months that straddle
    // the transition are NOT highlighted amber — they show a partial charge.
    const isAbatementRow  = abatementEndDate !== null &&
                            periodEnd !== null &&
                            periodEnd.getTime() <= abatementEndDate.getTime();

    // --- NNN charges: gate, escalate, apply periodFactor ---

    // CAMS
    const camsActive  = isChargeActive(periodStart, cams.chargeStart);
    const camsEscYears = camsActive ? yearsSinceStart(periodStart, cams.escStart) : null;
    const camsAmount  = camsActive
      ? Number(computeChargeAmount(Number(cams.year1) || 0, camsEsc, camsEscYears, leaseYear, periodFactor).toFixed(2))
      : 0;

    // Insurance
    const insuranceActive   = isChargeActive(periodStart, insurance.chargeStart);
    const insuranceEscYears = insuranceActive ? yearsSinceStart(periodStart, insurance.escStart) : null;
    const insuranceAmount   = insuranceActive
      ? Number(computeChargeAmount(Number(insurance.year1) || 0, insuranceEsc, insuranceEscYears, leaseYear, periodFactor).toFixed(2))
      : 0;

    // Taxes
    const taxesActive   = isChargeActive(periodStart, taxes.chargeStart);
    const taxesEscYears = taxesActive ? yearsSinceStart(periodStart, taxes.escStart) : null;
    const taxesAmount   = taxesActive
      ? Number(computeChargeAmount(Number(taxes.year1) || 0, taxesEsc, taxesEscYears, leaseYear, periodFactor).toFixed(2))
      : 0;

    // Security
    const securityActive   = isChargeActive(periodStart, security.chargeStart);
    const securityEscYears = securityActive ? yearsSinceStart(periodStart, security.escStart) : null;
    const securityAmount   = securityActive
      ? Number(computeChargeAmount(Number(security.year1) || 0, securityEsc, securityEscYears, leaseYear, periodFactor).toFixed(2))
      : 0;

    // Other Items
    const otherItemsActive   = isChargeActive(periodStart, otherItems.chargeStart);
    const otherItemsEscYears = otherItemsActive ? yearsSinceStart(periodStart, otherItems.escStart) : null;
    const otherItemsAmount   = otherItemsActive
      ? Number(computeChargeAmount(Number(otherItems.year1) || 0, otherItemsEsc, otherItemsEscYears, leaseYear, periodFactor).toFixed(2))
      : 0;

    // True NNN = CAMS + Insurance + Taxes only.
    // Security and Other Items are "Other Charges", not NNN.
    const trueNNN = camsAmount + insuranceAmount + taxesAmount;

    const oneTimeItemAmounts = oneTimeByRow[i];  // { [label]: amount }
    const oneTimeChargesAmount = Number(
      Object.values(oneTimeItemAmounts).reduce((s, v) => s + v, 0).toFixed(2)
    );

    // Other Charges bucket = Security + Other Items + all one-time items
    const totalOtherChargesAmount = Number(
      (securityAmount + otherItemsAmount + oneTimeChargesAmount).toFixed(2)
    );

    const totalMonthlyObligation = Number(
      (Number(baseRentApplied.toFixed(2)) + trueNNN + totalOtherChargesAmount).toFixed(2)
    );

    const effectivePerSF =
      squareFootage > 0 ? Number((totalMonthlyObligation / squareFootage).toFixed(6)) : null;

    // Assign all computed fields back to the row
    Object.assign(row, {
      // Identity
      periodStart: toISOLocal(periodStart),
      periodEnd:   periodEnd ? toISOLocal(periodEnd) : null,
      leaseYear,
      leaseMonth,

      // Base rent
      scheduledBaseRent:       Number(scheduledBaseRent.toFixed(2)),
      baseRentApplied:         Number(baseRentApplied.toFixed(2)),
      baseRentProrationFactor: Number(combinedProrationFactor.toFixed(6)),
      isAbatementRow,

      // Trace fields
      periodFactor:    Number(periodFactor.toFixed(6)),
      prorationBasis,
      abatementDays,
      fullRentDays,
      totalDays,
      actualDays,
      calMonthDays,

      // CAMS
      camsAmount,
      camsEscPct:   Number(cams.escPct) || 0,
      camsEscYears,
      camsActive,

      // Insurance
      insuranceAmount,
      insuranceEscPct:   Number(insurance.escPct) || 0,
      insuranceEscYears,
      insuranceActive,

      // Taxes
      taxesAmount,
      taxesEscPct:   Number(taxes.escPct) || 0,
      taxesEscYears,
      taxesActive,

      // Security
      securityAmount,
      securityEscPct:   Number(security.escPct) || 0,
      securityEscYears,
      securityActive,

      // Other Items
      otherItemsAmount,
      otherItemsEscPct:   Number(otherItems.escPct) || 0,
      otherItemsEscYears,
      otherItemsActive,

      // One-time charges
      oneTimeItemAmounts,
      oneTimeChargesAmount,

      // Charge buckets (used for remaining-balance computation in Pass 2)
      totalOtherChargesAmount,

      // Totals
      totalMonthlyObligation,
      effectivePerSF,

      // Remaining balance fields — populated in Pass 2
      totalObligationRemaining:   0,
      totalNNNRemaining:          0,
      totalBaseRentRemaining:     0,
      totalOtherChargesRemaining: 0,
    });
  }

  // -------------------------------------------------------------------------
  // Pass 2: reverse — accumulate remaining balances (last row → first row)
  // Matches the n8n second-pass logic exactly.
  // -------------------------------------------------------------------------
  let runningTotal        = 0;
  let runningNNN          = 0;   // CAMS + Insurance + Taxes only
  let runningBase         = 0;
  let runningOtherCharges = 0;   // Security + Other Items + one-time items

  for (let i = totalRows - 1; i >= 0; i--) {
    const row = rows[i];

    runningTotal        += row.totalMonthlyObligation;
    runningNNN          += (row.camsAmount + row.insuranceAmount + row.taxesAmount);
    runningBase         += row.baseRentApplied;
    runningOtherCharges += row.totalOtherChargesAmount;

    row.totalObligationRemaining   = Number(runningTotal.toFixed(2));
    row.totalNNNRemaining          = Number(runningNNN.toFixed(2));
    row.totalBaseRentRemaining     = Number(runningBase.toFixed(2));
    row.totalOtherChargesRemaining = Number(runningOtherCharges.toFixed(2));
  }

  return rows;
}
