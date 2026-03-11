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

export default function ScheduleEditor({ onConfirm, onBack }) {
  const [rows, setRows] = useState(() => [newRow(), newRow(), newRow()]);
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
  // Row manipulation
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
  // Bulk paste
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
  // Confirm
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
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => { setShowBulkPaste((v) => !v); setBulkParseWarnings([]); }}
            className="text-sm text-blue-600 hover:text-blue-800 underline"
          >
            {showBulkPaste ? 'Cancel paste' : 'Bulk paste'}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            ← Back
          </button>
        </div>
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
          ⚠ One or more rows have an asterisk on the rent value — this typically indicates a
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
  );
}
