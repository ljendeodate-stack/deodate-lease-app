/**
 * ExitTable
 * Displays early termination / exit analysis.
 */

import { useMemo } from 'react';
import { buildExitTable } from '../engine/scenarioTables.js';
import { formatDollar } from '../utils/formatUtils.js';
import { formatDateMDY } from '../utils/dateUtils.js';

export default function ExitTable({ rows = [] }) {
  const checkpoints = useMemo(() => buildExitTable(rows), [rows]);

  if (!checkpoints.length) return null;

  return (
    <section className="space-y-3">
      <div>
        <p className="section-kicker">Scenario Analysis</p>
        <h3 className="mt-2 text-xl font-semibold text-txt-primary">Exit Analysis</h3>
        <p className="mt-2 text-sm text-txt-muted">
          Early termination exposure at each lease anniversary and at expiration.
        </p>
      </div>

      <div className="overflow-x-auto rounded-[1.25rem] border border-app-border bg-app-panel shadow-panel">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-app-panel-strong text-[0.68rem] uppercase tracking-[0.18em] text-txt-dim">
              <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Exit Point</th>
              <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Exit Date</th>
              <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">Mo. Elapsed</th>
              <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">Mo. Remaining</th>
              <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">Base Paid to Date</th>
              <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">Total Paid to Date</th>
              <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">Base Rent Remaining</th>
              <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">Total Remaining</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border">
            {checkpoints.map((checkpoint, idx) => (
              <tr
                key={checkpoint.exitDate + checkpoint.label}
                className={idx % 2 === 0 ? 'bg-app-chrome' : 'bg-app-surface'}
              >
                <td className="px-3 py-3 font-medium whitespace-nowrap text-txt-primary">{checkpoint.label}</td>
                <td className="px-3 py-3 whitespace-nowrap text-txt-muted">{formatDateMDY(checkpoint.exitDate)}</td>
                <td className="px-3 py-3 text-right font-mono text-txt-muted">{checkpoint.monthsElapsed}</td>
                <td className="px-3 py-3 text-right font-mono text-txt-muted">{checkpoint.monthsRemaining}</td>
                <td className="px-3 py-3 text-right font-mono text-txt-muted">{formatDollar(checkpoint.basePaidToDate)}</td>
                <td className="px-3 py-3 text-right font-mono text-txt-muted">{formatDollar(checkpoint.totalPaidToDate)}</td>
                <td className="px-3 py-3 text-right font-mono text-txt-muted">{formatDollar(checkpoint.baseRentRemaining)}</td>
                <td className="px-3 py-3 text-right font-mono font-semibold text-txt-primary">{formatDollar(checkpoint.totalRemainingObligation)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
