/**
 * @fileoverview Named style tokens for XLSX export.
 *
 * Each token resolves to an xlsx-js-style cell style object.
 * Centralizes the DEODATE workbook visual system so sheet specs can reference
 * semantic style roles instead of embedding brand literals inline.
 */

export const DEODATE_THEME = {
  fonts: {
    // Use Excel-safe installed fonts to avoid workbook text rendering/fallback issues.
    brand: 'Arial',
    body: 'Arial',
  },
  colors: {
    sectionBar: '404040',
    titleText: '333333',
    secondaryText: '7F7F7F',
    bodyText: '0D0D0D',
    tableHeader: '2E5FA1',
    secondaryAccent: '8EAADB',
    labelFill: 'DCE6F1',
    border: 'D9D9D9',
    altRow: 'F2F2F2',
    white: 'FFFFFF',
  },
};

// Keep the short `C` export for existing workbook code, but map it to the
// DEODATE system instead of the legacy palette.
export const C = {
  sectionBar: DEODATE_THEME.colors.sectionBar,
  titleText: DEODATE_THEME.colors.titleText,
  secondaryText: DEODATE_THEME.colors.secondaryText,
  bodyText: DEODATE_THEME.colors.bodyText,
  tableHeader: DEODATE_THEME.colors.tableHeader,
  secondaryAccent: DEODATE_THEME.colors.secondaryAccent,
  labelFill: DEODATE_THEME.colors.labelFill,
  border: DEODATE_THEME.colors.border,
  altRow: DEODATE_THEME.colors.altRow,
  white: DEODATE_THEME.colors.white,

  // Legacy aliases used throughout the export code.
  headerNavy: DEODATE_THEME.colors.sectionBar,
  headerBlue: DEODATE_THEME.colors.tableHeader,
  headerPurple: DEODATE_THEME.colors.sectionBar,
  subheader: DEODATE_THEME.colors.secondaryAccent,
  totalBg: DEODATE_THEME.colors.sectionBar,
  amber: DEODATE_THEME.colors.labelFill,
  rowEven: DEODATE_THEME.colors.white,
  rowOdd: DEODATE_THEME.colors.altRow,
  note: DEODATE_THEME.colors.altRow,
  assumpLabel: DEODATE_THEME.colors.labelFill,
  softRedPink: DEODATE_THEME.colors.secondaryAccent,

  // State cues remapped into the DEODATE palette.
  fcInput: DEODATE_THEME.colors.tableHeader,
  fcCalc: DEODATE_THEME.colors.bodyText,
  fcCrossSheet: DEODATE_THEME.colors.secondaryText,
  fcTotal: DEODATE_THEME.colors.white,
  fcIrregular: DEODATE_THEME.colors.tableHeader,
  fcMuted: DEODATE_THEME.colors.secondaryText,
  inputFill: DEODATE_THEME.colors.white,
  savingsFill: DEODATE_THEME.colors.labelFill,
  savingsText: DEODATE_THEME.colors.tableHeader,
  obligFill: DEODATE_THEME.colors.altRow,
  obligText: DEODATE_THEME.colors.titleText,
};

export const BRAND_FONT = { name: DEODATE_THEME.fonts.brand, sz: 11 };
export const BRAND_FONT_B = { ...BRAND_FONT, bold: true };
export const FONT = { name: DEODATE_THEME.fonts.body, sz: 11 };
export const FONT_B = { ...FONT, bold: true };
export const FONT_SM = { ...FONT, sz: 10 };

export const THIN_BORDER = {
  top: { style: 'thin', color: { rgb: C.border } },
  bottom: { style: 'thin', color: { rgb: C.border } },
  left: { style: 'thin', color: { rgb: C.border } },
  right: { style: 'thin', color: { rgb: C.border } },
};

export const ASSUMPTION_BORDER = {
  top: { style: 'thin', color: { rgb: C.border } },
  bottom: { style: 'thin', color: { rgb: C.border } },
  left: { style: 'thin', color: { rgb: C.border } },
  right: { style: 'thin', color: { rgb: C.border } },
};

export const PANEL_BORDER = {
  top: { style: 'medium', color: { rgb: C.border } },
  bottom: { style: 'medium', color: { rgb: C.border } },
  left: { style: 'medium', color: { rgb: C.border } },
  right: { style: 'medium', color: { rgb: C.border } },
};

export const FMT = {
  date: 'mm/dd/yyyy',
  currency: '$#,##0.00',
  sf: '$#,##0.0000',
  int: '#,##0',
  pct: '0.00%',
  factor: '0.0000',
  text: '@',
  otc: '$#,##0.00;;"-"',
};

export function titleCellStyle(size = 20) {
  return {
    font: { ...BRAND_FONT_B, sz: size, color: { rgb: C.titleText } },
    fill: { patternType: 'solid', fgColor: { rgb: C.white } },
    alignment: { horizontal: 'center', vertical: 'middle' },
    numFmt: FMT.text,
  };
}

export function titleDividerStyle() {
  return {
    font: { ...BRAND_FONT_B, color: { rgb: C.white } },
    fill: { patternType: 'solid', fgColor: { rgb: C.tableHeader } },
    alignment: { horizontal: 'center', vertical: 'middle' },
    border: THIN_BORDER,
    numFmt: FMT.text,
  };
}

export function subtitleCellStyle() {
  return {
    font: { ...FONT, italic: true, color: { rgb: C.secondaryText } },
    fill: { patternType: 'solid', fgColor: { rgb: C.labelFill } },
    alignment: { horizontal: 'center', vertical: 'middle' },
    numFmt: FMT.text,
  };
}

export function metadataStyle() {
  return {
    font: { ...FONT_SM, color: { rgb: C.secondaryText } },
    fill: { patternType: 'solid', fgColor: { rgb: C.note } },
    alignment: { horizontal: 'center', vertical: 'middle' },
    numFmt: FMT.text,
  };
}

export function labelCellStyle(border = ASSUMPTION_BORDER) {
  return {
    font: { ...FONT_B, color: { rgb: C.fcInput } },
    fill: { patternType: 'solid', fgColor: { rgb: C.assumpLabel } },
    alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
    border,
    numFmt: FMT.text,
  };
}

export function sectionBarStyle(fill = C.headerNavy, border = THIN_BORDER, size = 11) {
  return {
    font: { ...FONT_B, sz: size, color: { rgb: C.white } },
    fill: { patternType: 'solid', fgColor: { rgb: fill } },
    alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
    border,
    numFmt: FMT.text,
  };
}

export function noteCellStyle() {
  return {
    font: { ...FONT_SM, italic: true, color: { rgb: C.secondaryText } },
    fill: { patternType: 'solid', fgColor: { rgb: C.note } },
    alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
    numFmt: FMT.text,
  };
}

export function inputTextCellStyle(border = ASSUMPTION_BORDER, align = 'left') {
  return {
    font: { ...FONT, color: { rgb: C.fcInput } },
    fill: { patternType: 'solid', fgColor: { rgb: C.inputFill } },
    alignment: { horizontal: align, vertical: 'middle' },
    border,
    numFmt: FMT.text,
  };
}

export function computedCellStyle(numFmt = FMT.int, border = ASSUMPTION_BORDER, align = 'right') {
  return {
    font: { ...FONT, color: { rgb: C.fcCalc } },
    fill: { patternType: 'solid', fgColor: { rgb: C.labelFill } },
    alignment: { horizontal: align, vertical: 'middle' },
    border,
    numFmt,
  };
}

export function hdrStyle(bg = C.headerBlue) {
  return {
    font: { ...FONT_B, color: { rgb: C.white } },
    fill: { patternType: 'solid', fgColor: { rgb: bg } },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    border: {
      top: { style: 'thin', color: { rgb: C.border } },
      bottom: { style: 'medium', color: { rgb: C.border } },
      left: { style: 'thin', color: { rgb: C.border } },
      right: { style: 'thin', color: { rgb: C.border } },
    },
  };
}

export const TOTAL_BASE = {
  font: { ...FONT_B, color: { rgb: C.fcTotal } },
  fill: { patternType: 'solid', fgColor: { rgb: C.totalBg } },
  alignment: { horizontal: 'right', vertical: 'middle' },
  border: {
    top: { style: 'double', color: { rgb: C.headerBlue } },
    bottom: { style: 'thin', color: { rgb: C.totalBg } },
    left: { style: 'thin', color: { rgb: C.border } },
    right: { style: 'thin', color: { rgb: C.border } },
  },
};

/**
 * Data-cell style builder.
 * @param {string} fill - background fill color hex
 * @param {string} numFmt - number format string
 * @param {object} [extra] - optional overrides
 */
export function ds(fill, numFmt, extra = {}) {
  let fontDef;
  if (extra.italic) {
    fontDef = { ...FONT_SM, italic: true, color: { rgb: C.secondaryText } };
  } else {
    const base = extra.bold ? FONT_B : (extra.small ? FONT_SM : FONT);
    fontDef = extra.fontColor
      ? { ...base, color: { rgb: extra.fontColor } }
      : base;
  }
  return {
    font: fontDef,
    fill: { patternType: 'solid', fgColor: { rgb: fill } },
    alignment: {
      horizontal: extra.align ?? 'right',
      vertical: 'middle',
      ...(extra.wrap ? { wrapText: true } : {}),
    },
    numFmt,
    border: THIN_BORDER,
  };
}

export function scenarioSheetTitleStyle() {
  return {
    font: { ...BRAND_FONT_B, sz: 14, color: { rgb: C.white } },
    fill: { patternType: 'solid', fgColor: { rgb: C.sectionBar } },
    alignment: { horizontal: 'left', vertical: 'middle' },
    border: PANEL_BORDER,
    numFmt: FMT.text,
  };
}

export function panelTitleFillStyle() {
  return {
    fill: { patternType: 'solid', fgColor: { rgb: C.sectionBar } },
    border: PANEL_BORDER,
  };
}

export function panelLabelStyle(border = PANEL_BORDER, align = 'left') {
  return {
    font: { ...FONT_B, color: { rgb: C.titleText } },
    fill: { patternType: 'solid', fgColor: { rgb: C.labelFill } },
    alignment: { horizontal: align, vertical: 'middle', wrapText: true },
    border,
    numFmt: FMT.text,
  };
}

export function panelSectionStyle(fill = C.sectionBar, size = 12) {
  return {
    font: { ...FONT_B, sz: size, color: { rgb: C.white } },
    fill: { patternType: 'solid', fgColor: { rgb: fill } },
    alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
    border: PANEL_BORDER,
    numFmt: FMT.text,
  };
}

export function panelTierStyle(fill = C.tableHeader) {
  return {
    font: { ...FONT_B, color: { rgb: C.white } },
    fill: { patternType: 'solid', fgColor: { rgb: fill } },
    alignment: { horizontal: 'center', vertical: 'middle' },
    border: PANEL_BORDER,
    numFmt: FMT.text,
  };
}

export function panelValueStyle(numFmt = FMT.text, {
  fill = C.white,
  align = 'right',
  fontColor = C.fcCalc,
  border = PANEL_BORDER,
} = {}) {
  return {
    ...ds(fill, numFmt, { align, fontColor }),
    border,
  };
}

export function panelInputStyle(numFmt = FMT.pct, {
  fill = C.labelFill,
  align = 'center',
  border = PANEL_BORDER,
} = {}) {
  return {
    ...ds(fill, numFmt, { align, fontColor: C.fcInput }),
    border,
  };
}

export function panelDashStyle(fill = C.white) {
  return {
    ...panelValueStyle(FMT.text, { fill, align: 'center' }),
  };
}

function emphasisPalette(kind) {
  return kind === 'obligation'
    ? { fill: C.obligFill, text: C.obligText }
    : { fill: C.savingsFill, text: C.savingsText };
}

export function emphasisLabelStyle(kind = 'savings') {
  const palette = emphasisPalette(kind);
  return {
    font: { ...FONT_B, color: { rgb: palette.text } },
    fill: { patternType: 'solid', fgColor: { rgb: palette.fill } },
    alignment: { horizontal: 'left', vertical: 'middle' },
    border: PANEL_BORDER,
    numFmt: FMT.text,
  };
}

export function emphasisValueStyle(kind = 'savings', numFmt = FMT.currency, align = 'right') {
  const palette = emphasisPalette(kind);
  return {
    font: { ...FONT_B, color: { rgb: palette.text } },
    fill: { patternType: 'solid', fgColor: { rgb: palette.fill } },
    alignment: { horizontal: align, vertical: 'middle' },
    border: PANEL_BORDER,
    numFmt,
  };
}
