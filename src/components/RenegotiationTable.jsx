/**
 * RenegotiationTable
 * Displays renegotiation checkpoints at lease anniversaries and
 * pre-expiration milestones with remaining obligation breakdowns.
 */

import { useMemo } from 'react';
import { buildRenegotiationTable } from '../engine/scenarioTables.js';
import { formatDollar } from '../utils/formatUtils.js';
import { formatDateMDY } from '../utils/dateUtils.js';

export default function RenegotiationTable({ rows = [] }) {
  const checkpoints = useMemo(() => buildRenegotiationTable(rows), [rows]);

  if (!checkpoints.length) return null;

  return (
    <div>
      <h3 className="text-lg font-bold text-gray-900 mb-1">Renegotiation Analysis</h3>
      <p className="text-xs text-gray-500 mb-3">
        Remaining obligation at each lease anniversary and at 12, 9, 6, and 3 months before expiration.
      </p>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-800 text-white text-xs uppercase tracking-wide">
              <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Checkpoint</th>
              <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Date</th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Mo. Remaining</th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Base Rent Remaining</th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">NNN Remaining</th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Other Charges Remaining</th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Total Remaining</th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Avg. Monthly Remaining</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {checkpoints.map((cp, idx) => (
              <tr
                key={cp.checkpointDate + cp.label}
                className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
              >
                <td className="px-3 py-2 text-gray-800 font-medium whitespace-nowrap">{cp.label}</td>
                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{formatDateMDY(cp.checkpointDate)}</td>
                <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{cp.monthsRemaining}</td>
                <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{formatDollar(cp.baseRentRemaining)}</td>
                <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{formatDollar(cp.nnnRemaining)}</td>
                <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{formatDollar(cp.otherChargesRemaining)}</td>
                <td className="px-3 py-2 text-right text-gray-900 font-semibold tabular-nums">{formatDollar(cp.totalRemainingObligation)}</td>
                <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{formatDollar(cp.avgMonthlyRemaining)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
