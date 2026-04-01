/**
 * LedgerTable
 * Scrollable, paginated monthly ledger.
 * Dynamic charge columns from row.chargeAmounts / row.chargeDetails.
 */

import { Fragment, useState, useMemo } from 'react';
import TracePanel from './TracePanel.jsx';
import {
  formatDollar,
  formatDollarPerSF,
  formatFactor,
} from '../utils/formatUtils.js';
import { formatDateMDY } from '../utils/dateUtils.js';
import {
  INLINE_SCENARIO_COLUMNS,
  INLINE_SCENARIO_EXIT_GROUP_PREVIEW,
  INLINE_SCENARIO_EXIT_GROUP_TITLE,
  INLINE_SCENARIO_RENEGO_GROUP_PREVIEW,
  INLINE_SCENARIO_RENEGO_GROUP_TITLE,
  deriveInlineScenarioValues,
} from '../export/derived/inlineScenarioColumns.js';

const PAGE_SIZE = 25;
const GROUP_HEADER_TOP_PX = 0;
const COLUMN_HEADER_TOP_PX = 34;
const LEASE_SCHEDULE_GROUP = {
  key: 'leaseSchedule',
  title: 'Lease Schedule',
  previewFill: '#1F3864',
};

function Th({ children, className = '', stickyTop = COLUMN_HEADER_TOP_PX, style = {} }) {
  return (
    <th
      className={`bg-app-panel-strong px-3 py-3 text-left text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-txt-dim whitespace-nowrap sticky border-b border-app-border ${className}`}
      style={{ top: `${stickyTop}px`, ...style }}
    >
      {children}
    </th>
  );
}

function Td({ children, className = '' }) {
  return (
    <td className={`px-3 py-2 text-xs whitespace-nowrap text-txt-primary ${className}`}>
      {children}
    </td>
  );
}

function UnresolvedFlag() {
  return (
    <span className="status-chip border-status-err-border bg-status-err-bg text-status-err-text">
      unresolved
    </span>
  );
}

function IrregularFlag() {
  return (
    <span className="mr-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-status-err-title">
      Irregular
    </span>
  );
}

function Paginator({ page, totalPages, onPage }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-app-border bg-app-panel px-3 py-3 text-xs text-txt-muted">
      <button
        onClick={() => onPage(page - 1)}
        disabled={page === 0}
        className="btn-ghost !px-3 !py-1.5 !text-xs disabled:opacity-40"
      >
        Prev
      </button>
      <span className="font-mono">Page {page + 1} of {totalPages}</span>
      <button
        onClick={() => onPage(page + 1)}
        disabled={page === totalPages - 1}
        className="btn-ghost !px-3 !py-1.5 !text-xs disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}

function deriveChargeColumns(rows) {
  const firstRow = rows[0];
  if (firstRow?.chargeDetails && typeof firstRow.chargeDetails === 'object') {
    return Object.entries(firstRow.chargeDetails).map(([key, detail]) => ({
      key,
      label: detail.displayLabel || key,
    }));
  }
  return [
    { key: 'cams', label: 'CAMS' },
    { key: 'insurance', label: 'Insurance' },
    { key: 'taxes', label: 'Taxes' },
    { key: 'security', label: 'Security' },
    { key: 'otherItems', label: 'Other Items' },
  ];
}

function deriveScenarioGroups(columns) {
  const groups = [];

  for (const column of columns) {
    const lastGroup = groups[groups.length - 1];

    if (lastGroup?.key === column.scenarioGroup) {
      lastGroup.columns.push(column);
      continue;
    }

    groups.push({
      key: column.scenarioGroup,
      title: column.scenarioGroup === 'renego'
        ? INLINE_SCENARIO_RENEGO_GROUP_TITLE
        : INLINE_SCENARIO_EXIT_GROUP_TITLE,
      previewFill: column.scenarioGroup === 'renego'
        ? INLINE_SCENARIO_RENEGO_GROUP_PREVIEW
        : INLINE_SCENARIO_EXIT_GROUP_PREVIEW,
      columns: [column],
    });
  }

  return groups;
}

export default function LedgerTable({ rows = [] }) {
  const [page, setPage] = useState(0);
  const [expandedIdx, setExpandedIdx] = useState(null);

  const chargeColumns = useMemo(() => deriveChargeColumns(rows), [rows]);
  const scenarioColumns = INLINE_SCENARIO_COLUMNS;
  const scenarioGroups = useMemo(() => deriveScenarioGroups(scenarioColumns), [scenarioColumns]);
  const totalColSpan = 10 + chargeColumns.length + 7 + scenarioColumns.length;
  const staticColumnsCount = totalColSpan - scenarioColumns.length;
  const columnGroups = [
    { ...LEASE_SCHEDULE_GROUP, colSpan: staticColumnsCount },
    ...scenarioGroups.map((group) => ({ ...group, colSpan: group.columns.length })),
  ];
  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function toggleRow(absIdx) {
    setExpandedIdx((prev) => (prev === absIdx ? null : absIdx));
  }

  if (!rows.length) return null;

  return (
    <div className="overflow-hidden rounded-[1.25rem] border border-app-border bg-app-panel shadow-panel">
      <div className="max-h-[600px] overflow-x-auto overflow-y-auto">
        <table className="min-w-full border-separate border-spacing-0">
          <thead>
            <tr>
              {columnGroups.map((group) => (
                <th
                  key={group.key}
                  colSpan={group.colSpan}
                  className="sticky border-b border-app-border px-3 py-2 text-left text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white"
                  style={{ top: `${GROUP_HEADER_TOP_PX}px`, backgroundColor: group.previewFill }}
                >
                  {group.title}
                </th>
              ))}
            </tr>
            <tr>
              <Th />
              <Th>Period Start</Th>
              <Th>Period End</Th>
              <Th>Year</Th>
              <Th>Lease Month #</Th>
              <Th>Scheduled Base</Th>
              <Th>Applied Base</Th>
              <Th>Abatement</Th>
              <Th>Proration</Th>
              {chargeColumns.map((charge) => (
                <Th key={charge.key}>{charge.label}</Th>
              ))}
              <Th>Total NNN</Th>
              <Th>One-Time</Th>
              <Th>Other Charges</Th>
              <Th>Total Monthly</Th>
              <Th>$/SF</Th>
              <Th>Total Remaining</Th>
              <Th>NNN Remaining</Th>
              <Th>Base Remaining</Th>
              {scenarioGroups.flatMap((group) => group.columns.map((column, index) => (
                <Th
                  key={column.key}
                  className={`whitespace-normal text-white min-w-[14rem] ${index === 0 ? 'border-l-4 border-l-white/60' : ''}`}
                  style={{ backgroundColor: column.previewHeaderFill }}
                >
                  {column.previewHeader}
                </Th>
              )))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, localIdx) => {
              const absIdx = page * PAGE_SIZE + localIdx;
              const inlineScenarioValues = deriveInlineScenarioValues(row);
              const isExpanded = expandedIdx === absIdx;
              const irregularTitle = row.irregularEscalationLabels?.length > 0
                ? `Irregular escalation: ${row.irregularEscalationLabels.join(', ')}`
                : undefined;
              const rowTone = row.isAbatementRow
                ? 'bg-status-warn-bg/55 hover:bg-status-warn-bg/80'
                : absIdx % 2 === 0
                ? 'bg-app-chrome hover:bg-app-surface'
                : 'bg-app-surface/70 hover:bg-app-panel-strong';

              return (
                <Fragment key={absIdx}>
                  <tr
                    key={absIdx}
                    className={`${rowTone} cursor-pointer border-b border-app-border transition-colors`}
                    onClick={() => toggleRow(absIdx)}
                  >
                    <Td className="text-txt-dim">{isExpanded ? 'v' : '>'}</Td>
                    <Td>{formatDateMDY(row.periodStart)}</Td>
                    <Td>{formatDateMDY(row.periodEnd)}</Td>
                    <Td className="font-mono text-txt-muted">{row.leaseYear}</Td>
                    <Td className="font-mono text-txt-primary">{row.leaseMonth ?? '-'}</Td>
                    <Td title={row.isIrregularBaseRent ? irregularTitle : undefined}>
                      {row.isIrregularBaseRent && <IrregularFlag />}
                      <span className={row.isIrregularBaseRent ? 'font-semibold text-status-err-title' : ''}>
                        {row.scheduledBaseRent != null ? formatDollar(row.scheduledBaseRent) : <UnresolvedFlag />}
                      </span>
                    </Td>
                    <Td title={row.isIrregularBaseRent ? irregularTitle : undefined}>
                      {row.isConcessionRow && (
                        <span className="mr-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-status-warn-title">
                          Concession
                        </span>
                      )}
                      {row.isIrregularBaseRent && <IrregularFlag />}
                      <span className={row.isIrregularBaseRent ? 'font-semibold text-status-err-title' : ''}>
                        {row.baseRentApplied != null ? formatDollar(row.baseRentApplied) : <UnresolvedFlag />}
                      </span>
                    </Td>
                    <Td>{formatDollar(row.abatementAmount ?? 0)}</Td>
                    <Td className="font-mono text-txt-muted">{formatFactor(row.baseRentProrationFactor)}</Td>

                    {chargeColumns.map((charge) => {
                      const detail = row.chargeDetails?.[charge.key];
                      const amount = row.chargeAmounts?.[charge.key] ?? row[`${charge.key}Amount`] ?? 0;
                      const active = detail?.active ?? row[`${charge.key}Active`];
                      return (
                        <Td
                          key={charge.key}
                          title={detail?.overrideApplied ? `Irregular escalation: ${detail.displayLabel || charge.label}` : undefined}
                        >
                          {active === false
                            ? <span className="text-txt-faint italic">inactive</span>
                            : (
                              <>
                                {detail?.overrideApplied && <IrregularFlag />}
                                <span className={detail?.overrideApplied ? 'font-semibold text-status-err-title' : ''}>
                                  {formatDollar(amount)}
                                </span>
                              </>
                            )}
                        </Td>
                      );
                    })}

                    <Td>{formatDollar(row.totalNNNAmount ?? 0)}</Td>
                    <Td>
                      {row.oneTimeChargesAmount ? (
                        <span
                          className={row.oneTimeChargesAmount < 0 ? 'text-status-ok-text' : ''}
                          title={Object.entries(row.oneTimeItemAmounts ?? {})
                            .filter(([, value]) => value !== 0)
                            .map(([label, value]) => `${label}: ${value.toLocaleString()}`)
                            .join('\n') || 'One-time charge'}
                        >
                          {formatDollar(row.oneTimeChargesAmount)}
                        </span>
                      ) : (
                        <span className="text-txt-faint">-</span>
                      )}
                    </Td>
                    <Td>{formatDollar(row.totalOtherChargesAmount)}</Td>
                    <Td className="font-semibold text-txt-primary">{formatDollar(row.totalMonthlyObligation)}</Td>
                    <Td>{formatDollarPerSF(row.effectivePerSF)}</Td>
                    <Td>{formatDollar(row.totalObligationRemaining)}</Td>
                    <Td>{formatDollar(row.totalNNNRemaining)}</Td>
                    <Td>{formatDollar(row.totalBaseRentRemaining)}</Td>
                    {scenarioGroups.flatMap((group) => group.columns.map((column, index) => (
                      <Td
                        key={column.key}
                        className={`font-semibold ${index === 0 ? 'border-l-4 border-l-white/70' : ''}`}
                        style={{ backgroundColor: column.previewBodyFill }}
                      >
                        {formatDollar(inlineScenarioValues[column.key] ?? 0)}
                      </Td>
                    )))}
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={totalColSpan} className="p-0">
                        <TracePanel row={row} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <Paginator page={page} totalPages={totalPages} onPage={setPage} />
    </div>
  );
}
