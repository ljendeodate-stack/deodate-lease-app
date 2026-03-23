/**
 * SummaryPanel
 * Summary metrics panel (Section 4, Summary Metrics Panel).
 * - Ties out to sum of monthly ledger rows
 * - Discrepancies flagged visibly
 * - As-of-date remaining balance selector
 */

import { useState, useMemo } from 'react';
import { formatDollar, formatPercent } from '../utils/formatUtils.js';
import { formatDateMDY, monthsBetween } from '../utils/dateUtils.js';
import { parseISODate } from '../engine/yearMonth.js';

function MetricCard({ label, value, sub }) {
  return (
    <div className="rounded-lg bg-white border border-gray-200 p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-lg font-bold text-gray-900 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function DiscrepancyWarning({ label, expected, actual }) {
  const diff = Math.abs(expected - actual);
  if (diff < 0.01) return null;
  return (
    <div className="rounded-md bg-red-50 border border-red-300 p-3 text-sm text-red-700">
      ⚠ <strong>Discrepancy detected in {label}</strong>: panel total{' '}
      {formatDollar(expected)} ≠ row sum {formatDollar(actual)} (diff: {formatDollar(diff)})
    </div>
  );
}

export default function SummaryPanel({ rows = [] }) {
  const [asOfDate, setAsOfDate] = useState('');

  const metrics = useMemo(() => {
    if (!rows.length) return null;

    const firstRow = rows[0];
    const lastRow = rows[rows.length - 1];

    const totalMonths = rows.length;
    const leaseStart = firstRow.periodStart;
    const leaseEnd = lastRow.periodEnd ?? lastRow.periodStart;

    // Sum from rows — dynamic charge sums
    let sumScheduledBase = 0;
    let sumBaseApplied = 0;
    let sumTotal = 0;
    let sumOneTimeCharges = 0;
    let sumOtherCharges = 0;
    let sumNNNTotal = 0;

    // Build dynamic charge sums
    const chargeSums = {};
    for (const r of rows) {
      sumScheduledBase += r.scheduledBaseRent ?? 0;
      sumBaseApplied += r.baseRentApplied ?? 0;
      sumTotal += r.totalMonthlyObligation ?? 0;
      sumOneTimeCharges += r.oneTimeChargesAmount ?? 0;
      sumOtherCharges += r.totalOtherChargesAmount ?? 0;
      sumNNNTotal += r.totalNNNAmount ?? 0;

      // Accumulate per-charge sums
      if (r.chargeAmounts) {
        for (const [key, amt] of Object.entries(r.chargeAmounts)) {
          chargeSums[key] = (chargeSums[key] || 0) + (amt ?? 0);
        }
      } else {
        // Legacy fallback
        for (const key of ['cams', 'insurance', 'taxes', 'security', 'otherItems']) {
          chargeSums[key] = (chargeSums[key] || 0) + (r[`${key}Amount`] ?? 0);
        }
      }
    }

    // Derive charge labels from the first row
    const chargeLabels = {};
    if (firstRow.chargeDetails) {
      for (const [key, detail] of Object.entries(firstRow.chargeDetails)) {
        chargeLabels[key] = detail.displayLabel || key;
      }
    } else {
      chargeLabels.cams = 'CAMS'; chargeLabels.insurance = 'Insurance';
      chargeLabels.taxes = 'Taxes'; chargeLabels.security = 'Security';
      chargeLabels.otherItems = 'Other Items';
    }

    const sumNNN = sumNNNTotal;

    // The first row's "remaining" fields contain the full-term totals (reverse pass)
    const remainingFromFirstRow = {
      total: firstRow.totalObligationRemaining,
      nnn: firstRow.totalNNNRemaining,
      base: firstRow.totalBaseRentRemaining,
    };

    // As-of remaining
    let asOfRemaining = null;
    if (asOfDate) {
      const asOfParsed = parseISODate(asOfDate);
      if (asOfParsed) {
        const futureRow = rows.find((r) => {
          const d = parseISODate(r.periodStart);
          return d && d >= asOfParsed;
        });
        if (futureRow) {
          asOfRemaining = {
            total: futureRow.totalObligationRemaining,
            nnn: futureRow.totalNNNRemaining,
            base: futureRow.totalBaseRentRemaining,
          };
        } else {
          asOfRemaining = { total: 0, nnn: 0, base: 0 };
        }
      }
    }

    return {
      leaseStart,
      leaseEnd,
      totalMonths,
      sumScheduledBase,
      sumBaseApplied,
      chargeSums,
      chargeLabels,
      sumNNN,
      sumTotal,
      sumOneTimeCharges,
      sumOtherCharges,
      remainingFromFirstRow,
      asOfRemaining,
    };
  }, [rows, asOfDate]);

  if (!metrics) return null;

  const {
    leaseStart, leaseEnd, totalMonths,
    sumScheduledBase, sumBaseApplied,
    chargeSums, chargeLabels,
    sumNNN, sumTotal, sumOneTimeCharges, sumOtherCharges,
    remainingFromFirstRow, asOfRemaining,
  } = metrics;

  // Cross-check: sum of rows should match first-row remaining
  const totalDiscrepancy = Math.abs(sumTotal - (remainingFromFirstRow?.total ?? 0));
  const nnnDiscrepancy = Math.abs(sumNNN - (remainingFromFirstRow?.nnn ?? 0));
  const baseDiscrepancy = Math.abs(sumBaseApplied - (remainingFromFirstRow?.base ?? 0));

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-gray-900">Summary</h3>

      {/* Discrepancy flags */}
      <DiscrepancyWarning label="Total Obligation" expected={remainingFromFirstRow?.total} actual={sumTotal} />
      <DiscrepancyWarning label="Total NNN" expected={remainingFromFirstRow?.nnn} actual={sumNNN} />
      <DiscrepancyWarning label="Total Base Rent" expected={remainingFromFirstRow?.base} actual={sumBaseApplied} />

      {/* Lease term */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Lease Start" value={formatDateMDY(leaseStart)} />
        <MetricCard label="Lease Expiration" value={formatDateMDY(leaseEnd)} />
        <MetricCard label="Term (Months)" value={totalMonths} />
        <MetricCard
          label="Scheduled vs Applied Base"
          value={formatDollar(sumBaseApplied)}
          sub={`Scheduled: ${formatDollar(sumScheduledBase)}`}
        />
      </div>

      {/* Obligation breakdown — dynamic charge cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <MetricCard label="Total Base Rent (Applied)" value={formatDollar(sumBaseApplied)} />
        {Object.entries(chargeSums).map(([key, sum]) => (
          <MetricCard key={key} label={`Total ${chargeLabels[key] || key}`} value={formatDollar(sum)} />
        ))}
        <MetricCard label="Total One-Time Charges" value={formatDollar(sumOneTimeCharges)} />
        <MetricCard label="Total Other Charges" value={formatDollar(sumOtherCharges)}
          sub="Other-type charges + One-Time" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label="Total NNN Obligation"
          value={formatDollar(sumNNN)}
        />
        <MetricCard
          label="Combined Total Obligation"
          value={formatDollar(sumTotal)}
        />
      </div>

      {/* As-of remaining balance */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
        <h4 className="text-sm font-semibold text-blue-800">Remaining Balance (As-of Date)</h4>
        <div className="flex items-center gap-3">
          <label className="text-sm text-blue-700">As of:</label>
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="rounded border border-blue-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
        {asOfRemaining && (
          <div className="grid grid-cols-3 gap-3">
            <MetricCard label="Total Remaining" value={formatDollar(asOfRemaining.total)} />
            <MetricCard label="NNN Remaining" value={formatDollar(asOfRemaining.nnn)} />
            <MetricCard label="Base Remaining" value={formatDollar(asOfRemaining.base)} />
          </div>
        )}
        {!asOfDate && (
          <p className="text-xs text-blue-600">Select a date to compute remaining obligations from that point forward.</p>
        )}
      </div>
    </div>
  );
}
