/**
 * @fileoverview Pure date/month arithmetic utilities.
 *
 * Replicates logic from n8n node: "Expand Periods to Monthly Rows"
 * (functions: parseExcelDate, addMonthsAnchored, countMonthsInclusive)
 * and "Calculate All Charges + Obligations"
 * (functions: parseMDYStrict, addMonthsNoOverflow, daysBetweenInclusive)
 *
 * No UI dependencies. All functions are pure (no side effects).
 */

/**
 * Parse an Excel serial number, a numeric string serial, or a date string
 * into a Date normalised to midnight local time.
 *
 * @param {number|string|null|undefined} val - Excel serial, date string, or null/undefined.
 * @returns {Date|null} Midnight-local Date, or null if unparseable.
 *
 * @n8nNode "Expand Periods to Monthly Rows" → parseExcelDate
 */
export function parseExcelDate(val) {
  if (val === null || val === undefined || val === '') return null;

  // Excel serial number (numeric type)
  if (typeof val === 'number' && !isNaN(val)) {
    const d = new Date((val - 25569) * 86400 * 1000);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // Numeric string that is an Excel serial
  if (typeof val === 'string' && val.trim() !== '' && !isNaN(Number(val))) {
    const n = Number(val);
    const d = new Date((n - 25569) * 86400 * 1000);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // General date string (ISO, locale, etc.)
  const d = new Date(val);
  if (isNaN(d)) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Parse an ISO date string (YYYY-MM-DD) to a Date at midnight local time.
 *
 * @param {string|null|undefined} val
 * @returns {Date|null}
 *
 * @n8nNode "Calculate All Charges + Obligations" → parseISODate
 */
export function parseISODate(val) {
  if (!val) return null;
  // Parse as local time by splitting components to avoid UTC offset shifts
  const parts = String(val).split('-');
  if (parts.length === 3) {
    const y = Number(parts[0]);
    const m = Number(parts[1]) - 1;
    const d = Number(parts[2]);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      const dt = new Date(y, m, d);
      dt.setHours(0, 0, 0, 0);
      return isNaN(dt) ? null : dt;
    }
  }
  const dt = new Date(val);
  if (isNaN(dt)) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
}

/**
 * Strict MM/DD/YYYY date parser. Returns null on any format mismatch.
 *
 * @param {string|null|undefined} val
 * @returns {Date|null}
 *
 * @n8nNode "Calculate All Charges + Obligations" → parseMDYStrict
 */
export function parseMDYStrict(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  const yyyy = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const d = new Date(yyyy, mm - 1, dd);
  if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Add N months to a date, anchored to the original day-of-month.
 * When the target month is shorter than the anchor day, snaps to the last day
 * of the target month (e.g. Jan 31 + 1 month → Feb 28/29).
 *
 * @param {Date} anchorDate - The reference date whose day-of-month is preserved.
 * @param {number} monthsToAdd - Integer number of months to add (may be 0).
 * @returns {Date} New Date at midnight local time.
 *
 * @n8nNode "Expand Periods to Monthly Rows" → addMonthsAnchored
 */
export function addMonthsAnchored(anchorDate, monthsToAdd) {
  const y = anchorDate.getFullYear();
  const m = anchorDate.getMonth();
  const dom = anchorDate.getDate();

  const target = new Date(y, m + monthsToAdd, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(dom, lastDay));
  target.setHours(0, 0, 0, 0);
  return target;
}

/**
 * Alias for addMonthsAnchored — used in charge calculation context.
 *
 * @param {Date} d
 * @param {number} months
 * @returns {Date}
 *
 * @n8nNode "Calculate All Charges + Obligations" → addMonthsNoOverflow
 */
export function addMonthsNoOverflow(d, months) {
  return addMonthsAnchored(d, months);
}

/**
 * Count how many anchored month-start dates fall within [start, end] inclusive.
 *
 * @param {Date} start - The anchor commencement date.
 * @param {Date} end   - The lease expiry date (inclusive upper bound).
 * @returns {number}   - Number of months (always ≥ 1 when start ≤ end).
 *
 * @n8nNode "Expand Periods to Monthly Rows" → countMonthsInclusive
 */
export function countMonthsInclusive(start, end) {
  if (end.getTime() < start.getTime()) return 0;

  let md =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());

  if (md < 0) return 0;

  const candidate = addMonthsAnchored(start, md);
  if (candidate.getTime() > end.getTime()) md -= 1;

  return md + 1;
}

/**
 * Count calendar days between two dates, inclusive of both endpoints.
 *
 * @param {Date} a - Start date.
 * @param {Date} b - End date (must be ≥ a).
 * @returns {number}
 *
 * @n8nNode "Calculate All Charges + Obligations" → daysBetweenInclusive
 */
export function daysBetweenInclusive(a, b) {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / 86400000) + 1;
}

/**
 * Format a Date as an ISO date string (YYYY-MM-DD) in local time.
 *
 * @param {Date} d
 * @returns {string}
 */
export function toISOLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
