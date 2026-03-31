/**
 * ScheduleEditor
 * Manual rent schedule entry with flexible period format support.
 */

import { useState, useMemo, useEffect } from 'react';
import {
  parsePeriodString,
  parseRentString,
  inferEndDates,
  parseBulkPasteText,
  toCanonicalPeriodRows,
} from '../engine/periodParser.js';
import { toISOLocal } from '../engine/yearMonth.js';

let nextId = 1;

function newRow() {
  return { id: nextId++, periodStr: '', rentStr: '' };
}

export function buildEditableRowsFromPeriods(periodRows = []) {
  if (!Array.isArray(periodRows) || periodRows.length === 0) {
    return [newRow(), newRow(), newRow()];
  }

  return periodRows.map((period) => ({
    id: nextId++,
    periodStr: period.periodStart && period.periodEnd
      ? `${fmtMDY(period.periodStart)}-${fmtMDY(period.periodEnd)}`
      : period.periodStart ? fmtMDY(period.periodStart) : '',
    rentStr: !isNaN(period.monthlyRent) ? String(period.monthlyRent) : '',
  }));
}

function fmtDate(date) {
  return date ? toISOLocal(date) : null;
}

function fmtMDY(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '';
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${date.getFullYear()}`;
}

function generatePeriodsFromQuickEntry(commence, expire, year1Rent, escRate) {
  const periods = [];
  const effectiveExpire = new Date(expire);
  effectiveExpire.setHours(0, 0, 0, 0);
  let yearStart = new Date(commence);
  yearStart.setHours(0, 0, 0, 0);
  let yearIdx = 0;

  while (yearStart <= effectiveExpire) {
    const nextAnniversary = new Date(
      commence.getFullYear() + yearIdx + 1,
      commence.getMonth(),
      commence.getDate()
    );
    nextAnniversary.setHours(0, 0, 0, 0);

    let yearEnd = new Date(nextAnniversary.getTime() - 86400000);
    yearEnd.setHours(0, 0, 0, 0);
    if (yearEnd > effectiveExpire) yearEnd = new Date(effectiveExpire);

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

function ParsedPreview({ parsed, periodStr }) {
  if (!periodStr && !parsed?.start) return null;

  if (parsed?.isRelative) {
    return <span className="text-txt-dim">Year {parsed.relativeYear}; enter actual dates.</span>;
  }

  if (parsed?.start && parsed?.end) {
    return (
      <span className="text-status-ok-text">
        {fmtDate(parsed.start)} - {fmtDate(parsed.end)}
        {parsed.endInferred && <span className="ml-1 text-txt-dim">(end inferred)</span>}
      </span>
    );
  }

  if (parsed?.start && !parsed?.end) {
    return <span className="text-status-warn-text">Start accepted; end will be inferred from the next row.</span>;
  }

  if (periodStr) {
    return <span className="text-status-err-text">Unrecognized format.</span>;
  }

  return null;
}

export default function ScheduleEditor({
  onConfirm,
  onBack,
  initialPeriodRows,
  initialEntryMode = null,
  semanticSchedule = null,
  scheduleMaterializationMode = null,
}) {
  const hasInitialRows = Array.isArray(initialPeriodRows) && initialPeriodRows.length > 0;
  const preferredCandidate = useMemo(
    () => (semanticSchedule?.candidates ?? []).find((candidate) => candidate.id === semanticSchedule?.preferredCandidateId) ?? null,
    [semanticSchedule],
  );

  const [entryMode, setEntryMode] = useState(initialEntryMode ?? (hasInitialRows ? 'manual' : 'quick'));
  const [quickForm, setQuickForm] = useState({
    commenceDate: '',
    expireDate: '',
    year1Rent: '',
    escRate: '',
  });
  const [quickPreview, setQuickPreview] = useState([]);
  const [quickError, setQuickError] = useState('');

  const [rows, setRows] = useState(() => {
    return buildEditableRowsFromPeriods(initialPeriodRows);
  });
  const [showBulkPaste, setShowBulkPaste] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkParseWarnings, setBulkParseWarnings] = useState([]);

  useEffect(() => {
    setRows(buildEditableRowsFromPeriods(initialPeriodRows));
  }, [hasInitialRows, initialPeriodRows]);

  useEffect(() => {
    setEntryMode(initialEntryMode ?? (hasInitialRows ? 'manual' : 'quick'));
  }, [initialEntryMode, hasInitialRows]);

  function updateQuickForm(field, value) {
    setQuickForm((prev) => ({ ...prev, [field]: value }));
    setQuickPreview([]);
    setQuickError('');
  }

  function handleQuickGenerate() {
    setQuickError('');
    setQuickPreview([]);

    const commenceParsed = parsePeriodString(quickForm.commenceDate);
    if (!commenceParsed.start) {
      setQuickError('Lease Commencement Date: enter a valid date (MM/DD/YYYY).');
      return;
    }

    const expireParsed = parsePeriodString(quickForm.expireDate);
    if (!expireParsed.start) {
      setQuickError('Lease Expiration Date: enter a valid date (MM/DD/YYYY).');
      return;
    }

    if (expireParsed.start <= commenceParsed.start) {
      setQuickError('Expiration date must be after commencement date.');
      return;
    }

    const { rent } = parseRentString(quickForm.year1Rent);
    if (isNaN(rent) || rent <= 0) {
      setQuickError('Year 1 Monthly Base Rent: enter a positive dollar amount.');
      return;
    }

    const escInput = quickForm.escRate.replace(/%/g, '').trim();
    const escPct = parseFloat(escInput);
    if (isNaN(escPct) || escPct < 0 || escPct > 50) {
      setQuickError('Annual Escalation Rate: enter a percentage between 0 and 50.');
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

  const parsedRows = useMemo(() => {
    const intermediate = rows.map((row) => {
      const period = parsePeriodString(row.periodStr);
      const { rent, hasAsterisk } = parseRentString(row.rentStr);
      return {
        ...period,
        monthlyRent: rent,
        hasAsterisk,
        _id: row.id,
      };
    });
    return inferEndDates(intermediate);
  }, [rows]);

  const validCount = parsedRows.filter((row) => row.start && row.end && !isNaN(row.monthlyRent)).length;
  const abatementHinted = parsedRows.some((row) => row.hasAsterisk);

  function addRow() {
    setRows((prev) => [...prev, newRow()]);
  }

  function removeRow(id) {
    setRows((prev) => prev.filter((row) => row.id !== id));
  }

  function updateRow(id, field, value) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  }

  function handleBulkParse() {
    const { rows: parsed, warnings } = parseBulkPasteText(bulkText);
    setBulkParseWarnings(warnings);
    if (!parsed.length && warnings.length) return;

    const loaded = parsed.map((period) => ({
      id: nextId++,
      periodStr: period.periodStr,
      rentStr: period.rentStr,
    }));
    setRows(loaded.length > 0 ? loaded : [newRow()]);
    if (!warnings.length) {
      setShowBulkPaste(false);
      setBulkText('');
    }
  }

  function handleConfirm() {
    const canonical = toCanonicalPeriodRows(parsedRows);
    const rowWarnings = parsedRows
      .map((row, i) => (row.warning ? `Row ${i + 1}: ${row.warning}` : null))
      .filter(Boolean);
    onConfirm(canonical, rowWarnings);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-kicker">Schedule Construction</p>
          <h2 className="mt-2 text-2xl font-semibold text-txt-primary">Rent Schedule</h2>
        </div>
        <button type="button" onClick={onBack} className="btn-secondary !px-4 !py-2">
          Back
        </button>
      </div>

      <div className="segmented-control w-fit">
        <button
          type="button"
          onClick={() => setEntryMode('quick')}
          className={`segmented-option ${entryMode === 'quick' ? 'segmented-option-active' : ''}`}
        >
          Quick Entry
        </button>
        <button
          type="button"
          onClick={() => setEntryMode('manual')}
          className={`segmented-option ${entryMode === 'manual' ? 'segmented-option-active' : ''}`}
        >
          Manual Entry
        </button>
      </div>

      {semanticSchedule?.summaryLines?.length > 0 && (
        <div className="rounded-[1rem] border border-app-border bg-app-panel px-4 py-4 space-y-2">
          <p className="text-sm font-semibold text-txt-primary">Detected rent schedule semantics</p>
          {semanticSchedule.summaryLines.map((line, index) => (
            <p key={`${line}-${index}`} className="text-sm text-txt-muted">{line}</p>
          ))}
          {(semanticSchedule.startRuleSummaries ?? []).map((line, index) => (
            <p key={`rule-${index}`} className="text-xs text-txt-dim">{line}</p>
          ))}
          {semanticSchedule.userGuidance && (
            <p className="text-xs text-txt-dim">
              {semanticSchedule.userGuidance}
              {scheduleMaterializationMode === 'semantic' && hasInitialRows ? ' The rows below are derived from these semantic terms.' : ''}
            </p>
          )}
        </div>
      )}

      {!hasInitialRows && preferredCandidate?.terms?.length > 0 && (
        <div className="rounded-[1rem] border border-app-border bg-app-panel px-4 py-4 space-y-3">
          <p className="text-sm font-semibold text-txt-primary">Detected schedule terms</p>
          <div className="overflow-x-auto rounded-[0.9rem] border border-app-border bg-app-chrome">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-app-panel-strong text-[0.68rem] uppercase tracking-[0.18em] text-txt-dim">
                  <th className="px-3 py-3 text-left font-semibold">Range</th>
                  <th className="px-3 py-3 text-left font-semibold">Monthly Base Rent</th>
                  <th className="px-3 py-3 text-left font-semibold">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border">
                {preferredCandidate.terms.map((term, index) => {
                  let rangeLabel = '';
                  if (preferredCandidate.representationType === 'relative_month_ranges') {
                    rangeLabel = `Months ${term.startMonth}-${term.endMonth}`;
                  } else if (preferredCandidate.representationType === 'lease_year_ranges') {
                    rangeLabel = `Lease Years ${term.startLeaseYear}-${term.endLeaseYear}`;
                  } else {
                    rangeLabel = `${term.periodStart ?? ''}${term.periodEnd ? ` - ${term.periodEnd}` : ''}`;
                  }

                  return (
                    <tr key={`${rangeLabel}-${index}`} className={index % 2 === 0 ? 'bg-app-chrome' : 'bg-app-surface'}>
                      <td className="px-3 py-3 text-txt-primary">{rangeLabel}</td>
                      <td className="px-3 py-3 font-mono text-txt-primary">
                        {Number(term.monthlyRent ?? 0).toLocaleString('en-US', {
                          style: 'currency',
                          currency: 'USD',
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-3 py-3 text-txt-muted">{term.sourceText ?? 'Detected from OCR text'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-txt-dim">
            These terms were detected from the lease language. Enter Rent Commencement Date in the assumptions step to materialize dated rows when needed.
          </p>
        </div>
      )}

      {entryMode === 'quick' && (
        <div className="space-y-5">
          <div className="surface-panel px-5 py-5">
            <p className="section-kicker">Auto-Generate</p>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-txt-muted">
              Enter the four key lease terms below. The rent schedule will be auto-generated with annual escalation
              periods from commencement through expiration.
            </p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-txt-dim">Lease Commencement Date</label>
                <input
                  type="text"
                  value={quickForm.commenceDate}
                  onChange={(e) => updateQuickForm('commenceDate', e.target.value)}
                  placeholder="MM/DD/YYYY"
                  className="field-dark"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-txt-dim">Lease Expiration Date</label>
                <input
                  type="text"
                  value={quickForm.expireDate}
                  onChange={(e) => updateQuickForm('expireDate', e.target.value)}
                  placeholder="MM/DD/YYYY"
                  className="field-dark"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-txt-dim">Year 1 Monthly Base Rent ($)</label>
                <input
                  type="text"
                  value={quickForm.year1Rent}
                  onChange={(e) => updateQuickForm('year1Rent', e.target.value)}
                  placeholder="e.g. $98,463.60"
                  className="field-dark"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-txt-dim">Annual Base Rent Escalation (%)</label>
                <input
                  type="text"
                  value={quickForm.escRate}
                  onChange={(e) => updateQuickForm('escRate', e.target.value)}
                  placeholder="e.g. 3"
                  className="field-dark"
                />
              </div>
            </div>
            <button type="button" onClick={handleQuickGenerate} className="btn-secondary mt-6 w-full justify-center">
              Generate Schedule Preview
            </button>
          </div>

          {quickError && (
            <div className="rounded-[1rem] border border-status-err-border bg-status-err-bg/92 p-4 text-sm text-status-err-text">
              {quickError}
            </div>
          )}

          {quickPreview.length > 0 && (
            <div className="surface-panel px-5 py-5">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="section-kicker">Preview</p>
                  <h3 className="mt-2 text-xl font-semibold text-txt-primary">
                    Generated Schedule ({quickPreview.length} period{quickPreview.length !== 1 ? 's' : ''})
                  </h3>
                </div>
                <button type="button" onClick={handleQuickConfirm} className="btn-primary">
                  Continue with This Schedule
                </button>
              </div>

              <div className="mt-5 overflow-x-auto rounded-[1rem] border border-app-border bg-app-chrome">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-app-panel-strong text-[0.68rem] uppercase tracking-[0.18em] text-txt-dim">
                      <th className="px-3 py-3 text-left font-semibold">Year</th>
                      <th className="px-3 py-3 text-left font-semibold">Period Start</th>
                      <th className="px-3 py-3 text-left font-semibold">Period End</th>
                      <th className="px-3 py-3 text-right font-semibold">Monthly Base Rent</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-app-border">
                    {quickPreview.map((period, idx) => (
                      <tr key={idx} className={idx % 2 === 0 ? 'bg-app-chrome' : 'bg-app-surface'}>
                        <td className="px-3 py-3 font-mono text-txt-muted">{idx + 1}</td>
                        <td className="px-3 py-3 font-mono text-txt-primary">{fmtDate(period.periodStart)}</td>
                        <td className="px-3 py-3 font-mono text-txt-primary">{fmtDate(period.periodEnd)}</td>
                        <td className="px-3 py-3 text-right font-mono text-txt-primary">
                          ${period.monthlyRent.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="mt-4 text-xs text-txt-dim">
                Review the generated periods above. Switch to Manual Entry if you need to revise individual rows.
              </p>
            </div>
          )}
        </div>
      )}

      {entryMode === 'manual' && (
        <div className="space-y-5">
          <div className="surface-panel px-5 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="section-kicker">Manual Capture</p>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-txt-muted">
                  Enter periods directly, paste a schedule block, or adjust OCR-loaded rows before proceeding.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowBulkPaste((value) => !value);
                  setBulkParseWarnings([]);
                }}
                className="btn-ghost"
              >
                {showBulkPaste ? 'Close Paste Panel' : 'Bulk Paste'}
              </button>
            </div>

            <div className="mt-5 rounded-[1rem] border border-app-border bg-app-chrome px-4 py-4 text-xs text-txt-muted space-y-2">
              <p className="font-display text-sm font-semibold text-txt-primary">Accepted period formats</p>
              <p><code className="rounded border border-app-border-strong bg-app-panel px-1.5 py-0.5 text-txt-primary">3/1/18-2/28/19</code> or <code className="rounded border border-app-border-strong bg-app-panel px-1.5 py-0.5 text-txt-primary">3/1/18 - 2/28/19</code> for explicit start and end dates.</p>
              <p><code className="rounded border border-app-border-strong bg-app-panel px-1.5 py-0.5 text-txt-primary">3/1/18</code> for a single start date; the end will be inferred from the next row.</p>
              <p>Two-digit years are interpreted as 00-49 =&gt; 2000-2049, 50-99 =&gt; 1950-1999. Rent values can include $ signs, commas, and an asterisk to flag potential abatement.</p>
            </div>
          </div>

          {showBulkPaste && (
            <div className="surface-panel px-5 py-5">
              <p className="section-kicker">Bulk Paste</p>
              <p className="mt-3 text-sm text-txt-muted">
                One row per line. Separate the period and rent using a tab or at least two spaces.
              </p>
              <pre className="mt-4 overflow-x-auto rounded-[1rem] border border-app-border bg-app-chrome px-3 py-3 text-xs text-txt-muted">{`3/1/18-2/28/19   $98,463.60*
3/1/19-2/29/20   $101,417.51
3/1/20-2/28/21   $104,460.03`}</pre>
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={7}
                className="field-dark mt-4 !rounded-[1rem] !px-4 !py-3 font-mono"
                placeholder="Paste schedule block here..."
              />
              {bulkParseWarnings.length > 0 && (
                <div className="mt-3 space-y-1">
                  {bulkParseWarnings.map((warning, idx) => (
                    <p key={idx} className="text-xs text-status-err-text">{warning}</p>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={handleBulkParse}
                disabled={!bulkText.trim()}
                className="btn-primary mt-4 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Parse and Load Rows
              </button>
            </div>
          )}

          <div className="overflow-x-auto rounded-[1.25rem] border border-app-border bg-app-panel shadow-panel">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-app-panel-strong text-[0.68rem] uppercase tracking-[0.18em] text-txt-dim">
                  <th className="px-3 py-3 text-left font-semibold">#</th>
                  <th className="px-3 py-3 text-left font-semibold">Period</th>
                  <th className="px-3 py-3 text-left font-semibold">Monthly Base Rent</th>
                  <th className="px-3 py-3 text-left font-semibold">Parsed As</th>
                  <th className="px-3 py-3 text-left font-semibold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border">
                {rows.map((row, idx) => {
                  const parsed = parsedRows[idx];
                  const periodBad = row.periodStr.trim() !== '' && !parsed?.start && !parsed?.isRelative;
                  const rentBad = row.rentStr.trim() !== '' && isNaN(parsed?.monthlyRent);
                  return (
                    <tr key={row.id} className={parsed?.hasAsterisk ? 'bg-status-warn-bg/35' : idx % 2 === 0 ? 'bg-app-chrome' : 'bg-app-surface'}>
                      <td className="px-3 py-3 align-top font-mono text-txt-dim">{idx + 1}</td>
                      <td className="px-3 py-3 align-top">
                        <input
                          type="text"
                          value={row.periodStr}
                          onChange={(e) => updateRow(row.id, 'periodStr', e.target.value)}
                          placeholder="3/1/18-2/28/19"
                          className={`field-dark ${periodBad ? 'border-status-warn-border bg-status-warn-bg/80' : ''}`}
                        />
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex items-start gap-2">
                          <input
                            type="text"
                            value={row.rentStr}
                            onChange={(e) => updateRow(row.id, 'rentStr', e.target.value)}
                            placeholder="$98,463.60"
                            className={`field-dark ${rentBad ? 'border-status-warn-border bg-status-warn-bg/80' : ''}`}
                          />
                          {parsed?.hasAsterisk && (
                            <span
                              className="status-chip border-status-warn-border bg-status-warn-bg text-status-warn-title"
                              title="Asterisk detected; this period may be subject to rent abatement."
                            >
                              Abatement?
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top text-xs text-txt-muted">
                        <div className="pt-2">
                          <ParsedPreview parsed={parsed} periodStr={row.periodStr} />
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <button
                          type="button"
                          onClick={() => removeRow(row.id)}
                          className="text-sm font-medium leading-none text-status-err-text hover:text-status-err-title"
                          title="Remove row"
                        >
                          x
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={addRow} className="btn-link">
              + Add row
            </button>

            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-txt-muted">
                {validCount > 0 ? `${validCount} valid period${validCount !== 1 ? 's' : ''}` : 'No valid periods yet'}
              </span>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={validCount === 0}
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {validCount > 0 ? 'Continue with Schedule' : 'Enter a Valid Period'}
              </button>
            </div>
          </div>

          {abatementHinted && (
            <div className="rounded-[1rem] border border-status-warn-border bg-status-warn-bg/92 p-4 text-sm text-status-warn-text">
              One or more rows include an asterisk on the rent value. This often indicates a free-rent or abatement period.
              Set Abatement End Date and Abatement Percentage in the next step.
            </div>
          )}

          <p className="text-xs text-txt-dim">
            Rows missing an end date will have it inferred from the next row&apos;s start. The final row still requires an explicit end date.
          </p>
        </div>
      )}
    </div>
  );
}
