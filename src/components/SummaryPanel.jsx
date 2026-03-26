/**
 * SummaryPanel
 * Summary metrics panel.
 */

import { useState, useMemo } from 'react';
import { formatDollar } from '../utils/formatUtils.js';
import { formatDateMDY } from '../utils/dateUtils.js';
import { parseISODate } from '../engine/yearMonth.js';

function MetricCard({ label, value, sub, emphasis = false }) {
  return (
    <div className={`rounded-[1.25rem] border p-4 shadow-panel ${
      emphasis
        ? 'border-accent/35 bg-app-panel-strong'
        : 'border-app-border bg-app-panel'
    }`}>
      <p className="section-kicker !text-[0.62rem]">{label}</p>
      <p className="mt-3 text-xl font-semibold text-txt-primary tabular-nums">{value}</p>
      {sub && <p className="mt-2 text-xs leading-5 text-txt-dim">{sub}</p>}
    </div>
  );
}

function DiscrepancyWarning({ label, expected, actual }) {
  const diff = Math.abs(expected - actual);
  if (diff < 0.01) return null;
  return (
    <div className="rounded-[1.1rem] border border-status-err-border bg-status-err-bg/90 p-4 text-sm text-status-err-text">
      <p className="font-display text-sm font-semibold text-status-err-title">
        Discrepancy detected in {label}
      </p>
      <p className="mt-2">
        Panel total {formatDollar(expected)} does not match row sum {formatDollar(actual)}.
        Difference: {formatDollar(diff)}.
      </p>
    </div>
  );
}

export default function SummaryPanel({ rows = [] }) {
  const [asOfDate, setAsOfDate] = useState('');

  const metrics = useMemo(() => {
    if (!rows.length) return null;

    const firstRow = rows[0];
    const lastRow = rows[rows.length - 1];

    let sumScheduledBase = 0;
    let sumBaseApplied = 0;
    let sumTotal = 0;
    let sumOneTimeCharges = 0;
    let sumOtherCharges = 0;
    let sumNNNTotal = 0;
    const chargeSums = {};

    for (const row of rows) {
      sumScheduledBase += row.scheduledBaseRent ?? 0;
      sumBaseApplied += row.baseRentApplied ?? 0;
      sumTotal += row.totalMonthlyObligation ?? 0;
      sumOneTimeCharges += row.oneTimeChargesAmount ?? 0;
      sumOtherCharges += row.totalOtherChargesAmount ?? 0;
      sumNNNTotal += row.totalNNNAmount ?? 0;

      if (row.chargeAmounts) {
        for (const [key, amount] of Object.entries(row.chargeAmounts)) {
          chargeSums[key] = (chargeSums[key] || 0) + (amount ?? 0);
        }
      } else {
        for (const key of ['cams', 'insurance', 'taxes', 'security', 'otherItems']) {
          chargeSums[key] = (chargeSums[key] || 0) + (row[`${key}Amount`] ?? 0);
        }
      }
    }

    const chargeLabels = {};
    if (firstRow.chargeDetails) {
      for (const [key, detail] of Object.entries(firstRow.chargeDetails)) {
        chargeLabels[key] = detail.displayLabel || key;
      }
    } else {
      chargeLabels.cams = 'CAMS';
      chargeLabels.insurance = 'Insurance';
      chargeLabels.taxes = 'Taxes';
      chargeLabels.security = 'Security';
      chargeLabels.otherItems = 'Other Items';
    }

    const remainingFromFirstRow = {
      total: firstRow.totalObligationRemaining,
      nnn: firstRow.totalNNNRemaining,
      base: firstRow.totalBaseRentRemaining,
    };

    let asOfRemaining = null;
    if (asOfDate) {
      const asOfParsed = parseISODate(asOfDate);
      if (asOfParsed) {
        const futureRow = rows.find((row) => {
          const periodStart = parseISODate(row.periodStart);
          return periodStart && periodStart >= asOfParsed;
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
      leaseStart: firstRow.periodStart,
      leaseEnd: lastRow.periodEnd ?? lastRow.periodStart,
      totalMonths: rows.length,
      sumScheduledBase,
      sumBaseApplied,
      chargeSums,
      chargeLabels,
      sumNNN: sumNNNTotal,
      sumTotal,
      sumOneTimeCharges,
      sumOtherCharges,
      remainingFromFirstRow,
      asOfRemaining,
    };
  }, [rows, asOfDate]);

  if (!metrics) return null;

  const {
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
  } = metrics;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-kicker">Schedule Overview</p>
          <h3 className="mt-2 text-2xl font-semibold text-txt-primary">Summary</h3>
        </div>
        <p className="max-w-xl text-sm leading-6 text-txt-muted">
          Cross-check the full-term obligation, recurring charges, and as-of remaining balance
          before exporting the final package.
        </p>
      </div>

      <DiscrepancyWarning label="Total Obligation" expected={remainingFromFirstRow?.total} actual={sumTotal} />
      <DiscrepancyWarning label="Total NNN" expected={remainingFromFirstRow?.nnn} actual={sumNNN} />
      <DiscrepancyWarning label="Total Base Rent" expected={remainingFromFirstRow?.base} actual={sumBaseApplied} />

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Lease Start" value={formatDateMDY(leaseStart)} />
        <MetricCard label="Lease Expiration" value={formatDateMDY(leaseEnd)} />
        <MetricCard label="Term (Months)" value={totalMonths} />
        <MetricCard
          label="Applied Base Rent"
          value={formatDollar(sumBaseApplied)}
          sub={`Scheduled base rent: ${formatDollar(sumScheduledBase)}`}
          emphasis
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Total Base Rent" value={formatDollar(sumBaseApplied)} />
        {Object.entries(chargeSums).map(([key, sum]) => (
          <MetricCard
            key={key}
            label={`Total ${chargeLabels[key] || key}`}
            value={formatDollar(sum)}
          />
        ))}
        <MetricCard label="Total One-Time Charges" value={formatDollar(sumOneTimeCharges)} />
        <MetricCard
          label="Total Other Charges"
          value={formatDollar(sumOtherCharges)}
          sub="Other-type recurring charges plus one-time items."
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <MetricCard label="Total NNN Obligation" value={formatDollar(sumNNN)} emphasis />
        <MetricCard label="Combined Total Obligation" value={formatDollar(sumTotal)} emphasis />
      </div>

      <div className="surface-panel px-5 py-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="section-kicker">Remaining Exposure</p>
            <h4 className="mt-2 text-lg font-semibold text-txt-primary">Remaining Balance (As-of Date)</h4>
          </div>
          <div className="w-full max-w-xs">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-txt-dim">
              As of
            </label>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="field-dark"
            />
          </div>
        </div>

        {asOfRemaining ? (
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <MetricCard label="Total Remaining" value={formatDollar(asOfRemaining.total)} />
            <MetricCard label="NNN Remaining" value={formatDollar(asOfRemaining.nnn)} />
            <MetricCard label="Base Remaining" value={formatDollar(asOfRemaining.base)} />
          </div>
        ) : (
          <p className="mt-5 text-sm text-txt-dim">
            Select a date to compute remaining obligations from that point forward.
          </p>
        )}
      </div>
    </section>
  );
}
