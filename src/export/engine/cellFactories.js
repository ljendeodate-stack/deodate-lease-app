/**
 * @fileoverview Cell factory functions for xlsx-js-style worksheet cells.
 *
 * Each factory produces a cell object { t, v, [f], s } suitable for
 * direct assignment into a worksheet. Style is resolved via styleTokens.
 */

import { C, FMT, ds, hdrStyle, TOTAL_BASE } from '../specs/styleTokens.js';

// ── Date serial conversion ──────────────────────────────────────────────────

/**
 * Convert ISO date string (YYYY-MM-DD) to Excel serial date number.
 */
export function toSerial(isoStr) {
  if (!isoStr) return null;
  const p = isoStr.split('-');
  if (p.length !== 3) return null;
  const d     = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  const epoch = new Date(1899, 11, 30);
  return Math.round((d.getTime() - epoch.getTime()) / 86400000);
}

/**
 * Convert MM/DD/YYYY date string to Excel serial date number.
 */
export function parseOtcDateSerial(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d     = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  const epoch = new Date(1899, 11, 30);
  return Math.round((d.getTime() - epoch.getTime()) / 86400000);
}

// ── Cell factories ──────────────────────────────────────────────────────────

/** Hard-coded user input — Blue font. */
export function cInput(v, fmt, fill, bold = false) {
  return { t: 'n', v: v ?? 0, s: ds(fill, fmt, { bold, fontColor: C.fcInput }) };
}

/** Engine-calculated value — Black font. */
export function cCalc(v, fmt, fill, bold = false) {
  return { t: 'n', v: v ?? 0, s: ds(fill, fmt, { bold, fontColor: C.fcCalc }) };
}

/** Same-sheet formula — Black font. */
export function cFmla(formula, fallback, fmt, fill, bold = false) {
  return { t: 'n', v: fallback ?? 0, f: formula, s: ds(fill, fmt, { bold, fontColor: C.fcCalc }) };
}

/** Blue formula — driven by user assumption cells. */
export function cFmlaInput(formula, fallback, fmt, fill) {
  return { t: 'n', v: fallback ?? 0, f: formula, s: ds(fill, fmt, { fontColor: C.fcInput }) };
}

/** Cross-sheet formula — Dark-green font. */
export function cXSheet(formula, fallback, fmt, fill) {
  return { t: 'n', v: fallback ?? 0, f: formula, s: ds(fill, fmt, { fontColor: C.fcCrossSheet }) };
}

/** Date cell — Black font. */
export function cDate(isoStr, fill) {
  const serial = toSerial(isoStr);
  if (serial === null) {
    return { t: 's', v: isoStr ?? '', s: ds(fill, FMT.text, { align: 'center', fontColor: C.fcCalc }) };
  }
  return { t: 'n', v: serial, s: ds(fill, FMT.date, { align: 'center', fontColor: C.fcCalc }) };
}

/** Integer cell. */
export function cInt(v, fill, bold = false, fontColor = C.fcCalc) {
  return { t: 'n', v: v ?? 0, s: ds(fill, FMT.int, { align: 'center', bold, fontColor }) };
}

/** Text cell. */
export function cText(v, fill, bold = false, align = 'left', fontColor = C.fcCalc) {
  return { t: 's', v: String(v ?? ''), s: ds(fill, FMT.text, { align, bold, fontColor }) };
}

/** Header cell. */
export function cHdr(label, bg) {
  return { t: 's', v: label, s: hdrStyle(bg) };
}

/** Totals row formula cell. */
export function cTotal(formula, fallback, numFmt) {
  return { t: 'n', v: fallback ?? 0, f: formula, s: { ...TOTAL_BASE, numFmt } };
}

/** Totals row label cell. */
export function cTotalLabel(text) {
  return { t: 's', v: text, s: { ...TOTAL_BASE, alignment: { horizontal: 'left', vertical: 'middle' } } };
}

/** Blank totals row cell. */
export function cBlankTotal() {
  return { t: 's', v: '', s: TOTAL_BASE };
}
