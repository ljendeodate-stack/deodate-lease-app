/**
 * RenegotiationTable
 * Displays renegotiation checkpoints with remaining obligation breakdowns.
 */

import { useMemo } from 'react';
import { buildRenegotiationTable } from '../engine/scenarioTables.js';
import { formatDollar } from '../utils/formatUtils.js';
import { formatDateMDY } from '../utils/dateUtils.js';

export default function RenegotiationTable({ rows = [] }) {
  const checkpoints = useMemo(() => buildRenegotiationTable(rows), [rows]);

  if (!checkpoints.length) return null;

  return (
    <section className="space-y-3">
      <div>
        <p className="section-kicker">Scenario Analysis</p>
        <h3 className="mt-2 text-xl font-semibold text-txt-primary">Renegotiation Analysis</h3>
        <p className="mt-2 text-sm text-txt-muted">
          Remaining obligation at each lease anniversary and at 12, 9, 6, and 3 months before expiration.
        </p>
      </div>

      <div className="overflow-x-auto rounded-[1.25rem] border border-app-border bg-app-panel shadow-panel">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-app-panel-strong text-[0.68rem] uppercase tracking-[0.18em] text-txt-dim">
              <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Checkpoint</th>
              <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Date</th>
              <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">Mo. Remaining</th>
              <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">Base Rent Remaining</th>
              <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">NNN Remaining</th>
              <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">Other Charges Remaining</th>
              <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">Total Remaining</th>
              <th className="px-3 py-3 text-right font-semibold whitespace-nowrap">Avg. Monthly Remaining</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border">
            {checkpoints.map((checkpoint, idx) => (
              <tr
                key={checkpoint.checkpointDate + checkpoint.label}
                className={idx % 2 === 0 ? 'bg-app-chrome' : 'bg-app-surface'}
              >
                <td className="px-3 py-3 font-medium whitespace-nowrap text-txt-primary">{checkpoint.label}</td>
                <td className="px-3 py-3 whitespace-nowrap text-txt-muted">{formatDateMDY(checkpoint.checkpointDate)}</td>
                <td className="px-3 py-3 text-right font-mono text-txt-muted">{checkpoint.monthsRemaining}</td>
                <td className="px-3 py-3 text-right font-mono text-txt-muted">{formatDollar(checkpoint.baseRentRemaining)}</td>
                <td className="px-3 py-3 text-right font-mono text-txt-muted">{formatDollar(checkpoint.nnnRemaining)}</td>
                <td className="px-3 py-3 text-right font-mono text-txt-muted">{formatDollar(checkpoint.otherChargesRemaining)}</td>
                <td className="px-3 py-3 text-right font-mono font-semibold text-txt-primary">{formatDollar(checkpoint.totalRemainingObligation)}</td>
                <td className="px-3 py-3 text-right font-mono text-txt-muted">{formatDollar(checkpoint.avgMonthlyRemaining)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
