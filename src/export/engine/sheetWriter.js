/**
 * @fileoverview Sheet renderer — takes a spec object and writes it
 * to an xlsx-js-style worksheet.
 *
 * The writer iterates spec sections, places each cell at (col, row),
 * and applies sheet-level metadata (merges, frozen pane, autofilter,
 * column widths, row heights, ref range).
 */

import { colLetter } from './registry.js';

/**
 * Set a cell in the worksheet.
 * @param {object} ws — xlsx-js-style worksheet object
 * @param {number} c  — 0-based column index
 * @param {number} r  — 1-based row number
 * @param {object} cell — cell object { t, v, [f], s }
 */
function sc(ws, c, r, cell) {
  ws[`${colLetter(c)}${r}`] = cell;
}

/**
 * Set the !ref range of the worksheet.
 */
function setRef(ws, maxC, maxR) {
  ws['!ref'] = `A1:${colLetter(maxC)}${maxR}`;
}

/**
 * Render a sheet spec to an xlsx-js-style worksheet object.
 *
 * @param {object} spec — sheet spec from a spec builder
 * @returns {object} ws — xlsx-js-style worksheet
 */
export function renderSheet(spec) {
  const ws = {};

  // Write all section cells
  for (const sectionKey of Object.keys(spec.sections)) {
    const section = spec.sections[sectionKey];
    if (section.cells) {
      for (const entry of section.cells) {
        sc(ws, entry.col, entry.row, entry.cell);
      }
    }
  }

  // Merges — collect from all sections, title section typically has them
  const allMerges = [];
  for (const sectionKey of Object.keys(spec.sections)) {
    const section = spec.sections[sectionKey];
    if (section.merges) {
      allMerges.push(...section.merges);
    }
  }
  if (allMerges.length > 0) {
    ws['!merges'] = allMerges;
  }

  // Column widths
  if (spec.colWidths) {
    ws['!cols'] = spec.colWidths.map((w) => ({ wch: w }));
  }

  // Row heights
  if (spec.rowHeights) {
    ws['!rows'] = spec.rowHeights;
  }

  // Frozen pane
  if (spec.frozenPane) {
    ws['!views'] = [{ state: 'frozen', ...spec.frozenPane }];
  }

  // Autofilter
  if (spec.autoFilter) {
    ws['!autofilter'] = spec.autoFilter;
  }

  // Ref range
  setRef(ws, spec.lastCol, spec.lastRow);

  return ws;
}
