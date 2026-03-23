/**
 * @fileoverview CSV export — moved from exportUtils.js unchanged.
 */

import Papa from 'papaparse';
import { CANONICAL_TYPES } from '../engine/chargeTypes.js';

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

export function exportToCSV(rows, params = {}, filename = 'lease-schedule') {
  const charges = resolveCharges(params);

  const fixedCols = [
    { key: 'periodStart',              label: 'Period Start' },
    { key: 'periodEnd',                label: 'Period End' },
    { key: 'leaseYear',                label: 'Lease Year #' },
    { key: 'leaseMonth',               label: 'Lease Month #' },
    { key: 'scheduledBaseRent',        label: 'Scheduled Base Rent ($)' },
    { key: 'baseRentApplied',          label: 'Base Rent Applied ($)' },
    { key: 'abatementAmount',          label: 'Abatement ($)' },
  ];

  const chargeCols = charges.map((ch) => ({
    key: ch.key,
    label: `${ch.displayLabel} ($)`,
    accessor: (row) => row.chargeAmounts?.[ch.key] ?? row[`${ch.key}Amount`] ?? 0,
  }));

  const tailCols = [
    { key: 'totalNNNAmount',             label: 'Total NNN ($)' },
    { key: 'oneTimeChargesAmount',       label: 'One-time Charges ($)' },
    { key: 'totalMonthlyObligation',     label: 'Total Monthly Obligation ($)' },
    { key: 'effectivePerSF',             label: 'Effective $/SF' },
    { key: 'totalObligationRemaining',   label: 'Total Obligation Remaining ($)' },
    { key: 'totalBaseRentRemaining',     label: 'Base Rent Remaining ($)' },
    { key: 'totalNNNRemaining',          label: 'NNN Remaining ($)' },
    { key: 'totalOtherChargesRemaining', label: 'Other Charges Remaining ($)' },
  ];

  const data = rows.map((row) => {
    const obj = {};
    for (const c of fixedCols) obj[c.label] = row[c.key] ?? '';
    for (const c of chargeCols) obj[c.label] = c.accessor(row);
    for (const c of tailCols) obj[c.label] = row[c.key] ?? '';
    return obj;
  });

  const csv  = Papa.unparse(data);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
