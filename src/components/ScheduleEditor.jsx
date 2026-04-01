/**
 * ScheduleEditor
 * Manual rent schedule entry with flexible period format support.
 */

import { useState, useMemo, useEffect } from 'react';
import DatePicker from './DatePicker.jsx';
import {
  parsePeriodString,
  parseRentString,
  parseBulkPasteText,
  toCanonicalPeriodRows,
} from '../engine/periodParser.js';
import { addMonthsAnchored, parseMDYStrict, toISOLocal } from '../engine/yearMonth.js';
import {
  formatLeaseMonthLabel,
  formatLeaseMonthRange,
  getLeaseMonthNumber,
  getLeaseMonthRange,
  getLeaseStartDate,
} from '../utils/leaseMonthUtils.js';

let nextId = 1;

function newRow() {
  return { id: nextId++, startDate: '', endDate: '', rentStr: '' };
}

export function buildEditableRowsFromPeriods(periodRows = []) {
  if (!Array.isArray(periodRows) || periodRows.length === 0) {
    return [newRow(), newRow(), newRow()];
  }

  return periodRows.map((period) => ({
    id: nextId++,
    startDate: period.periodStart ? fmtMDY(period.periodStart) : '',
    endDate: period.periodEnd ? fmtMDY(period.periodEnd) : '',
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

  if (parsed?.warning) {
    return <span className="text-status-err-text">{parsed.warning}</span>;
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

  return null;
}

function addDaysLocal(date, days) {
  if (!date || Number.isNaN(date.getTime?.())) return null;
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  next.setHours(0, 0, 0, 0);
  return next;
}

function buildPreserveMonthSpacingDisabledReason(rowIndex, message) {
  return `Row ${rowIndex + 1}: ${message}`;
}

export function analyzePreserveMonthSpacing(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      eligible: false,
      reason: 'Load or enter dated schedule rows before using Preserve Month Spacing.',
      parsedRows: [],
      leaseStartDate: null,
    };
  }

  const parsedRows = buildParsedRows(rows);
  const leaseStartDate = getLeaseStartDate(parsedRows);

  if (!leaseStartDate) {
    return {
      eligible: false,
      reason: 'Enter a valid Month 1 start date in the schedule before using Preserve Month Spacing.',
      parsedRows,
      leaseStartDate: null,
    };
  }

  for (let index = 0; index < parsedRows.length; index += 1) {
    const row = parsedRows[index];
    const source = rows[index] ?? {};
    const startInput = String(source.startDate ?? '').trim();
    const endInput = String(source.endDate ?? '').trim();

    if (startInput && !row._startValid) {
      return {
        eligible: false,
        reason: buildPreserveMonthSpacingDisabledReason(index, 'enter a valid start date first.'),
        parsedRows,
        leaseStartDate,
      };
    }

    if (endInput && !row._endValid) {
      return {
        eligible: false,
        reason: buildPreserveMonthSpacingDisabledReason(index, 'enter a valid end date first.'),
        parsedRows,
        leaseStartDate,
      };
    }

    if (!row.start) {
      return {
        eligible: false,
        reason: buildPreserveMonthSpacingDisabledReason(index, 'a start date is required to preserve month spacing.'),
        parsedRows,
        leaseStartDate,
      };
    }

    if (!row.end) {
      return {
        eligible: false,
        reason: buildPreserveMonthSpacingDisabledReason(index, 'an end date is required to preserve month spacing.'),
        parsedRows,
        leaseStartDate,
      };
    }

    if (row.end.getTime() < row.start.getTime()) {
      return {
        eligible: false,
        reason: buildPreserveMonthSpacingDisabledReason(index, 'end date must be on or after the start date.'),
        parsedRows,
        leaseStartDate,
      };
    }

    if (index > 0) {
      const previous = parsedRows[index - 1];
      const previousBoundary = previous?.end ?? previous?.start ?? null;
      if (previousBoundary && row.start.getTime() <= previousBoundary.getTime()) {
        return {
          eligible: false,
          reason: buildPreserveMonthSpacingDisabledReason(index, 'start date must stay after the prior row ends.'),
          parsedRows,
          leaseStartDate,
        };
      }
    }

    const leaseMonthRange = getLeaseMonthRange(leaseStartDate, row.start, row.end);
    if (
      !Number.isInteger(leaseMonthRange?.startMonthNumber)
      || !Number.isInteger(leaseMonthRange?.endMonthNumber)
    ) {
      return {
        eligible: false,
        reason: buildPreserveMonthSpacingDisabledReason(index, 'lease-month spacing could not be resolved from the current dates.'),
        parsedRows,
        leaseStartDate,
      };
    }
  }

  return {
    eligible: true,
    reason: null,
    parsedRows,
    leaseStartDate,
  };
}

export function buildRowsPreservingMonthSpacing(rows, anchorDateInput) {
  const analysis = analyzePreserveMonthSpacing(rows);
  const anchorDate = anchorDateInput instanceof Date
    ? anchorDateInput
    : parseMDYStrict(String(anchorDateInput ?? '').trim());

  if (!analysis.eligible || !anchorDate) return null;

  return rows.map((row, index) => {
    const parsed = analysis.parsedRows[index];
    const leaseMonthRange = getLeaseMonthRange(analysis.leaseStartDate, parsed.start, parsed.end);
    const nextStart = addMonthsAnchored(anchorDate, leaseMonthRange.startMonthNumber - 1);
    const nextEndExclusive = addMonthsAnchored(anchorDate, leaseMonthRange.endMonthNumber);
    const nextEnd = addDaysLocal(nextEndExclusive, -1);

    return {
      ...row,
      startDate: fmtMDY(nextStart),
      endDate: fmtMDY(nextEnd),
    };
  });
}

export function buildParsedRows(rows) {
  const intermediate = rows.map((row) => {
    const startInput = String(row.startDate ?? '').trim();
    const endInput = String(row.endDate ?? '').trim();
    const startParsed = parsePeriodString(startInput);
    const endParsed = parsePeriodString(endInput);
    const { rent, hasAsterisk } = parseRentString(row.rentStr);

    const warning = [
      startInput && !startParsed.start ? 'Enter a valid start date.' : null,
      endInput && !endParsed.start ? 'Enter a valid end date.' : null,
      row.rentStr.trim() !== '' && isNaN(rent) ? 'Enter a valid monthly base rent.' : null,
    ].filter(Boolean).join(' ');

    return {
      start: startParsed.start,
      end: endParsed.start,
      monthlyRent: rent,
      hasAsterisk,
      warning: warning || null,
      _id: row.id,
      _startInput: startInput,
      _endInput: endInput,
      _startValid: Boolean(startParsed.start),
      _endValid: endInput ? Boolean(endParsed.start) : true,
    };
  });

  const withInferredEnds = intermediate.map((row, idx) => {
    if (row.end || !row.start || row._endInput !== '') {
      return { ...row, endInferred: false };
    }

    let inferredEnd = null;
    for (let i = idx + 1; i < intermediate.length; i += 1) {
      if (intermediate[i].start) {
        inferredEnd = new Date(intermediate[i].start.getTime() - 86400000);
        inferredEnd.setHours(0, 0, 0, 0);
        break;
      }
    }

    return {
      ...row,
      end: inferredEnd,
      endInferred: inferredEnd !== null,
    };
  });

  return withInferredEnds.map((row, idx) => {
    const warnings = [];
    if (row.warning) warnings.push(row.warning);
    if (row.start && row.end && row.end.getTime() < row.start.getTime()) {
      warnings.push('End date must be on or after the start date.');
    }
    if (idx > 0 && row.start) {
      const previous = withInferredEnds[idx - 1];
      const previousBoundary = previous?.end ?? previous?.start ?? null;
      if (previousBoundary && row.start.getTime() <= previousBoundary.getTime()) {
        warnings.push(`Start date must be after the previous row ends (${fmtMDY(previousBoundary)}).`);
      }
    }

    return {
      ...row,
      warning: warnings.join(' ').trim() || null,
    };
  });
}

export function buildRowCalendarConstraints(rows) {
  const parsedRows = buildParsedRows(rows);
  return parsedRows.map((row, idx) => {
    const previous = idx > 0 ? parsedRows[idx - 1] : null;
    const next = idx < parsedRows.length - 1 ? parsedRows[idx + 1] : null;
    const previousBoundary = previous?.end ?? previous?.start ?? null;
    const nextStart = next?.start ?? null;

    return {
      minStartDate: previousBoundary ? addDaysLocal(previousBoundary, 1) : null,
      minEndDate: row.start ?? null,
      maxEndDate: nextStart ? addDaysLocal(nextStart, -1) : null,
    };
  });
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
  const [preserveMonthSpacingEnabled, setPreserveMonthSpacingEnabled] = useState(false);
  const [reanchorStartDate, setReanchorStartDate] = useState('');

  useEffect(() => {
    setRows(buildEditableRowsFromPeriods(initialPeriodRows));
    setPreserveMonthSpacingEnabled(false);
    setReanchorStartDate('');
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

  const preserveMonthSpacingAnalysis = useMemo(() => analyzePreserveMonthSpacing(rows), [rows]);
  const sourceLeaseStartDate = preserveMonthSpacingAnalysis.leaseStartDate;
  const transformedRows = useMemo(() => {
    if (!preserveMonthSpacingEnabled) return null;
    return buildRowsPreservingMonthSpacing(rows, reanchorStartDate);
  }, [preserveMonthSpacingEnabled, reanchorStartDate, rows]);
  const effectiveRows = preserveMonthSpacingEnabled && transformedRows ? transformedRows : rows;

  useEffect(() => {
    if (!sourceLeaseStartDate) return;
    setReanchorStartDate((current) => current || fmtMDY(sourceLeaseStartDate));
  }, [sourceLeaseStartDate]);

  const parsedRows = useMemo(() => {
    return buildParsedRows(effectiveRows);
  }, [effectiveRows]);
  const rowCalendarConstraints = useMemo(() => buildRowCalendarConstraints(effectiveRows), [effectiveRows]);
  const manualLeaseStartDate = useMemo(() => getLeaseStartDate(parsedRows), [parsedRows]);
  const quickPreviewLeaseStartDate = useMemo(() => getLeaseStartDate(quickPreview), [quickPreview]);
  const quickCommenceParsed = useMemo(() => parsePeriodString(quickForm.commenceDate).start, [quickForm.commenceDate]);
  const quickExpireParsed = useMemo(() => parsePeriodString(quickForm.expireDate).start, [quickForm.expireDate]);

  const blockingRowWarnings = parsedRows.filter((row) => Boolean(row.warning));
  const validCount = parsedRows.filter((row) => row.start && row.end && !isNaN(row.monthlyRent) && !row.warning).length;
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
      startDate: period.start ? fmtMDY(period.start) : '',
      endDate: period.end ? fmtMDY(period.end) : '',
      rentStr: period.rentStr,
    }));
    setRows(loaded.length > 0 ? loaded : [newRow()]);
    if (!warnings.length) {
      setShowBulkPaste(false);
      setBulkText('');
    }
  }

  function handleConfirm() {
    const rowsForConfirm = preserveMonthSpacingEnabled && transformedRows ? transformedRows : rows;
    const parsedRowsForConfirm = buildParsedRows(rowsForConfirm);
    const canonical = toCanonicalPeriodRows(parsedRowsForConfirm);
    const rowWarnings = parsedRowsForConfirm
      .map((row, i) => (row.warning ? `Row ${i + 1}: ${row.warning}` : null))
      .filter(Boolean);
    const transformWarnings = preserveMonthSpacingEnabled && transformedRows
      ? ['Manual Capture re-anchored the base-rent schedule from the selected Month 1 start date while preserving lease-month spacing.']
      : [];
    onConfirm(canonical, [...transformWarnings, ...rowWarnings]);
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
                    rangeLabel = `Lease Years ${term.startYear}-${term.endYear}`;
                  } else {
                    rangeLabel = (term.periodStart || term.periodEnd)
                      ? `${term.periodStart ?? ''}${term.periodEnd ? ` - ${term.periodEnd}` : ''}`
                      : 'Dates pending';
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
                <DatePicker
                  value={quickForm.commenceDate}
                  onChange={(value) => updateQuickForm('commenceDate', value)}
                  placeholder="MM/DD/YYYY"
                  leaseMonthLabel={formatLeaseMonthLabel(quickCommenceParsed ? 1 : null)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-txt-dim">Lease Expiration Date</label>
                <DatePicker
                  value={quickForm.expireDate}
                  onChange={(value) => updateQuickForm('expireDate', value)}
                  placeholder="MM/DD/YYYY"
                  minDate={quickCommenceParsed ? addDaysLocal(quickCommenceParsed, 1) : null}
                  leaseMonthLabel={formatLeaseMonthLabel(getLeaseMonthNumber(quickCommenceParsed, quickExpireParsed))}
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
                      <th className="px-3 py-3 text-left font-semibold">Lease Months</th>
                      <th className="px-3 py-3 text-left font-semibold">Year</th>
                      <th className="px-3 py-3 text-left font-semibold">Period Start</th>
                      <th className="px-3 py-3 text-left font-semibold">Period End</th>
                      <th className="px-3 py-3 text-right font-semibold">Monthly Base Rent</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-app-border">
                    {quickPreview.map((period, idx) => (
                      <tr key={idx} className={idx % 2 === 0 ? 'bg-app-chrome' : 'bg-app-surface'}>
                        <td className="px-3 py-3 font-mono text-txt-primary">
                          {formatLeaseMonthRange(
                            getLeaseMonthRange(
                              quickPreviewLeaseStartDate,
                              period.periodStart,
                              period.periodEnd,
                            ),
                          ) || '-'}
                        </td>
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
                  Use the calendar fields below to correct start and end dates directly. Open Bulk Paste only if you
                  want to import a schedule block first.
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

            <div className="mt-5 rounded-[1rem] border border-app-border bg-app-chrome px-4 py-4 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-txt-primary">Preserve Month Spacing</p>
                    <span className="status-chip border-accent/30 bg-accent/10 text-accent-soft">
                      Supplementary Transform
                    </span>
                  </div>
                  <p className="max-w-2xl text-sm leading-6 text-txt-muted">
                    Turn this on only when you have the correct Month 1 start date and want the current schedule rows
                    re-dated while keeping their lease-month spacing intact. This transforms only the loaded schedule.
                  </p>
                </div>

                <div className="segmented-control">
                  <button
                    type="button"
                    onClick={() => setPreserveMonthSpacingEnabled(false)}
                    className={`segmented-option ${!preserveMonthSpacingEnabled ? 'segmented-option-active' : ''}`}
                  >
                    Off
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!preserveMonthSpacingAnalysis.eligible) return;
                      if (!reanchorStartDate && sourceLeaseStartDate) {
                        setReanchorStartDate(fmtMDY(sourceLeaseStartDate));
                      }
                      setPreserveMonthSpacingEnabled(true);
                    }}
                    disabled={!preserveMonthSpacingAnalysis.eligible}
                    className={`segmented-option ${preserveMonthSpacingEnabled ? 'segmented-option-active' : ''} disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    On
                  </button>
                </div>
              </div>

              {preserveMonthSpacingAnalysis.eligible ? (
                <div className="grid gap-4 md:grid-cols-[minmax(0,240px)_1fr]">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold uppercase tracking-[0.16em] text-txt-dim">
                      Month 1 Start Date
                    </label>
                    <DatePicker
                      value={reanchorStartDate}
                      onChange={setReanchorStartDate}
                      placeholder="MM/DD/YYYY"
                      leaseMonthLabel={formatLeaseMonthLabel(reanchorStartDate ? 1 : null)}
                    />
                  </div>

                  <div className={`rounded-[1rem] border px-4 py-3 text-sm ${
                    preserveMonthSpacingEnabled
                      ? 'border-accent/30 bg-accent/5 text-txt-primary'
                      : 'border-app-border bg-app-panel text-txt-muted'
                  }`}>
                    {preserveMonthSpacingEnabled ? (
                      <p>
                        The table below is previewing transformed dates from the selected Month 1 start date. Continue with
                        Schedule will carry these dates into Assumptions, Results, and export.
                      </p>
                    ) : (
                      <p>
                        Leave this off to keep the current row-by-row editing behavior. Turn it on only for a schedule-wide
                        date shift that preserves lease-month spacing.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-[1rem] border border-status-warn-border bg-status-warn-bg/75 px-4 py-3 text-sm text-status-warn-text">
                  {preserveMonthSpacingAnalysis.reason}
                </div>
              )}
            </div>
          </div>

          {showBulkPaste && (
            <div className="surface-panel px-5 py-5">
              <p className="section-kicker">Bulk Paste</p>
              <p className="mt-3 text-sm text-txt-muted">
                One row per line. Separate the period and rent using a tab or at least two spaces.
              </p>
              <div className="mt-4 rounded-[1rem] border border-app-border bg-app-chrome px-4 py-4 text-xs text-txt-muted space-y-2">
                <p className="font-display text-sm font-semibold text-txt-primary">Accepted period formats</p>
                <p><code className="rounded border border-app-border-strong bg-app-panel px-1.5 py-0.5 text-txt-primary">3/1/18-2/28/19</code> or <code className="rounded border border-app-border-strong bg-app-panel px-1.5 py-0.5 text-txt-primary">3/1/18 - 2/28/19</code> for explicit start and end dates.</p>
                <p><code className="rounded border border-app-border-strong bg-app-panel px-1.5 py-0.5 text-txt-primary">3/1/18</code> for a single start date; the end will be inferred from the next row.</p>
                <p>Two-digit years are interpreted as 00-49 =&gt; 2000-2049, 50-99 =&gt; 1950-1999. Rent values can include $ signs, commas, and an asterisk to flag potential abatement.</p>
              </div>
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
                  <th className="px-3 py-3 text-left font-semibold">Lease Months</th>
                  <th className="px-3 py-3 text-left font-semibold">Start Date</th>
                  <th className="px-3 py-3 text-left font-semibold">End Date</th>
                  <th className="px-3 py-3 text-left font-semibold">Monthly Base Rent</th>
                  <th className="px-3 py-3 text-left font-semibold">Status</th>
                  <th className="px-3 py-3 text-left font-semibold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border">
                {effectiveRows.map((row, idx) => {
                  const parsed = parsedRows[idx];
                  const constraints = rowCalendarConstraints[idx] ?? {};
                  const leaseMonthNumber = getLeaseMonthNumber(manualLeaseStartDate, parsed?.start);
                  const endMonthNumber = getLeaseMonthNumber(manualLeaseStartDate, parsed?.end);
                  const leaseMonthRange = getLeaseMonthRange(manualLeaseStartDate, parsed?.start, parsed?.end);
                  const startConflict = parsed?.warning?.includes('Start date must be after the previous row ends');
                  const endConflict = parsed?.warning?.includes('End date must be on or after the start date');
                  const startBad = (row.startDate.trim() !== '' && !parsed?._startValid) || startConflict;
                  const endBad = (row.endDate.trim() !== '' && !parsed?._endValid) || endConflict;
                  const rentBad = row.rentStr.trim() !== '' && isNaN(parsed?.monthlyRent);
                  return (
                    <tr key={row.id} className={parsed?.hasAsterisk ? 'bg-status-warn-bg/35' : idx % 2 === 0 ? 'bg-app-chrome' : 'bg-app-surface'}>
                      <td className="px-3 py-3 align-top font-mono text-txt-dim">{idx + 1}</td>
                      <td className="px-3 py-3 align-top font-mono text-txt-primary">
                        {formatLeaseMonthRange(leaseMonthRange) || <span className="text-txt-faint">-</span>}
                      </td>
                      <td className="px-3 py-3 align-top">
                        {preserveMonthSpacingEnabled ? (
                          <div className={`rounded-[1rem] border px-3 py-2 ${
                            startBad ? 'border-status-err-border bg-status-err-bg/70' : 'border-app-border bg-app-chrome'
                          }`}>
                            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-accent-soft">
                              {formatLeaseMonthLabel(leaseMonthNumber) || 'Month pending'}
                            </p>
                            <p className="mt-1 font-mono text-sm text-txt-primary">{row.startDate || 'MM/DD/YYYY'}</p>
                          </div>
                        ) : (
                          <DatePicker
                            value={row.startDate}
                            onChange={(value) => updateRow(row.id, 'startDate', value)}
                            placeholder="MM/DD/YYYY"
                            error={startBad}
                            leaseMonthLabel={formatLeaseMonthLabel(leaseMonthNumber)}
                            minDate={constraints.minStartDate}
                          />
                        )}
                      </td>
                      <td className="px-3 py-3 align-top">
                        {preserveMonthSpacingEnabled ? (
                          <div className={`rounded-[1rem] border px-3 py-2 ${
                            endBad ? 'border-status-err-border bg-status-err-bg/70' : 'border-app-border bg-app-chrome'
                          }`}>
                            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-accent-soft">
                              {formatLeaseMonthLabel(endMonthNumber) || 'Month pending'}
                            </p>
                            <p className="mt-1 font-mono text-sm text-txt-primary">{row.endDate || 'MM/DD/YYYY'}</p>
                          </div>
                        ) : (
                          <DatePicker
                            value={row.endDate}
                            onChange={(value) => updateRow(row.id, 'endDate', value)}
                            placeholder="MM/DD/YYYY"
                            error={endBad}
                            leaseMonthLabel={formatLeaseMonthLabel(endMonthNumber)}
                            minDate={constraints.minEndDate}
                            maxDate={constraints.maxEndDate}
                          />
                        )}
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
                          <ParsedPreview parsed={parsed} periodStr={row.startDate || row.endDate} />
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <button
                          type="button"
                          onClick={() => removeRow(row.id)}
                          disabled={preserveMonthSpacingEnabled}
                          className="text-sm font-medium leading-none text-status-err-text hover:text-status-err-title disabled:cursor-not-allowed disabled:opacity-40"
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
            <button
              type="button"
              onClick={addRow}
              disabled={preserveMonthSpacingEnabled}
              className="btn-link disabled:cursor-not-allowed disabled:opacity-40"
            >
              + Add row
            </button>

            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-txt-muted">
                {validCount > 0 ? `${validCount} valid period${validCount !== 1 ? 's' : ''}` : 'No valid periods yet'}
              </span>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={
                  validCount === 0
                  || blockingRowWarnings.length > 0
                  || (preserveMonthSpacingEnabled && (!preserveMonthSpacingAnalysis.eligible || !transformedRows))
                }
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {validCount > 0 && blockingRowWarnings.length === 0 ? 'Continue with Schedule' : 'Enter a Valid Period'}
              </button>
            </div>
          </div>

          {blockingRowWarnings.length > 0 && (
            <div className="rounded-[1rem] border border-status-err-border bg-status-err-bg/92 p-4 text-sm text-status-err-text">
              Fix the highlighted date conflicts before continuing. Each new row must start after the prior row ends, and each end date must be on or after its start date.
            </div>
          )}

          {abatementHinted && (
            <div className="rounded-[1rem] border border-status-warn-border bg-status-warn-bg/92 p-4 text-sm text-status-warn-text">
              One or more rows include an asterisk on the rent value. This often indicates a free-rent or abatement period.
              Set Abatement End Date and Abatement Percentage in the next step.
            </div>
          )}

          <p className="text-xs text-txt-dim">
            Rows missing an end date will have it inferred from the next row&apos;s start. The final row still requires an explicit end date.
          </p>

          {preserveMonthSpacingEnabled && (
            <p className="text-xs text-txt-dim">
              Preserve Month Spacing is on. Date cells are locked to the transformed preview above; turn it off to return to row-by-row date editing.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
