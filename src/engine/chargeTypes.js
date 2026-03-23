/**
 * @fileoverview Dynamic charge type definitions and factory functions.
 *
 * Replaces the hardcoded five-category model with a dynamic charge collection
 * that supports user-defined charges with canonical type routing.
 *
 * Each charge object carries:
 *   key            — stable internal identifier (e.g. 'cams', 'custom_1')
 *   canonicalType  — 'nnn' or 'other' (determines Total NNN vs Other Charges grouping)
 *   displayLabel   — user-facing label (preserved in export headers and Word doc)
 *   year1          — Year 1 monthly amount
 *   escPct         — annual escalation rate (percentage, e.g. 3 for 3%)
 *   escStart       — escalation start date (Date or string depending on layer)
 *   chargeStart    — billing start date
 */

/** Canonical charge type constants. */
export const CANONICAL_TYPES = {
  NNN: 'nnn',
  OTHER: 'other',
};

/**
 * Returns the five standard charge objects with string values for form state.
 * @returns {Array<{key: string, canonicalType: string, displayLabel: string, year1: string, escPct: string, escStart: string, chargeStart: string}>}
 */
export function defaultChargesForm() {
  return [
    { key: 'cams',       canonicalType: 'nnn',   displayLabel: 'CAMS',        year1: '', escPct: '', escStart: '', chargeStart: '' },
    { key: 'insurance',  canonicalType: 'nnn',   displayLabel: 'Insurance',   year1: '', escPct: '', escStart: '', chargeStart: '' },
    { key: 'taxes',      canonicalType: 'nnn',   displayLabel: 'Taxes',       year1: '', escPct: '', escStart: '', chargeStart: '' },
    { key: 'security',   canonicalType: 'other', displayLabel: 'Security',    year1: '', escPct: '', escStart: '', chargeStart: '' },
    { key: 'otherItems', canonicalType: 'other', displayLabel: 'Other Items', year1: '', escPct: '', escStart: '', chargeStart: '' },
  ];
}

/**
 * Create an empty charge form object for user addition.
 * @param {string} key
 * @param {string} [displayLabel='New Charge']
 * @param {string} [canonicalType='other']
 */
export function emptyChargeForm(key, displayLabel = 'New Charge', canonicalType = 'other') {
  return { key, canonicalType, displayLabel, year1: '', escPct: '', escStart: '', chargeStart: '' };
}

/**
 * Generate a unique key for a new user-added charge.
 * @param {string[]} existingKeys
 * @returns {string}
 */
export function generateChargeKey(existingKeys) {
  let i = 1;
  while (existingKeys.includes(`custom_${i}`)) i++;
  return `custom_${i}`;
}
