/**
 * @fileoverview Pure engine helper that derives Renegotiation and Exit
 * scenario tables from processed ledger rows.
 *
 * No UI dependencies. All functions are pure given the same inputs.
 *
 * Business logic sources:
 *   - Renegotiation checkpoints: each lease anniversary + 12, 9, 6, 3 months
 *     before lease expiration.
 *   - Exit checkpoints: each lease anniversary + lease expiration.
 *   - Buyout tier percentages (20%, 35%, 50%) and renegotiation discount
 *     percentages (10%, 30%, 50%) are derived from the reference spec at
 *     reference/LEASE_OUTPUT_TABLES_INSTRUCTIONS.md.
 *
 * Remaining-balance values reuse the reverse-pass fields already present
 * on each processed row:
 *   totalObligationRemaining, totalBaseRentRemaining,
 *   totalNNNRemaining, totalOtherChargesRemaining
 */

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse an ISO date string (YYYY-MM-DD) to a Date at midnight local time.
 */
function parseISO(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/**
 * Format a Date to ISO string YYYY-MM-DD.
 */
function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Add N months to a date, clamping day-of-month to the last valid day.
 */
function addMonths(date, n) {
  const result = new Date(date.getFullYear(), date.getMonth() + n, date.getDate());
  // If day overflowed (e.g. Jan 31 + 1 month = Mar 3), clamp to last day of target month
  if (result.getDate() !== date.getDate()) {
    return new Date(date.getFullYear(), date.getMonth() + n + 1, 0);
  }
  return result;
}

/**
 * Find the first row whose periodStart is on or after the given date.
 * Returns null if no such row exists (checkpoint is after lease end).
 */
function findRowAtOrAfter(rows, targetDate) {
  const targetTime = targetDate.getTime();
  for (const row of rows) {
    const rowDate = parseISO(row.periodStart);
    if (rowDate && rowDate.getTime() >= targetTime) return row;
  }
  return null;
}

/**
 * Deduplicate checkpoints by ISO date string, preserving insertion order
 * and preferring earlier entries. Also filters out dates before lease start
 * or after lease end + 1 month.
 */
function deduplicateCheckpoints(checkpoints, leaseStartISO, leaseEndISO) {
  const startDate = parseISO(leaseStartISO);
  const endDate = parseISO(leaseEndISO);
  if (!startDate || !endDate) return checkpoints;

  const endPlusMonth = addMonths(endDate, 1);
  const seen = new Set();
  const result = [];

  for (const cp of checkpoints) {
    const cpDate = parseISO(cp.date);
    if (!cpDate) continue;
    if (cpDate < startDate) continue;
    if (cpDate > endPlusMonth) continue;
    if (seen.has(cp.date)) continue;
    seen.add(cp.date);
    result.push(cp);
  }

  return result;
}

// ── Renegotiation Table ─────────────────────────────────────────────────────

/**
 * Derive the renegotiation checkpoint table.
 *
 * Checkpoints are generated at:
 *   - Each lease anniversary (commencement date + N years)
 *   - 12, 9, 6, and 3 months before lease expiration
 *
 * @param {object[]} rows — processed rows from calculateAllCharges()
 * @returns {object[]} Array of renegotiation checkpoint objects.
 */
export function buildRenegotiationTable(rows) {
  if (!rows || rows.length === 0) return [];

  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];
  const leaseStart = parseISO(firstRow.periodStart);
  const leaseEnd = parseISO(lastRow.periodEnd ?? lastRow.periodStart);
  if (!leaseStart || !leaseEnd) return [];

  const totalMonths = rows.length;

  // Full-term totals from first row's remaining balances
  const fullTermTotal = firstRow.totalObligationRemaining ?? 0;

  // Generate anniversary checkpoints
  const checkpoints = [];
  for (let year = 1; ; year++) {
    const annivDate = addMonths(leaseStart, year * 12);
    if (annivDate > leaseEnd) break;
    checkpoints.push({ date: toISO(annivDate), label: `Year ${year} Anniversary` });
  }

  // Generate pre-expiration checkpoints
  for (const monthsBefore of [12, 9, 6, 3]) {
    const cpDate = addMonths(leaseEnd, -monthsBefore);
    if (cpDate >= leaseStart) {
      checkpoints.push({
        date: toISO(cpDate),
        label: `${monthsBefore} Mo. Before Expiration`,
      });
    }
  }

  // Sort by date
  checkpoints.sort((a, b) => a.date.localeCompare(b.date));

  // Deduplicate
  const unique = deduplicateCheckpoints(checkpoints, firstRow.periodStart, lastRow.periodEnd ?? lastRow.periodStart);

  // Map to output rows
  return unique.map((cp) => {
    const cpDate = parseISO(cp.date);
    const matchRow = findRowAtOrAfter(rows, cpDate);

    if (!matchRow) {
      // Checkpoint is after the final lease month
      return {
        label: cp.label,
        checkpointDate: cp.date,
        monthsRemaining: 0,
        baseRentRemaining: 0,
        nnnRemaining: 0,
        otherChargesRemaining: 0,
        totalRemainingObligation: 0,
        avgMonthlyRemaining: 0,
      };
    }

    // Find index of matched row to compute months remaining
    const matchIdx = rows.indexOf(matchRow);
    const monthsRemaining = totalMonths - matchIdx;

    const baseRem = matchRow.totalBaseRentRemaining ?? 0;
    const nnnRem = matchRow.totalNNNRemaining ?? 0;
    const otherRem = matchRow.totalOtherChargesRemaining ?? 0;
    const totalRem = matchRow.totalObligationRemaining ?? 0;
    const avgMonthly = monthsRemaining > 0 ? totalRem / monthsRemaining : 0;

    return {
      label: cp.label,
      checkpointDate: cp.date,
      monthsRemaining,
      baseRentRemaining: baseRem,
      nnnRemaining: nnnRem,
      otherChargesRemaining: otherRem,
      totalRemainingObligation: totalRem,
      avgMonthlyRemaining: avgMonthly,
    };
  });
}

// ── Exit Table ──────────────────────────────────────────────────────────────

/**
 * Derive the exit (early termination) analysis table.
 *
 * Checkpoints are generated at:
 *   - Each lease anniversary (commencement date + N years)
 *   - Lease expiration date
 *
 * "Paid to date" values are derived by subtracting remaining balances
 * from full-term totals.
 *
 * @param {object[]} rows — processed rows from calculateAllCharges()
 * @returns {object[]} Array of exit checkpoint objects.
 */
export function buildExitTable(rows) {
  if (!rows || rows.length === 0) return [];

  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];
  const leaseStart = parseISO(firstRow.periodStart);
  const leaseEnd = parseISO(lastRow.periodEnd ?? lastRow.periodStart);
  if (!leaseStart || !leaseEnd) return [];

  const totalMonths = rows.length;

  // Full-term totals from first row
  const fullTermBase = firstRow.totalBaseRentRemaining ?? 0;
  const fullTermTotal = firstRow.totalObligationRemaining ?? 0;

  // Generate anniversary checkpoints
  const checkpoints = [];
  for (let year = 1; ; year++) {
    const annivDate = addMonths(leaseStart, year * 12);
    if (annivDate > leaseEnd) break;
    checkpoints.push({ date: toISO(annivDate), label: `Year ${year}` });
  }

  // Add lease expiration
  checkpoints.push({ date: toISO(leaseEnd), label: 'Lease Expiration' });

  // Sort and deduplicate
  checkpoints.sort((a, b) => a.date.localeCompare(b.date));
  const unique = deduplicateCheckpoints(checkpoints, firstRow.periodStart, lastRow.periodEnd ?? lastRow.periodStart);

  return unique.map((cp) => {
    const cpDate = parseISO(cp.date);
    const matchRow = findRowAtOrAfter(rows, cpDate);

    if (!matchRow) {
      // Past end of lease
      return {
        label: cp.label,
        exitDate: cp.date,
        monthsElapsed: totalMonths,
        monthsRemaining: 0,
        basePaidToDate: fullTermBase,
        totalPaidToDate: fullTermTotal,
        baseRentRemaining: 0,
        totalRemainingObligation: 0,
      };
    }

    const matchIdx = rows.indexOf(matchRow);
    const monthsElapsed = matchIdx;
    const monthsRemaining = totalMonths - matchIdx;

    const baseRem = matchRow.totalBaseRentRemaining ?? 0;
    const totalRem = matchRow.totalObligationRemaining ?? 0;

    return {
      label: cp.label,
      exitDate: cp.date,
      monthsElapsed,
      monthsRemaining,
      basePaidToDate: fullTermBase - baseRem,
      totalPaidToDate: fullTermTotal - totalRem,
      baseRentRemaining: baseRem,
      totalRemainingObligation: totalRem,
    };
  });
}
