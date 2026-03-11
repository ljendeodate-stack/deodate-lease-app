/**
 * @fileoverview UI-facing date formatting helpers.
 * Thin wrappers over Intl.DateTimeFormat for display purposes.
 * The engine-level date arithmetic lives in src/engine/yearMonth.js.
 */

/**
 * Format an ISO date string (YYYY-MM-DD) as MM/DD/YYYY for display.
 *
 * @param {string|null|undefined} isoDate
 * @returns {string}
 */
export function formatDateMDY(isoDate) {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.split('-');
  if (!y || !m || !d) return isoDate;
  return `${m}/${d}/${y}`;
}

/**
 * Format a Date object as MM/DD/YYYY.
 *
 * @param {Date|null} date
 * @returns {string}
 */
export function formatDateObjMDY(date) {
  if (!date) return '—';
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const y = date.getFullYear();
  return `${m}/${d}/${y}`;
}

/**
 * Return the number of calendar months between two ISO date strings (inclusive).
 *
 * @param {string} startISO - e.g. "2024-03-15"
 * @param {string} endISO
 * @returns {number}
 */
export function monthsBetween(startISO, endISO) {
  if (!startISO || !endISO) return 0;
  const [sy, sm] = startISO.split('-').map(Number);
  const [ey, em] = endISO.split('-').map(Number);
  return (ey - sy) * 12 + (em - sm) + 1;
}
