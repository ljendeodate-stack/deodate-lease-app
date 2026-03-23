/**
 * LedgerTable
 * Scrollable, paginated monthly ledger.
 * Dynamic charge columns from row.chargeAmounts / row.chargeDetails.
 */

import { useState, useMemo } from 'react';
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
      unresolved
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
        Prev
      </button>
      <span>Page {page + 1} of {totalPages}</span>
      <button
        onClick={() => onPage(page + 1)}
        disabled={page === totalPages - 1}
        className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
      >
        Next
      </button>
    </div>
  );
}

/**
 * Derive charge column definitions from the first row's chargeDetails.
 * Falls back to legacy hardcoded columns if chargeDetails is not present.
 */
function deriveChargeColumns(rows) {
  const firstRow = rows[0];
  if (firstRow?.chargeDetails && typeof firstRow.chargeDetails === 'object') {
    return Object.entries(firstRow.chargeDetails).map(([key, detail]) => ({
      key,
      label: detail.displayLabel || key,
    }));
  }
  // Legacy fallback
  return [
    { key: 'cams', label: 'CAMS' },
    { key: 'insurance', label: 'Insurance' },
    { key: 'taxes', label: 'Taxes' },
    { key: 'security', label: 'Security' },
    { key: 'otherItems', label: 'Other Items' },
  ];
}

export default function LedgerTable({ rows = [] }) {
  const [page, setPage] = useState(0);
  const [expandedIdx, setExpandedIdx] = useState(null);

  const chargeColumns = useMemo(() => deriveChargeColumns(rows), [rows]);
  const totalColSpan = 10 + chargeColumns.length + 7; // expand/dates/year/month/rent/applied/abatement + charges + nnn/ot/othercharges/total/sf/remaining*3

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
              <Th>Abatement</Th>
              <Th>Proration Factor</Th>
              {chargeColumns.map((ch) => (
                <Th key={ch.key}>{ch.label} ($)</Th>
              ))}
              <Th>Total NNN</Th>
              <Th>One-Time ($)</Th>
              <Th>Other Charges ($)</Th>
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
                      {isExpanded ? String.fromCharCode(9660) : String.fromCharCode(9654)}
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
                    <Td>{formatDollar(row.abatementAmount ?? 0)}</Td>
                    <Td className="font-mono text-gray-500">{formatFactor(row.baseRentProrationFactor)}</Td>

                    {/* Dynamic charge columns */}
                    {chargeColumns.map((ch) => {
                      const detail = row.chargeDetails?.[ch.key];
                      const amount = row.chargeAmounts?.[ch.key] ?? row[`${ch.key}Amount`] ?? 0;
                      const active = detail?.active ?? row[`${ch.key}Active`];
                      return (
                        <Td key={ch.key}>
                          {active === false
                            ? <span className="text-gray-400 italic text-xs">inactive</span>
                            : formatDollar(amount)}
                        </Td>
                      );
                    })}

                    <Td>{formatDollar(row.totalNNNAmount ?? 0)}</Td>
                    <Td>
                      {row.oneTimeChargesAmount
                        ? <span
                            className={`cursor-help ${row.oneTimeChargesAmount < 0 ? 'text-green-700' : ''}`}
                            title={Object.entries(row.oneTimeItemAmounts ?? {})
                              .filter(([, v]) => v !== 0)
                              .map(([label, amt]) => `${label}: ${amt.toLocaleString()}`)
                              .join('\n') || 'One-time charge'}
                          >
                            {formatDollar(row.oneTimeChargesAmount)}
                          </span>
                        : <span className="text-gray-300">-</span>
                      }
                    </Td>
                    <Td>{formatDollar(row.totalOtherChargesAmount)}</Td>
                    <Td className="font-semibold">{formatDollar(row.totalMonthlyObligation)}</Td>
                    <Td>{formatDollarPerSF(row.effectivePerSF)}</Td>
                    <Td>{formatDollar(row.totalObligationRemaining)}</Td>
                    <Td>{formatDollar(row.totalNNNRemaining)}</Td>
                    <Td>{formatDollar(row.totalBaseRentRemaining)}</Td>
                  </tr>
                  {isExpanded && (
                    <tr key={`trace-${absIdx}`}>
                      <td colSpan={totalColSpan} className="p-0">
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
