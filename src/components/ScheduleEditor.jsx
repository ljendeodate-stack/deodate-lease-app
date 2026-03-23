/**
 * ScheduleEditor
 * Manual rent schedule entry with flexible period format support.
 *
 * Accepts:
 *   - Period strings: "3/1/18-2/28/19", "3/1/18 - 2/28/19", "3/1/18", "Year 1"
 *   - Rent strings: "$98,463.60*", "98463.60", etc. ($ and commas stripped)
 *   - Asterisk (*) on rent value flagged as potential abatement
 *
 * Includes a bulk paste panel for loading an entire schedule at once.
 * End dates are inferred from the next row's start when not supplied.
 */

import { useState, useMemo } from 'react';
import {
  parsePeriodString,
  parseRentString,
  inferEndDates,
  parseBulkPasteText,
  toCanonicalPeriodRows,
} from '../engine/periodParser.js';
import { toISOLocal } from '../engine/yearMonth.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _nextId = 1;
function newRow() {
  return { id: _nextId++, periodStr: '', rentStr: '' };
}

function fmtDate(d) {
  return d ? toISOLocal(d) : null;
}

function fmtMDY(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// Quick Entry — auto-generate period rows from 4 inputs
// ---------------------------------------------------------------------------

/**
 * Generate canonical period rows from commencement date, expiration date,
 * Year 1 monthly rent, and annual escalation rate.
 *
 * Each escalation year spans from one anniversary to the next. The final
 * year is truncated at the expiration date. Rents compound annually.
 *
 * @param {Date} commence    - Lease commencement date.
 * @param {Date} expire      - Lease expiration date (inclusive).
 * @param {number} year1Rent - Year 1 monthly base rent in dollars.
 * @param {number} escRate   - Annual escalation rate as a decimal (e.g. 0.03).
 * @returns {{ periodStart: Date, periodEnd: Date, monthlyRent: number }[]}
 */
function generatePeriodsFromQuickEntry(commence, expire, year1Rent, escRate) {
  const periods = [];
  let yearStart = new Date(commence);
  yearStart.setHours(0, 0, 0, 0);
  let yearIdx = 0;

  while (yearStart <= expire) {
    // Next anniversary: same month/day as commencement, next year
    const nextAnniversary = new Date(
      commence.getFullYear() + yearIdx + 1,
      commence.getMonth(),
      commence.getDate()
    );
    nextAnniversary.setHours(0, 0, 0, 0);

    // Year end = day before next anniversary, capped at expiration
    let yearEnd = new Date(nextAnniversary.getTime() - 86400000);
    yearEnd.setHours(0, 0, 0, 0);
    if (yearEnd > expire) yearEnd = new Date(expire);

    const rent = Math.round(year1Rent * Math.pow(1 + escRate, yearIdx) * 100) / 100;

    periods.push({
      periodStart: new Date(yearStart),
      periodEnd: new Date(yearEnd),
      monthlyRent: rent,
    });

    yearStart = new Date(nextAnniversary);
    yearIdx++;
  }

  return periods;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ParsedPreview({ p, periodStr }) {
  if (!periodStr && !p?.start) return null;

  if (p?.isRelative) {
    return (
      <span className="text-gray-400">Year {p.relativeYear} — enter actual dates</span>
    );
  }
  if (p?.start && p?.end) {
    return (
      <span className="text-green-700">
        {fmtDate(p.start)} → {fmtDate(p.end)}
        {p.endInferred && <span className="text-gray-400 ml-1">(end inferred)</span>}
      </span>
    );
  }
  if (p?.start && !p?.end) {
    return <span className="text-amber-600">start ok — end inferred from next row</span>;
  }
  if (periodStr) {
    return <span className="text-red-500">unrecognised format</span>;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ScheduleEditor({ onConfirm, onBack, initialPeriodRows }) {
  // If we have pre-populated period rows from a fallback, start in manual mode
  const hasInitialRows = Array.isArray(initialPeriodRows) && initialPeriodRows.length > 0;

  // ---------------------------------------------------------------------------
  // Entry mode toggle: 'manual' (existing) or 'quick' (new)
  // ---------------------------------------------------------------------------
  const [entryMode, setEntryMode] = useState(hasInitialRows ? 'manual' : 'quick');

  // ---------------------------------------------------------------------------
  // Quick Entry state
  // ---------------------------------------------------------------------------
  const [quickForm, setQuickForm] = useState({
    commenceDate: '',
    expireDate: '',
    year1Rent: '',
    escRate: '',
  });
  const [quickPreview, setQuickPreview] = useState([]);
  const [quickError, setQuickError] = useState('');

  function updateQuickForm(field, value) {
    setQuickForm((prev) => ({ ...prev, [field]: value }));
    setQuickPreview([]);
    setQuickError('');
  }

  function handleQuickGenerate() {
    setQuickError('');
    setQuickPreview([]);

    // Parse commencement date
    const commenceParsed = parsePeriodString(quickForm.commenceDate);
    if (!commenceParsed.start) {
      setQuickError('Lease Commencement Date: enter a valid date (MM/DD/YYYY).');
      return;
    }

    // Parse expiration date
    const expireParsed = parsePeriodString(quickForm.expireDate);
    if (!expireParsed.start) {
      setQuickError('Lease Expiration Date: enter a valid date (MM/DD/YYYY).');
      return;
    }

    if (expireParsed.start <= commenceParsed.start) {
      setQuickError('Expiration date must be after commencement date.');
      return;
    }

    // Parse rent
    const { rent } = parseRentString(quickForm.year1Rent);
    if (isNaN(rent) || rent <= 0) {
      setQuickError('Year 1 Monthly Base Rent: enter a positive dollar amount.');
      return;
    }

    // Parse escalation rate
    const escInput = quickForm.escRate.replace(/%/g, '').trim();
    const escPct = parseFloat(escInput);
    if (isNaN(escPct) || escPct < 0 || escPct > 50) {
      setQuickError('Annual Escalation Rate: enter a percentage between 0 and 50 (e.g. 3 for 3%).');
      return;
    }

    const periods = generatePeriodsFromQuickEntry(
      commenceParsed.start,
      expireParsed.start,
      rent,
      escPct / 100
    );

    if (periods.length === 0) {
      setQuickError('No periods could be generated. Check your dates.');
      return;
    }

    setQuickPreview(periods);
  }

  function handleQuickConfirm() {
    if (quickPreview.length === 0) return;
    onConfirm(quickPreview, []);
  }

  // ---------------------------------------------------------------------------
  // Manual Entry state — pre-populated from initialPeriodRows when available
  // ---------------------------------------------------------------------------
  const [rows, setRows] = useState(() => {
    if (hasInitialRows) {
      return initialPeriodRows.map((p) => ({
        id: _nextId++,
        periodStr: p.periodStart && p.periodEnd
          ? `${fmtMDY(p.periodStart)}-${fmtMDY(p.periodEnd)}`
          : p.periodStart ? fmtMDY(p.periodStart) : '',
        rentStr: !isNaN(p.monthlyRent) ? String(p.monthlyRent) : '',
      }));
    }
    return [newRow(), newRow(), newRow()];
  });
  const [showBulkPaste, setShowBulkPaste] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkParseWarnings, setBulkParseWarnings] = useState([]);

  // Derive parsed state from raw rows
  const parsedRows = useMemo(() => {
    const intermediate = rows.map((r) => {
      const period = parsePeriodString(r.periodStr);
      const { rent, hasAsterisk } = parseRentString(r.rentStr);
      return {
        ...period,
        monthlyRent: rent,
        hasAsterisk,
        _id: r.id,
      };
    });
    return inferEndDates(intermediate);
  }, [rows]);

  const validCount = parsedRows.filter(
    (p) => p.start && p.end && !isNaN(p.monthlyRent)
  ).length;

  const abatementHinted = parsedRows.some((p) => p.hasAsterisk);

  // ---------------------------------------------------------------------------
  // Manual Entry row manipulation (unchanged)
  // ---------------------------------------------------------------------------

  function addRow() {
    setRows((prev) => [...prev, newRow()]);
  }

  function removeRow(id) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function updateRow(id, field, value) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  // ---------------------------------------------------------------------------
  // Bulk paste (unchanged)
  // ---------------------------------------------------------------------------

  function handleBulkParse() {
    const { rows: parsed, warnings } = parseBulkPasteText(bulkText);
    setBulkParseWarnings(warnings);
    if (!parsed.length && warnings.length) return;

    const loaded = parsed.map((p) => ({
      id: _nextId++,
      periodStr: p.periodStr,
      rentStr: p.rentStr,
    }));
    setRows(loaded.length > 0 ? loaded : [newRow()]);
    if (!warnings.length) {
      setShowBulkPaste(false);
      setBulkText('');
    }
  }

  // ---------------------------------------------------------------------------
  // Manual confirm (unchanged)
  // ---------------------------------------------------------------------------

  function handleConfirm() {
    const canonical = toCanonicalPeriodRows(parsedRows);
    const rowWarnings = parsedRows
      .map((p, i) =>
        p.warning ? `Row ${i + 1}: ${p.warning}` : null
      )
      .filter(Boolean);
    onConfirm(canonical, rowWarnings);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Rent Schedule</h2>
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-gray-500 hover:text-gray-700 underline"
        >
          ← Back
        </button>
      </div>

      {/* Entry mode toggle */}
      <div className="flex rounded-lg border border-gray-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setEntryMode('quick')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            entryMode === 'quick'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          Quick Entry
        </button>
        <button
          type="button"
          onClick={() => setEntryMode('manual')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            entryMode === 'manual'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          Manual Entry
        </button>
      </div>

      {/* ================================================================= */}
      {/* QUICK ENTRY MODE                                                  */}
      {/* ================================================================= */}
      {entryMode === 'quick' && (
        <div className="space-y-5">
          <div className="rounded-md bg-gray-50 border border-gray-200 p-3 text-xs text-gray-600">
            Enter the four key lease terms below. The rent schedule will be auto-generated
            with annual escalation periods from commencement through expiration.
          </div>

          {/* Quick Entry form */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Lease Commencement Date</label>
              <input
                type="text"
                value={quickForm.commenceDate}
                onChange={(e) => updateQuickForm('commenceDate', e.target.value)}
                placeholder="MM/DD/YYYY"
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Lease Expiration Date</label>
              <input
                type="text"
                value={quickForm.expireDate}
                onChange={(e) => updateQuickForm('expireDate', e.target.value)}
                placeholder="MM/DD/YYYY"
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">
                Year 1 Monthly Base Rent ($)
              </label>
              <input
                type="text"
                value={quickForm.year1Rent}
                onChange={(e) => updateQuickForm('year1Rent', e.target.value)}
                placeholder="e.g. $98,463.60"
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">
                Annual Base Rent Escalation (%)
                <span className="ml-1 text-gray-400 cursor-help" title="Enter as a whole number. E.g. 3 for 3% annual increase. Enter 0 for flat rent.">
                  &#9432;
                </span>
              </label>
              <input
                type="text"
                value={quickForm.escRate}
                onChange={(e) => updateQuickForm('escRate', e.target.value)}
                placeholder="e.g. 3"
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Generate button */}
          <button
            type="button"
            onClick={handleQuickGenerate}
            className="w-full rounded-md bg-gray-100 border border-gray-300 text-gray-700 py-2 text-sm font-semibold hover:bg-gray-200 transition-colors"
          >
            Generate Schedule Preview
          </button>

          {/* Error */}
          {quickError && (
            <div className="rounded-md bg-red-50 border border-red-300 p-3 text-sm text-red-700">
              {quickError}
            </div>
          )}

          {/* Preview table */}
          {quickPreview.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-700">
                Generated Schedule — {quickPreview.length} period{quickPreview.length !== 1 ? 's' : ''}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b-2 border-gray-200 text-left">
                      <th className="pb-2 pr-3 font-medium text-gray-600 w-8">Year</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600">Period Start</th>
                      <th className="pb-2 pr-3 font-medium text-gray-600">Period End</th>
                      <th className="pb-2 font-medium text-gray-600 text-right">Monthly Base Rent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quickPreview.map((p, idx) => (
                      <tr key={idx} className="border-b border-gray-100">
                        <td className="py-1.5 pr-3 text-gray-500">{idx + 1}</td>
                        <td className="py-1.5 pr-3 font-mono text-xs">
                          {fmtDate(p.periodStart)}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-xs">
                          {fmtDate(p.periodEnd)}
                        </td>
                        <td className="py-1.5 text-right font-mono text-xs">
                          ${p.monthlyRent.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Confirm */}
              <button
                type="button"
                onClick={handleQuickConfirm}
                className="w-full rounded-md bg-blue-600 text-white py-2.5 text-sm font-semibold hover:bg-blue-700 transition-colors"
              >
                Continue with this schedule →
              </button>
              <p className="text-xs text-gray-400 text-center">
                Review the generated periods above. You can switch to Manual Entry to adjust individual rows.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* MANUAL ENTRY MODE (original, unchanged)                           */}
      {/* ================================================================= */}
      {entryMode === 'manual' && (
        <div className="space-y-6">
          {/* Format hint + bulk paste toggle */}
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => { setShowBulkPaste((v) => !v); setBulkParseWarnings([]); }}
              className="text-sm text-blue-600 hover:text-blue-800 underline"
            >
              {showBulkPaste ? 'Cancel paste' : 'Bulk paste'}
            </button>
          </div>

          {/* Format hint */}
          <div className="rounded-md bg-gray-50 border border-gray-200 p-3 text-xs text-gray-600 space-y-1">
            <p className="font-semibold text-gray-700">Accepted period formats</p>
            <p>
              <code className="bg-white border border-gray-200 px-1 rounded">3/1/18-2/28/19</code>{' '}
              or{' '}
              <code className="bg-white border border-gray-200 px-1 rounded">3/1/18 - 2/28/19</code>
              {' '}— explicit start and end date
            </p>
            <p>
              <code className="bg-white border border-gray-200 px-1 rounded">3/1/18</code>
              {' '}— single start date; end is inferred from the next row's start minus 1 day
            </p>
            <p>
              Two-digit years are interpreted as: 00–49 → 2000–2049, 50–99 → 1950–1999.
              Rent: <code className="bg-white border border-gray-200 px-1 rounded">$98,463.60*</code>
              {' '}— $ and commas stripped; asterisk flags potential abatement.
            </p>
          </div>

          {/* Bulk paste panel */}
          {showBulkPaste && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
              <p className="text-sm font-semibold text-blue-800">Paste rent schedule</p>
              <p className="text-xs text-blue-700">
                One row per line. Period and rent separated by a tab or two or more spaces.
                Asterisk (*) on rent marks potential abatement.
              </p>
              <pre className="text-xs text-blue-600 bg-white border border-blue-100 rounded px-2 py-1">
{`3/1/18-2/28/19   $98,463.60*
3/1/19-2/29/20   $101,417.51
3/1/20-2/28/21   $104,460.03`}
              </pre>
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={7}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Paste here…"
              />
              {bulkParseWarnings.length > 0 && (
                <div className="space-y-0.5">
                  {bulkParseWarnings.map((w, i) => (
                    <p key={i} className="text-xs text-red-600">⚠ {w}</p>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={handleBulkParse}
                disabled={!bulkText.trim()}
                className="rounded-md bg-blue-600 text-white px-4 py-1.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Parse and load rows
              </button>
            </div>
          )}

          {/* Schedule table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-gray-200 text-left">
                  <th className="pb-2 pr-2 font-medium text-gray-600 w-8">#</th>
                  <th className="pb-2 pr-3 font-medium text-gray-600 w-52">
                    Period
                  </th>
                  <th className="pb-2 pr-3 font-medium text-gray-600 w-48">
                    Monthly Base Rent
                  </th>
                  <th className="pb-2 font-medium text-gray-600">Parsed as</th>
                  <th className="pb-2 w-6"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const p = parsedRows[idx];
                  const periodHasContent = row.periodStr.trim() !== '';
                  const rentHasContent = row.rentStr.trim() !== '';
                  const periodBad = periodHasContent && !p?.start && !p?.isRelative;
                  const rentBad = rentHasContent && isNaN(p?.monthlyRent);

                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-gray-100 ${
                        p?.hasAsterisk ? 'bg-amber-50' : ''
                      }`}
                    >
                      {/* Row number */}
                      <td className="py-2 pr-2 text-gray-400 align-top pt-3">{idx + 1}</td>

                      {/* Period input */}
                      <td className="py-2 pr-3 align-top">
                        <input
                          type="text"
                          value={row.periodStr}
                          onChange={(e) => updateRow(row.id, 'periodStr', e.target.value)}
                          placeholder="3/1/18-2/28/19"
                          className={`w-full rounded border px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                            periodBad
                              ? 'border-amber-400 bg-amber-50'
                              : 'border-gray-300'
                          }`}
                        />
                      </td>

                      {/* Rent input */}
                      <td className="py-2 pr-3 align-top">
                        <div className="flex items-start gap-1.5">
                          <input
                            type="text"
                            value={row.rentStr}
                            onChange={(e) => updateRow(row.id, 'rentStr', e.target.value)}
                            placeholder="$98,463.60"
                            className={`w-full rounded border px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                              rentBad
                                ? 'border-amber-400 bg-amber-50'
                                : 'border-gray-300'
                            }`}
                          />
                          {p?.hasAsterisk && (
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 whitespace-nowrap mt-1"
                              title="Asterisk detected — this period may be subject to rent abatement. Set Abatement fields in the next step."
                            >
                              * abatement?
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Parse preview */}
                      <td className="py-2 pr-2 align-top">
                        <p className="text-xs pt-1.5 text-gray-500">
                          <ParsedPreview p={p} periodStr={row.periodStr} />
                        </p>
                      </td>

                      {/* Remove */}
                      <td className="py-2 align-top">
                        <button
                          type="button"
                          onClick={() => removeRow(row.id)}
                          className="text-gray-300 hover:text-red-500 text-xl leading-none pt-1"
                          title="Remove row"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Add row */}
          <button
            type="button"
            onClick={addRow}
            className="text-sm text-blue-600 hover:text-blue-800 underline"
          >
            + Add row
          </button>

          {/* Abatement hint */}
          {abatementHinted && (
            <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
              One or more rows have an asterisk on the rent value — this typically indicates a
              free-rent or abatement period. Set the <strong>Abatement End Date</strong> and{' '}
              <strong>Abatement Percentage</strong> in the next step.
            </div>
          )}

          {/* Confirm */}
          <div className="pt-2 space-y-2">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={validCount === 0}
              className="w-full rounded-md bg-blue-600 text-white py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {validCount > 0
                ? `Continue with ${validCount} period${validCount !== 1 ? 's' : ''} →`
                : 'Enter at least one valid period to continue'}
            </button>
            <p className="text-xs text-gray-400 text-center">
              Rows missing an end date will have it inferred from the next row's start.
              The last row requires an explicit end date.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
