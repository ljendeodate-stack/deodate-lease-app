/**
 * Generate blank XLSX template for the public/ directory.
 * Run with: node scripts/generate-template.mjs
 */
import XLSX from 'xlsx-js-style';
import { writeFileSync } from 'fs';

const FONT = { name: 'Calibri', sz: 11 };
const FONT_B = { ...FONT, bold: true };
const THIN_BORDER = {
  top: { style: 'thin', color: { rgb: 'C8C8C8' } },
  bottom: { style: 'thin', color: { rgb: 'C8C8C8' } },
  left: { style: 'thin', color: { rgb: 'C8C8C8' } },
  right: { style: 'thin', color: { rgb: 'C8C8C8' } },
};

const hdrStyle = {
  font: { ...FONT_B, color: { rgb: 'FFFFFF' } },
  fill: { patternType: 'solid', fgColor: { rgb: '1F3864' } },
  alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
  border: {
    top: { style: 'thin', color: { rgb: '000000' } },
    bottom: { style: 'medium', color: { rgb: '000000' } },
    left: { style: 'thin', color: { rgb: '000000' } },
    right: { style: 'thin', color: { rgb: '000000' } },
  },
};

const labelStyle = {
  font: { ...FONT_B, color: { rgb: '1F3864' } },
  fill: { patternType: 'solid', fgColor: { rgb: 'EBF3FB' } },
  alignment: { horizontal: 'left', vertical: 'middle' },
  border: THIN_BORDER,
};

const valueStyle = {
  font: { ...FONT, color: { rgb: '0000FF' } },
  fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } },
  alignment: { horizontal: 'right', vertical: 'middle' },
  border: THIN_BORDER,
};

function sc(ws, c, r, cell) {
  const col = String.fromCharCode(65 + c);
  ws[`${col}${r}`] = cell;
}

// Sheet 1 — Lease Schedule
const ws1 = {};
ws1['!ref'] = 'A1:R25';

// Title
ws1['A2'] = { t: 's', v: 'Lease Schedule — Obligation Analysis', s: {
  font: { name: 'Calibri', sz: 20, bold: true, color: { rgb: '1F3864' } },
  fill: { patternType: 'solid', fgColor: { rgb: 'DEEAF1' } },
  alignment: { horizontal: 'center', vertical: 'middle' },
}};
ws1['!merges'] = [
  { s: { r: 0, c: 0 }, e: { r: 0, c: 17 } },
  { s: { r: 1, c: 0 }, e: { r: 1, c: 17 } },
];

// Assumptions labels
const assumptions = [
  [5, 'Rentable SF'],
  [6, 'Lease Commencement Date'],
  [7, 'Lease Expiration Date'],
  [8, 'Year 1 Monthly Base Rent'],
  [9, 'Annual Base Rent Escalation Rate (%)'],
  [10, 'Lease Anniversary Month'],
  [11, 'Abatement Full-Month Count'],
  [12, 'Abatement Partial-Month Proration Factor'],
  [13, 'CAMS Year 1 Monthly Amount'],
  [14, 'CAMS Annual Escalation Rate (%)'],
  [15, 'Insurance Year 1 Monthly Amount'],
  [16, 'Insurance Annual Escalation Rate (%)'],
  [17, 'Taxes Year 1 Monthly Amount'],
  [18, 'Taxes Annual Escalation Rate (%)'],
  [19, 'Security Year 1 Monthly Amount'],
  [20, 'Security Annual Escalation Rate (%)'],
  [21, 'Other Items Year 1 Monthly Amount'],
  [22, 'Other Items Annual Escalation Rate (%)'],
];

assumptions.forEach(([r, label]) => {
  ws1[`B${r}`] = { t: 's', v: label, s: labelStyle };
  ws1[`C${r}`] = { t: 's', v: '', s: valueStyle };
});

// Headers row 24
const headers = [
  'Period\nStart', 'Period\nEnd', 'Month\n#', 'Year\n#',
  'Scheduled\nBase Rent', 'Base Rent\nApplied',
  'CAMS', 'Insurance', 'Taxes', 'Security', 'Other\nItems',
  'Total NNN',
  'Total Monthly\nObligation',
  'Effective\n$/SF',
  'Obligation\nRemaining', 'Base Rent\nRemaining', 'NNN\nRemaining', 'Other Charges\nRemaining',
];
headers.forEach((h, ci) => {
  const colLetter = ci < 26 ? String.fromCharCode(65 + ci) : 'A' + String.fromCharCode(65 + ci - 26);
  ws1[`${colLetter}24`] = { t: 's', v: h, s: hdrStyle };
});

ws1['!cols'] = [
  { wch: 13 }, { wch: 35 }, { wch: 9 }, { wch: 9 },
  { wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 12 },
  { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 14 },
  { wch: 22 }, { wch: 14 }, { wch: 22 }, { wch: 20 },
  { wch: 16 }, { wch: 22 },
];
ws1['!rows'] = [{ hpt: 36 }, { hpt: 16 }];
ws1['!views'] = [{ state: 'frozen', xSplit: 4, ySplit: 24 }];

// Sheet 2 — Annual Summary
const ws2 = {};
ws2['!ref'] = 'A1:H2';
const summaryHeaders = [
  'Period Start', 'Period End', 'Lease Year', 'Months',
  'Base Rent Applied', 'Total NNN',
  'Total Monthly Obligation', '% of Grand Total',
];
summaryHeaders.forEach((h, ci) => {
  const colLetter = String.fromCharCode(65 + ci);
  ws2[`${colLetter}1`] = { t: 's', v: h, s: hdrStyle };
});
ws2['!cols'] = [
  { wch: 13 }, { wch: 13 }, { wch: 16 }, { wch: 9 },
  { wch: 22 }, { wch: 16 }, { wch: 26 }, { wch: 16 },
];
ws2['!views'] = [{ state: 'frozen', ySplit: 1 }];

// Sheet 3 — Audit Trail
const ws3 = {};
ws3['!ref'] = 'A1:O2';
const auditHeaders = [
  'Period Start', 'Month #',
  'Period Factor', 'Proration Factor', 'Proration Basis',
  'CAMS Esc Year', 'CAMS Active',
  'Ins Esc Year', 'Ins Active',
  'Tax Esc Year', 'Tax Active',
  'Sec Esc Year', 'Sec Active',
  'Other Esc Year', 'Other Active',
];
auditHeaders.forEach((h, ci) => {
  const colLetter = ci < 26 ? String.fromCharCode(65 + ci) : 'A' + String.fromCharCode(65 + ci - 26);
  ws3[`${colLetter}1`] = { t: 's', v: h, s: { ...hdrStyle, fill: { patternType: 'solid', fgColor: { rgb: '3D1C6E' } } } };
});
ws3['!cols'] = [
  { wch: 13 }, { wch: 9 }, { wch: 14 }, { wch: 16 }, { wch: 20 },
  { wch: 13 }, { wch: 11 }, { wch: 13 }, { wch: 11 },
  { wch: 13 }, { wch: 11 }, { wch: 13 }, { wch: 11 },
  { wch: 14 }, { wch: 11 },
];
ws3['!views'] = [{ state: 'frozen', ySplit: 1 }];

// Build workbook
const wb = XLSX.utils.book_new();
wb.Props = { Title: 'DEODATE Lease Template', Author: 'DEODATE Lease Schedule Engine' };
XLSX.utils.book_append_sheet(wb, ws1, 'Lease Schedule');
XLSX.utils.book_append_sheet(wb, ws2, 'Annual Summary');
XLSX.utils.book_append_sheet(wb, ws3, 'Audit Trail');

const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
writeFileSync('public/deodate-lease-template.xlsx', buf);
console.log('Template written to public/deodate-lease-template.xlsx');
