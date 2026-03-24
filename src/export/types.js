/**
 * Shared JSDoc types for the spec-driven export slice.
 */

/**
 * @typedef {'input' | 'date'} AssumptionEntryKind
 */

/**
 * @typedef {'currency' | 'date' | 'factor' | 'int' | 'pct' | 'text'} FormatKey
 */

/**
 * @typedef {object} AssumptionEntry
 * @property {string} id
 * @property {string} label
 * @property {AssumptionEntryKind} kind
 * @property {FormatKey} format
 * @property {number | string | null} value
 */

/**
 * @typedef {object} ExportModel
 * @property {object[]} rows
 * @property {object} params
 * @property {string} filename
 * @property {string} nnnMode
 * @property {object[]} activeCategories
 * @property {object} assumptions
 * @property {AssumptionEntry[]} assumptionEntries
 * @property {string[]} otLabels
 * @property {object[]} columns
 */

/**
 * @typedef {object} LeaseScheduleLayout
 * @property {number} assumptionStartRow
 * @property {number} assumptionLabelCol
 * @property {number} assumptionValueCol
 * @property {Array<AssumptionEntry & { row: number, address: string }>} assumptionEntries
 * @property {Record<string, string>} cellMap
 * @property {Record<string, object>} colByKey
 * @property {object[]} nnnColumns
 * @property {object[]} otherChargeColumns
 * @property {object[]} otColumns
 * @property {number} assumptionLastRow
 * @property {number} headerRow
 * @property {number} firstDataRow
 * @property {number} lastDataRow
 * @property {number} totalsRow
 * @property {number} noteRow
 * @property {number} lastCol
 */

export {};
