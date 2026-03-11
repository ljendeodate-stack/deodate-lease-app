/**
 * LedgerTable
 * Scrollable, paginated monthly ledger (Section 4).
 * - One row per lease month
 * - Abatement rows visually distinguished (amber background)
 * - Unresolved values display a visible flag rather than silent zero
 * - Each row expandable to show TracePanel
 * Flaw 3 fix: all values formatted per formatUtils conventions.
 */

import { useState } from 'react';
import TracePanel from './TracePanel.jsx';
import {
  formatDollar,
  formatDollarPerSF,
  formatPercent,
  formatFactor,
} from '../utils/formatUtils.js';
import { formatDateMDY } from '../utils/dateUtils.js';

const PAGE_SIZE = 25;

function Th({ children, className = '' }) {
  return (
    <th className={`px-2 py-2 text-left text-xs font-semibold text-gray-600 whitespace-nowrap bg-gray-100 sticky top-0 ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, className = '' }) {
  return (
    <td className={`px-2 py-1.5 text-xs whitespace-nowrap ${className}`}>
      {children}
    </td>
  );
}

function UnresolvedFlag() {
  return (
    <span className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
      ⚠ unresolved
    </span>
  );
}

function Paginator({ page, totalPages, onPage }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-2 py-2 border-t border-gray-200 text-xs text-gray-600">
      <button
        onClick={() => onPage(page - 1)}
        disabled={page === 0}
        className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
      >
        ← Prev
      </button>
      <span>Page {page + 1} of {totalPages}</span>
      <button
        onClick={() => onPage(page + 1)}
        disabled={page === totalPages - 1}
        className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
      >
        Next →
      </button>
    </div>
  );
}

export default function LedgerTable({ rows = [] }) {
  const [page, setPage] = useState(0);
  const [expandedIdx, setExpandedIdx] = useState(null);

  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function toggleRow(absIdx) {
    setExpandedIdx((prev) => (prev === absIdx ? null : absIdx));
  }

  if (!rows.length) return null;

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
        <table className="min-w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <Th></Th>
              <Th>Period Start</Th>
              <Th>Period End</Th>
              <Th>Year #</Th>
              <Th>Month #</Th>
              <Th>Scheduled Base Rent</Th>
              <Th>Base Rent Applied</Th>
              <Th>Proration Factor</Th>
              <Th>CAMS ($)</Th>
              <Th>CAMS Esc</Th>
              <Th>Insurance ($)</Th>
              <Th>Ins Esc</Th>
              <Th>Taxes ($)</Th>
              <Th>Tax Esc</Th>
              <Th>Security ($)</Th>
              <Th>Sec Esc</Th>
              <Th>Other ($)</Th>
              <Th>Other Esc</Th>
              <Th>Total Monthly</Th>
              <Th>$/SF</Th>
              <Th>Total Remaining</Th>
              <Th>NNN Remaining</Th>
              <Th>Base Remaining</Th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, localIdx) => {
              const absIdx = page * PAGE_SIZE + localIdx;
              const isAbatement = row.isAbatementRow;
              const isExpanded = expandedIdx === absIdx;
              const rowBg = isAbatement
                ? 'bg-amber-50 hover:bg-amber-100'
                : 'bg-white hover:bg-gray-50';

              return (
                <>
                  <tr
                    key={absIdx}
                    className={`${rowBg} cursor-pointer border-b border-gray-100 transition-colors`}
                    onClick={() => toggleRow(absIdx)}
                  >
                    <Td className="text-gray-400 select-none">
                      {isExpanded ? '▼' : '▶'}
                    </Td>
                    <Td>{formatDateMDY(row.periodStart)}</Td>
                    <Td>{formatDateMDY(row.periodEnd)}</Td>
                    <Td>{row.leaseYear}</Td>
                    <Td>{row.leaseMonth}</Td>
                    <Td>{row.scheduledBaseRent != null ? formatDollar(row.scheduledBaseRent) : <UnresolvedFlag />}</Td>
                    <Td>
                      {isAbatement && (
                        <span className="mr-1 text-amber-700 font-semibold text-xs">[ABATED]</span>
                      )}
                      {row.baseRentApplied != null ? formatDollar(row.baseRentApplied) : <UnresolvedFlag />}
                    </Td>
                    <Td className="font-mono text-gray-500">{formatFactor(row.baseRentProrationFactor)}</Td>
                    <Td>{row.camsActive === false ? <span className="text-gray-400 italic text-xs">inactive</span> : formatDollar(row.camsAmount)}</Td>
                    <Td>{formatPercent(row.camsEscPct)}</Td>
                    <Td>{row.insuranceActive === false ? <span className="text-gray-400 italic text-xs">inactive</span> : formatDollar(row.insuranceAmount)}</Td>
                    <Td>{formatPercent(row.insuranceEscPct)}</Td>
                    <Td>{row.taxesActive === false ? <span className="text-gray-400 italic text-xs">inactive</span> : formatDollar(row.taxesAmount)}</Td>
                    <Td>{formatPercent(row.taxesEscPct)}</Td>
                    <Td>{row.securityActive === false ? <span className="text-gray-400 italic text-xs">inactive</span> : formatDollar(row.securityAmount)}</Td>
                    <Td>{formatPercent(row.securityEscPct)}</Td>
                    <Td>{row.otherItemsActive === false ? <span className="text-gray-400 italic text-xs">inactive</span> : formatDollar(row.otherItemsAmount)}</Td>
                    <Td>{formatPercent(row.otherItemsEscPct)}</Td>
                    <Td className="font-semibold">{formatDollar(row.totalMonthlyObligation)}</Td>
                    <Td>{formatDollarPerSF(row.effectivePerSF)}</Td>
                    <Td>{formatDollar(row.totalObligationRemaining)}</Td>
                    <Td>{formatDollar(row.totalNNNRemaining)}</Td>
                    <Td>{formatDollar(row.totalBaseRentRemaining)}</Td>
                  </tr>
                  {isExpanded && (
                    <tr key={`trace-${absIdx}`}>
                      <td colSpan={23} className="p-0">
                        <TracePanel row={row} />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
      <Paginator page={page} totalPages={totalPages} onPage={setPage} />
    </div>
  );
}
