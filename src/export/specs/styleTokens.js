/**
 * @fileoverview Named style tokens for XLSX export.
 *
 * Each token resolves to an xlsx-js-style cell style object.
 * Centralizes all color, font, border, and number format definitions
 * so that specs reference tokens by name instead of inline objects.
 */

// ── Colour palette ──────────────────────────────────────────────────────────

export const C = {
  headerNavy:   '1F3864',
  headerBlue:   '17375E',
  headerPurple: '3D1C6E',
  subheader:    'D6DCE4',
  totalBg:      'BDD7EE',
  amber:        'FFF2CC',
  rowEven:      'FFFFFF',
  rowOdd:       'DEEAF1',
  note:         'F2F2F2',
  white:        'FFFFFF',
  assumpLabel:  'EBF3FB',
  softRedPink:  'FFB6C1',

  fcInput:      '0000FF',   // blue  — hard-coded inputs
  fcCalc:       '000000',   // black — formula / calculated values
  fcCrossSheet: '375623',   // dark green — cross-sheet references
  fcTotal:      '1F3864',   // navy — totals row
};

// ── Fonts ───────────────────────────────────────────────────────────────────

export const FONT    = { name: 'Calibri', sz: 11 };
export const FONT_B  = { ...FONT, bold: true };
export const FONT_SM = { ...FONT, sz: 10 };

// ── Borders ─────────────────────────────────────────────────────────────────

export const THIN_BORDER = {
  top:    { style: 'thin', color: { rgb: 'C8C8C8' } },
  bottom: { style: 'thin', color: { rgb: 'C8C8C8' } },
  left:   { style: 'thin', color: { rgb: 'C8C8C8' } },
  right:  { style: 'thin', color: { rgb: 'C8C8C8' } },
};

export const ASSUMPTION_BORDER = {
  top:    { style: 'thin', color: { rgb: 'B0B0B0' } },
  bottom: { style: 'thin', color: { rgb: 'B0B0B0' } },
  left:   { style: 'thin', color: { rgb: 'B0B0B0' } },
  right:  { style: 'thin', color: { rgb: 'B0B0B0' } },
};

// ── Number formats ──────────────────────────────────────────────────────────

export const FMT = {
  date:     'mm/dd/yyyy',
  currency: '$#,##0.00',
  sf:       '$#,##0.0000',
  int:      '#,##0',
  pct:      '0.00%',
  factor:   '0.0000',
  text:     '@',
  otc:      '$#,##0.00;;"-"',
};

// ── Style builders ──────────────────────────────────────────────────────────

export function hdrStyle(bg = C.headerNavy) {
  return {
    font:      { ...FONT_B, color: { rgb: C.white } },
    fill:      { patternType: 'solid', fgColor: { rgb: bg } },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    border: {
      top:    { style: 'thin',   color: { rgb: '000000' } },
      bottom: { style: 'medium', color: { rgb: '000000' } },
      left:   { style: 'thin',   color: { rgb: '000000' } },
      right:  { style: 'thin',   color: { rgb: '000000' } },
    },
  };
}

export const TOTAL_BASE = {
  font:      { ...FONT_B, color: { rgb: C.fcTotal } },
  fill:      { patternType: 'solid', fgColor: { rgb: C.totalBg } },
  alignment: { horizontal: 'right', vertical: 'middle' },
  border: {
    top:    { style: 'double', color: { rgb: C.fcTotal } },
    bottom: { style: 'thin',   color: { rgb: C.fcTotal } },
    left:   { style: 'thin',   color: { rgb: 'C8C8C8' } },
    right:  { style: 'thin',   color: { rgb: 'C8C8C8' } },
  },
};

/**
 * Data-cell style builder.
 * @param {string} fill      — background fill color hex
 * @param {string} numFmt    — number format string
 * @param {object} [extra]   — optional overrides
 */
export function ds(fill, numFmt, extra = {}) {
  let fontDef;
  if (extra.italic) {
    fontDef = { ...FONT_SM, italic: true, color: { rgb: '555555' } };
  } else {
    const base = extra.bold ? FONT_B : (extra.small ? FONT_SM : FONT);
    fontDef    = extra.fontColor
      ? { ...base, color: { rgb: extra.fontColor } }
      : base;
  }
  return {
    font:      fontDef,
    fill:      { patternType: 'solid', fgColor: { rgb: fill } },
    alignment: { horizontal: extra.align ?? 'right', vertical: 'middle', ...(extra.wrap ? { wrapText: true } : {}) },
    numFmt,
    border:    THIN_BORDER,
  };
}
