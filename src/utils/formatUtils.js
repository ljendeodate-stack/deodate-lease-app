/**
 * @fileoverview Number formatting helpers for UI display.
 *
 * Flaw 3 fix: all dollar amounts display to 2 decimal places with currency symbol,
 * percentages to 2 decimal places with % symbol, $/SF to 4 decimal places.
 * Raw unformatted values are preserved in the underlying data for export.
 */

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const USD4 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

/**
 * Format a number as a USD dollar amount: "$1,234.56"
 *
 * @param {number|null|undefined} value
 * @returns {string}
 */
export function formatDollar(value) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return USD.format(value);
}

/**
 * Format a $/SF value to 4 decimal places: "$12.3456"
 *
 * @param {number|null|undefined} value
 * @returns {string}
 */
export function formatDollarPerSF(value) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return USD4.format(value);
}

/**
 * Format a percentage (stored as a whole number e.g. 3 → "3.00%").
 *
 * @param {number|null|undefined} value - Whole number (e.g. 3 for 3%).
 * @returns {string}
 */
export function formatPercent(value) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return `${Number(value).toFixed(2)}%`;
}

/**
 * Format a proration/period factor decimal to 6 decimal places.
 *
 * @param {number|null|undefined} value
 * @returns {string}
 */
export function formatFactor(value) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return Number(value).toFixed(6);
}

/**
 * Format a large number with commas but no currency symbol.
 *
 * @param {number|null|undefined} value
 * @returns {string}
 */
export function formatNumber(value) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US').format(value);
}
