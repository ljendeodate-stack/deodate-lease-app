/**
 * @fileoverview New XLSX export entry point — spec-driven architecture.
 *
 * Orchestrates: resolve charges -> compute assumptions -> build registry ->
 * build sheet specs -> render sheets -> verify -> fflate post-process -> download.
 *
 * Signature matches the original: exportToXLSX(rows, params, filename)
 */

import XLSX from 'xlsx-js-style';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { CANONICAL_TYPES } from '../engine/chargeTypes.js';
import { SymbolRegistry } from './engine/registry.js';
import { computeLayout, registerAssumptionSymbols, registerColumnSymbols } from './engine/sectionLayout.js';
import { buildLeaseScheduleSpec } from './specs/leaseScheduleSpec.js';
import { buildAnnualSummarySpec } from './specs/annualSummarySpec.js';
import { buildAuditTrailSpec } from './specs/auditTrailSpec.js';
import { renderSheet } from './engine/sheetWriter.js';
import { verifyWorkbook } from './engine/verify.js';

// ── Charges normalization ───────────────────────────────────────────────────

function resolveCharges(params) {
  if (Array.isArray(params.charges) && params.charges.length > 0) {
    return params.charges.map((ch) => ({
      key: ch.key,
      canonicalType: ch.canonicalType || 'other',
      displayLabel: ch.displayLabel || ch.key,
      year1: Number(ch.year1) || 0,
      escPct: Number(ch.escPct) || 0,
      escRate: (Number(ch.escPct) || 0) / 100,
    }));
  }
  const safe = (obj) => ({ year1: 0, escPct: 0, ...obj });
  const legacy = [
    { key: 'cams',       canonicalType: 'nnn',   displayLabel: 'CAMS',        ...safe(params.cams) },
    { key: 'insurance',  canonicalType: 'nnn',   displayLabel: 'Insurance',   ...safe(params.insurance) },
    { key: 'taxes',      canonicalType: 'nnn',   displayLabel: 'Taxes',       ...safe(params.taxes) },
    { key: 'security',   canonicalType: 'other', displayLabel: 'Security',    ...safe(params.security) },
    { key: 'otherItems', canonicalType: 'other', displayLabel: 'Other Items', ...safe(params.otherItems) },
  ];
  return legacy.map((ch) => ({
    ...ch,
    year1: Number(ch.year1) || 0,
    escPct: Number(ch.escPct) || 0,
    escRate: (Number(ch.escPct) || 0) / 100,
  }));
}

// ── Assumptions computation ─────────────────────────────────────────────────

function computeAssumptions(rows, params, charges) {
  const nnnMode = params.nnnMode ?? 'individual';
  const isAgg   = nnnMode === 'aggregate';

  const empty = {
    leaseName: params.leaseName || '',
    nnnMode,
    squareFootage: 0, commencementDate: null, expirationDate: null,
    year1BaseRent: 0, annualEscRate: 0, anniversaryMonth: 1,
    fullAbatementMonths: 0, abatementPartialFactor: 1,
    charges,
  };

  if (!rows || !rows.length) return empty;

  const firstRow = rows[0];
  const lastRow  = rows[rows.length - 1];
  const year1BaseRent = firstRow.scheduledBaseRent ?? 0;

  const year2Row = rows.find((r) => (r.leaseYear ?? r['Year #']) === 2);
  let annualEscRate = 0;
  if (year2Row && year1BaseRent > 0) {
    annualEscRate = (year2Row.scheduledBaseRent ?? 0) / year1BaseRent - 1;
  }

  const fullAbatementMonths    = rows.filter((r) => r.isAbatementRow).length;
  const boundaryRow            = rows.find((r) => r.prorationBasis === 'abatement-boundary');
  const abatementPartialFactor = boundaryRow
    ? (boundaryRow.baseRentProrationFactor ?? 1)
    : 1;

  const effectiveCharges = charges.map((ch, idx) => {
    if (isAgg && ch.canonicalType === CANONICAL_TYPES.NNN && idx === charges.findIndex(c => c.canonicalType === CANONICAL_TYPES.NNN)) {
      return {
        ...ch,
        year1: Number(params.nnnAggregate?.year1) || 0,
        escRate: (Number(params.nnnAggregate?.escPct) || 0) / 100,
      };
    }
    if (isAgg && ch.canonicalType === CANONICAL_TYPES.NNN) {
      return { ...ch, year1: 0, escRate: 0 };
    }
    return ch;
  });

  return {
    leaseName:             String(params.leaseName || ''),
    nnnMode,
    squareFootage:         Number(params.squareFootage) || 0,
    commencementDate:      firstRow.periodStart ?? null,
    expirationDate:        lastRow.periodEnd    ?? null,
    year1BaseRent,
    annualEscRate,
    anniversaryMonth:      1,
    fullAbatementMonths,
    abatementPartialFactor,
    charges: effectiveCharges,
  };
}

// ── Main export ─────────────────────────────────────────────────────────────

export function exportToXLSX(rows, params = {}, filename = 'lease-schedule') {
  const wb = XLSX.utils.book_new();
  wb.Props = {
    Title:       'Lease Schedule',
    Author:      'DEODATE Lease Schedule Engine',
    CreatedDate: new Date(),
  };

  const charges = resolveCharges(params);
  const assump  = computeAssumptions(rows, params, charges);

  // Derive OT labels from the processed rows
  const seenLabels = new Set();
  const otLabels = [];
  for (const row of rows) {
    for (const [lbl, amt] of Object.entries(row.oneTimeItemAmounts ?? {})) {
      if (amt > 0 && !seenLabels.has(lbl)) {
        seenLabels.add(lbl);
        otLabels.push(lbl);
      }
    }
  }

  const chargeCount = charges.length;
  const otCount     = otLabels.length;
  const L           = computeLayout(chargeCount, otCount);

  // Build symbol registry
  const reg = new SymbolRegistry();
  registerAssumptionSymbols(reg, assump.charges);
  registerColumnSymbols(reg, L, assump.charges, otLabels);

  // Build sheet specs
  const leaseSpec   = buildLeaseScheduleSpec(assump, rows, otLabels, filename, L, reg);
  const summarySpec = buildAnnualSummarySpec(rows, chargeCount, otCount, L);
  const auditSpec   = buildAuditTrailSpec(rows, assump.charges);

  // Render sheets
  XLSX.utils.book_append_sheet(wb, renderSheet(leaseSpec),   leaseSpec.sheetName);
  XLSX.utils.book_append_sheet(wb, renderSheet(summarySpec), summarySpec.sheetName);
  XLSX.utils.book_append_sheet(wb, renderSheet(auditSpec),   auditSpec.sheetName);

  // Post-generation verification
  verifyWorkbook(wb, reg, L, rows.length, chargeCount, otLabels);

  // Write XLSX bytes
  const xlsxBytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

  // fflate post-processing: inject dataValidation XML
  const unzipped = unzipSync(new Uint8Array(xlsxBytes));
  const sheetKey = 'xl/worksheets/sheet1.xml';
  if (unzipped[sheetKey]) {
    let xml = strFromU8(unzipped[sheetKey]);
    const lastDataRow = L.FIRST_DATA_ROW + rows.length - 1;
    const dvXml =
      `<dataValidations count="1">` +
      `<dataValidation type="list" sqref="I5" showDropDown="0" ` +
      `showErrorMessage="0" showInputMessage="0">` +
      `<formula1>$A${L.FIRST_DATA_ROW}:$A${lastDataRow}</formula1>` +
      `</dataValidation></dataValidations>`;
    if (xml.includes('<ignoredErrors')) {
      xml = xml.replace('<ignoredErrors', dvXml + '<ignoredErrors');
    } else {
      xml = xml.replace('</worksheet>', dvXml + '</worksheet>');
    }
    unzipped[sheetKey] = strToU8(xml);
  }

  // Rezip and trigger download
  const rezipped = zipSync(unzipped);
  const blob = new Blob([rezipped], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `${filename}.xlsx`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
