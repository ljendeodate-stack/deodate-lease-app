/**
 * TracePanel
 * Expandable per-row calculation trace.
 */

import { formatFactor } from '../utils/formatUtils.js';
import { NNN_BUCKET_KEYS, EXPENSE_CATEGORY_DEFS } from '../engine/labelClassifier.js';

function getCategories(row) {
  if (row.chargeDetails && typeof row.chargeDetails === 'object') {
    return Object.entries(row.chargeDetails).map(([key, detail]) => ({
      key,
      label: detail.displayLabel || EXPENSE_CATEGORY_DEFS[key]?.displayLabel || key,
      ...detail,
    }));
  }
  return NNN_BUCKET_KEYS.map((key) => ({
    key,
    label: EXPENSE_CATEGORY_DEFS[key].displayLabel,
    active: row[`${key}Active`],
    escYears: row[`${key}EscYears`],
    escPct: row[`${key}EscPct`],
  }));
}

function TraceRow({ label, value, detail }) {
  return (
    <tr className="text-xs align-top">
      <td className="py-1 pr-5 font-medium text-txt-muted whitespace-nowrap">{label}</td>
      <td className="py-1 pr-5 font-mono text-txt-primary">{value}</td>
      {detail && <td className="py-1 text-txt-dim">{detail}</td>}
    </tr>
  );
}

function ClassificationTraceSection({ labelClassifications }) {
  if (!labelClassifications || typeof labelClassifications !== 'object') return null;
  const entries = Object.entries(labelClassifications).filter(([, value]) => value);
  if (!entries.length) return null;

  return (
    <>
      <tr>
        <td colSpan={3} className="pt-4 pb-1">
          <span className="section-kicker">Label Classification Trace</span>
        </td>
      </tr>
      {entries.map(([bucket, classification]) => (
        <tr key={bucket} className="text-xs align-top">
          <td className="py-1 pr-5 font-medium text-txt-muted whitespace-nowrap">
            {EXPENSE_CATEGORY_DEFS[bucket]?.displayLabel ?? bucket}
          </td>
          <td className="py-1 pr-5 font-mono text-txt-primary">
            <span className={`inline-flex rounded-full border px-2 py-1 text-[0.68rem] font-semibold ${
              classification.confidence >= 0.9
                ? 'border-status-ok-border bg-status-ok-bg text-status-ok-title'
                : classification.confidence >= 0.7
                ? 'border-status-warn-border bg-status-warn-bg text-status-warn-title'
                : 'border-status-err-border bg-status-err-bg text-status-err-title'
            }`}>
              {(classification.confidence * 100).toFixed(0)}%
            </span>
            <span className="ml-2 text-txt-muted">{classification.matchType}</span>
            {classification.matchedCanonical && (
              <span className="ml-2 text-txt-dim">-&gt; "{classification.matchedCanonical}"</span>
            )}
          </td>
          <td className="py-1 text-txt-dim">
            {classification.semanticSubtype && (
              <span className="mr-3 font-medium text-accent-soft">{classification.semanticSubtype}</span>
            )}
            {classification.normalizedLabel && classification.normalizedLabel !== classification.rawLabel?.toLowerCase() && (
              <span>
                raw: "{classification.rawLabel}" -&gt; "{classification.normalizedLabel}"
              </span>
            )}
            {classification.warnings?.length > 0 && (
              <span className="mt-1 block text-status-warn-text">{classification.warnings[0]}</span>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}

export default function TracePanel({ row }) {
  if (!row) return null;

  const prorationDetail = (() => {
    if (row.prorationBasis === 'full') return 'Full anchor month; no proration.';
    if (row.prorationBasis === 'abatement-boundary' || row.prorationBasis === 'concession-boundary') {
      return `Concession boundary blend: ${row.abatementDays} concession day(s) + ${row.fullRentDays} full-rent day(s) over ${row.totalDays} total day(s).`;
    }
    if (row.prorationBasis === 'concession-event') return 'Date-triggered concession event applied to this resolved monthly row.';
    if (row.prorationBasis === 'final-month') {
      return `Final partial month: ${row.actualDays} actual day(s) / ${row.calMonthDays} calendar day(s) in expiry month.`;
    }
    return '-';
  })();

  const concessionValue = (() => {
    if (!row.concessionType) return null;
    if (row.concessionType === 'free_rent') return '100% free rent';
    if (row.concessionValueMode === 'fixed_amount') return `$${Number(row.concessionValue || 0).toLocaleString()} fixed reduction`;
    return `${Number(row.concessionValue || 0)}% abatement`;
  })();

  const concessionDetail = (() => {
    if (!row.concessionType) return null;
    if (row.concessionTriggerDate) return `Triggered on ${row.concessionTriggerDate}.`;
    if (row.concessionStartDate || row.concessionEndDate) {
      return `Legacy window ${row.concessionStartDate ?? 'start'} through ${row.concessionEndDate ?? 'end'}.`;
    }
    return null;
  })();

  return (
    <div className="border-t border-app-border bg-app-shell px-5 py-4">
      <p className="section-kicker">Calculation Trace</p>
      <table className="mt-3 w-full">
        <tbody>
          <TraceRow
            label="Period Factor"
            value={formatFactor(row.periodFactor)}
            detail={
              row.periodFactor === 1
                ? 'Full anchor month.'
                : `Final partial month proration (${row.actualDays} days / ${row.calMonthDays} calendar days).`
            }
          />
          <TraceRow
            label="Base Rent Proration Factor"
            value={formatFactor(row.baseRentProrationFactor)}
            detail={prorationDetail}
          />
          {row.concessionType && (
            <TraceRow
              label="Concession"
              value={concessionValue}
              detail={[concessionDetail, row.concessionAssumptionNote].filter(Boolean).join(' ')}
            />
          )}

          <tr>
            <td colSpan={3} className="pt-4 pb-1">
              <span className="section-kicker !text-txt-dim">Charges</span>
            </td>
          </tr>

          {getCategories(row).map((category) => {
            const { key, label, active, escYears, escPct } = category;
            return (
              <TraceRow
                key={key}
                label={label}
                value={
                  active === false
                    ? 'INACTIVE'
                    : `Year index: ${escYears ?? '-'} -> x(1 + ${escPct ?? 0}%)^${escYears ?? 0}`
                }
                detail={
                  active === false
                    ? 'Charge gated: billing start date not yet reached for this row.'
                    : escYears === null
                    ? 'Escalation anchored to lease year with no explicit escalation start date.'
                    : 'Escalation anchored to explicit escStart date.'
                }
              />
            );
          })}

          <ClassificationTraceSection labelClassifications={row.labelClassifications} />
        </tbody>
      </table>
    </div>
  );
}
