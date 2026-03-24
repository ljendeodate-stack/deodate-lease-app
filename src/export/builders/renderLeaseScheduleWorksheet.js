import { renderSheet } from '../engine/sheetWriter.js';

/**
 * Render the Lease Schedule sheet spec to an xlsx-js-style worksheet.
 *
 * @param {object} spec
 * @returns {object}
 */
export function renderLeaseScheduleWorksheet(spec) {
  return renderSheet(spec);
}
