/**
 * ExitTable
 * Displays early termination / exit analysis at each lease anniversary
 * and at lease expiration, showing paid-to-date and remaining balances.
 */

import { useMemo } from 'react';
import { buildExitTable } from '../engine/scenarioTables.js';
import { formatDollar } from '../utils/formatUtils.js';
import { formatDateMDY } from '../utils/dateUtils.js';

export default function ExitTable({ rows = [] }) {
  const checkpoints = useMemo(() => buildExitTable(rows), [rows]);

  if (!checkpoints.length) return null;

  return (
    <div>
      <h3 className="text-lg font-bold text-gray-900 mb-1">Exit Analysis</h3>
      <p className="text-xs text-gray-500 mb-3">
        Early termination exposure at each lease anniversary and at expiration.
      </p>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-800 text-white text-xs uppercase tracking-wide">
              <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Exit Point</th>
              <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Exit Date</th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Mo. Elapsed</th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Mo. Remaining</th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Base Paid to Date</th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Total Paid to Date</th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Base Rent Remaining</th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Total Remaining</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {checkpoints.map((cp, idx) => (
              <tr
                key={cp.exitDate + cp.label}
                className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
              >
                <td className="px-3 py-2 text-gray-800 font-medium whitespace-nowrap">{cp.label}</td>
                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{formatDateMDY(cp.exitDate)}</td>
                <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{cp.monthsElapsed}</td>
                <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{cp.monthsRemaining}</td>
                <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{formatDollar(cp.basePaidToDate)}</td>
                <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{formatDollar(cp.totalPaidToDate)}</td>
                <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{formatDollar(cp.baseRentRemaining)}</td>
                <td className="px-3 py-2 text-right text-gray-900 font-semibold tabular-nums">{formatDollar(cp.totalRemainingObligation)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
