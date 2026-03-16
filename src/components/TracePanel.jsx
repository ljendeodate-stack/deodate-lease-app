/**
 * TracePanel
 * Expandable per-row calculation trace (Section 4, Row-Level Trace Panel).
 * Flaw 2 fix: surfaces period factor, proration factor derivation,
 * escalation year index per charge, and charge gate status.
 */

import { formatFactor, formatPercent } from '../utils/formatUtils.js';
import { NNN_BUCKET_KEYS, EXPENSE_CATEGORY_DEFS } from '../engine/labelClassifier.js';

const CATEGORIES = NNN_BUCKET_KEYS.map((k) => ({
  key: k,
  label: EXPENSE_CATEGORY_DEFS[k].displayLabel,
}));

function TraceRow({ label, value, detail }) {
  return (
    <tr className="text-xs">
      <td className="py-0.5 pr-4 font-medium text-gray-600 whitespace-nowrap">{label}</td>
      <td className="py-0.5 pr-4 font-mono text-gray-900">{value}</td>
      {detail && <td className="py-0.5 text-gray-500 italic">{detail}</td>}
    </tr>
  );
}

/**
 * Render one row of a classification trace table.
 * Only shown when a row carries `labelClassifications` metadata.
 */
function ClassificationTraceSection({ labelClassifications }) {
  if (!labelClassifications || typeof labelClassifications !== 'object') return null;
  const entries = Object.entries(labelClassifications).filter(([, v]) => v);
  if (!entries.length) return null;

  return (
    <>
      <tr>
        <td colSpan={3} className="pt-3 pb-0.5">
          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
            Label Classification Trace
          </span>
        </td>
      </tr>
      {entries.map(([bucket, c]) => (
        <tr key={bucket} className="text-xs align-top">
          <td className="py-0.5 pr-4 font-medium text-gray-600 whitespace-nowrap">
            {EXPENSE_CATEGORY_DEFS[bucket]?.displayLabel ?? bucket}
          </td>
          <td className="py-0.5 pr-4 font-mono text-gray-900">
            <span className={`inline-block px-1 rounded text-xs mr-1 ${
              c.confidence >= 0.9 ? 'bg-green-100 text-green-800'
              : c.confidence >= 0.7 ? 'bg-amber-100 text-amber-800'
              : 'bg-red-100 text-red-800'
            }`}>
              {(c.confidence * 100).toFixed(0)}%
            </span>
            <span className="text-gray-500">{c.matchType}</span>
            {c.matchedCanonical && (
              <span className="ml-1 text-gray-400">→ "{c.matchedCanonical}"</span>
            )}
          </td>
          <td className="py-0.5 text-gray-500 italic">
            {c.semanticSubtype && (
              <span className="mr-2 text-blue-600">{c.semanticSubtype}</span>
            )}
            {c.normalizedLabel && c.normalizedLabel !== c.rawLabel?.toLowerCase() && (
              <span className="text-gray-400">
                raw: "{c.rawLabel}" → "{c.normalizedLabel}"
              </span>
            )}
            {c.warnings?.length > 0 && (
              <span className="block text-amber-700">⚠ {c.warnings[0]}</span>
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
    if (row.prorationBasis === 'full') return 'Full anchor month — no proration';
    if (row.prorationBasis === 'abatement-boundary') {
      return `Abatement boundary blend: ${row.abatementDays} abated day(s) + ${row.fullRentDays} full-rent day(s) over ${row.totalDays} total day(s)`;
    }
    if (row.prorationBasis === 'final-month') {
      return `Final partial month: ${row.actualDays} actual day(s) ÷ ${row.calMonthDays} calendar day(s) in expiry month`;
    }
    return '—';
  })();

  return (
    <div className="bg-gray-50 border-t border-gray-200 px-4 py-3">
      <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">Calculation Trace</h4>
      <table className="w-full">
        <tbody>
          <TraceRow
            label="Period Factor"
            value={formatFactor(row.periodFactor)}
            detail={
              row.periodFactor === 1
                ? 'Full anchor month'
                : `Final partial month proration (${row.actualDays} days ÷ ${row.calMonthDays} calendar days)`
            }
          />
          <TraceRow
            label="Base Rent Proration Factor"
            value={formatFactor(row.baseRentProrationFactor)}
            detail={prorationDetail}
          />

          <tr><td colSpan={3} className="pt-2 pb-0.5"><span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">NNN Charges</span></td></tr>

          {CATEGORIES.map(({ key, label }) => {
            const active = row[`${key}Active`];
            const escYears = row[`${key}EscYears`];
            const escPct = row[`${key}EscPct`];
            return (
              <TraceRow
                key={key}
                label={label}
                value={
                  active === false
                    ? 'INACTIVE'
                    : `Year index: ${escYears ?? '—'} → ×(1 + ${escPct ?? 0}%)^${escYears ?? 0}`
                }
                detail={
                  active === false
                    ? `Charge gated: billing start date not yet reached for this row`
                    : escYears === null
                    ? 'Escalation anchored to lease Year # (no explicit escalation start date)'
                    : `Escalation anchored to explicit escStart date`
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
