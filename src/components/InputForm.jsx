/**
 * InputForm
 * Assumption entry form organized into six visible sections:
 *   1. Lease Drivers
 *   2. Monthly Rent Breakdown
 *   3. Escalation Assumptions
 *   4. Abatement
 *   5. Free Rent
 *   6. Non-Recurring Charges
 *
 * Human-in-the-loop: confirm button is the only trigger for processing.
 */

import { useState, useEffect } from 'react';
import ValidationBanner from './ValidationBanner.jsx';
import { formatDollar } from '../utils/formatUtils.js';
import { defaultChargesForm, emptyChargeForm, generateChargeKey, CANONICAL_TYPES } from '../engine/chargeTypes.js';

// ---------------------------------------------------------------------------
// Primitive UI helpers
// ---------------------------------------------------------------------------

function SectionBox({ title, hint, children, actions }) {
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="font-semibold text-gray-800 text-sm">{title}</h4>
          {hint && (
            <span className="text-gray-400 cursor-help text-xs" title={hint}>ⓘ</span>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className="px-4 py-4">{children}</div>
    </div>
  );
}

function FieldRow({ label, hint, error, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-600">
        {label}
        {hint && (
          <span className="ml-1 text-gray-400 cursor-help" title={hint}>ⓘ</span>
        )}
      </label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = 'text', error, className = '' }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`rounded border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full ${
        error ? 'border-red-400 bg-red-50' : 'border-gray-300'
      } ${className}`}
    />
  );
}

function ConfidenceFlag({ flagged }) {
  if (!flagged) return null;
  return (
    <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
      Low confidence — verify
    </span>
  );
}

function DisplayField({ value, placeholder }) {
  return (
    <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm text-gray-700 min-h-[34px]">
      {value || <span className="text-gray-400 italic text-xs">{placeholder ?? 'Not available'}</span>}
    </div>
  );
}

// Format ISO date string (YYYY-MM-DD) to MM/DD/YYYY for display.
function fmtISO(isoStr) {
  if (!isoStr) return '';
  const m = String(isoStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return isoStr;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

// ---------------------------------------------------------------------------
// Default empty form state
// ---------------------------------------------------------------------------

export function emptyNNN() {
  return { year1: '', escPct: '', chargeStart: '', escStart: '' };
}

export function emptyFormState() {
  return {
    leaseName:             '',
    squareFootage:         '',
    rentCommencementDate:  '',
    effectiveAnalysisDate: '',
    abatementEndDate:      '',
    abatementMonths:       '',
    abatementPct:          '',
    freeRentMonths:        '',
    freeRentEndDate:       '',
    nnnMode:               'individual',
    nnnAggregate:          { year1: '', escPct: '' },
    charges:               defaultChargesForm(),
    oneTimeItems:          [],
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function InputForm({
  initialValues,
  confidenceFlags,
  notices,
  validationErrors,
  sfRequired,
  leaseStartDate,
  leaseEndDate,
  scheduledBaseRent,
  expandedRowCount,
  onSubmit,
  onBack,
  onBackToSchedule,
  isProcessing,
}) {
  const [form, setForm] = useState(() => ({
    ...emptyFormState(),
    ...initialValues,
  }));

  useEffect(() => {
    if (initialValues) {
      setForm((prev) => ({ ...prev, ...initialValues }));
    }
  }, [initialValues]);

  function setTop(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function updateCharge(index, field, value) {
    setForm((prev) => {
      const charges = [...(prev.charges ?? [])];
      charges[index] = { ...charges[index], [field]: value };
      return { ...prev, charges };
    });
  }

  function addCharge() {
    setForm((prev) => {
      const charges = prev.charges ?? [];
      const existingKeys = charges.map((c) => c.key);
      const key = generateChargeKey(existingKeys);
      return { ...prev, charges: [...charges, emptyChargeForm(key)] };
    });
  }

  function removeCharge(index) {
    setForm((prev) => ({
      ...prev,
      charges: (prev.charges ?? []).filter((_, i) => i !== index),
    }));
  }

  function setNNNAggregate(field, value) {
    setForm((prev) => ({
      ...prev,
      nnnAggregate: { ...prev.nnnAggregate, [field]: value },
    }));
  }

  // Auto-compute abatementEndDate when abatementMonths changes.
  function handleAbatementMonths(v) {
    setTop('abatementMonths', v);
    const n = parseInt(v, 10);
    if (leaseStartDate && !isNaN(n) && n > 0) {
      const parts = leaseStartDate.split('-').map(Number);
      const endDate = new Date(parts[0], parts[1] - 1 + n, 0);
      const mm = String(endDate.getMonth() + 1).padStart(2, '0');
      const dd = String(endDate.getDate()).padStart(2, '0');
      setTop('abatementEndDate', `${mm}/${dd}/${endDate.getFullYear()}`);
    } else if (!v || v === '0') {
      setTop('abatementEndDate', '');
    }
  }

  // Auto-compute freeRentEndDate when freeRentMonths changes.
  function handleFreeRentMonths(v) {
    setTop('freeRentMonths', v);
    const n = parseInt(v, 10);
    if (leaseStartDate && !isNaN(n) && n > 0) {
      const parts = leaseStartDate.split('-').map(Number);
      const endDate = new Date(parts[0], parts[1] - 1 + n, 0);
      const mm = String(endDate.getMonth() + 1).padStart(2, '0');
      const dd = String(endDate.getDate()).padStart(2, '0');
      setTop('freeRentEndDate', `${mm}/${dd}/${endDate.getFullYear()}`);
    } else if (!v || v === '0') {
      setTop('freeRentEndDate', '');
    }
  }

  const fieldErrors = {};
  for (const err of validationErrors ?? []) {
    fieldErrors[err.field] = err.message;
  }

  const defaultKeys = new Set(['cams', 'insurance', 'taxes', 'security', 'otherItems']);
  const charges = form.charges ?? defaultChargesForm();
  const flag = (f) => confidenceFlags?.includes(f);

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(form);
  }

  // ── NNN mode toggle element (reused in Monthly Rent Breakdown header) ──────
  const nnnModeToggle = (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">NNN mode:</span>
      <select
        value={form.nnnMode}
        onChange={(e) => setTop('nnnMode', e.target.value)}
        className="rounded border border-gray-300 px-2 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="individual">Individual line items</option>
        <option value="aggregate">Aggregate estimate</option>
      </select>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Lease Assumptions</h2>
        <div className="flex items-center gap-3">
          {onBackToSchedule && (
            <button
              type="button"
              onClick={onBackToSchedule}
              className="text-sm text-blue-600 hover:text-blue-800 underline"
            >
              ← Edit schedule
            </button>
          )}
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            ← Start over
          </button>
        </div>
      </div>

      {expandedRowCount > 0 && (
        <div className="rounded-md bg-gray-50 border border-gray-200 px-4 py-2 text-sm text-gray-600">
          Rent schedule loaded: <strong>{expandedRowCount}</strong> monthly row{expandedRowCount !== 1 ? 's' : ''}
          {leaseStartDate && <span className="ml-1">starting {fmtISO(leaseStartDate)}</span>}
        </div>
      )}

      {notices?.length > 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1">
          {notices.map((n, i) => (
            <p key={i} className="text-sm text-amber-800">{n}</p>
          ))}
        </div>
      )}

      <ValidationBanner errors={validationErrors ?? []} />

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ══ 1. Lease Drivers ══════════════════════════════════════════════ */}
        <SectionBox title="Lease Drivers">
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label={<>Lease Name <ConfidenceFlag flagged={flag('leaseName')} /></>}>
              <TextInput
                value={form.leaseName}
                onChange={(v) => setTop('leaseName', v)}
                placeholder="e.g. Anita's Mexican Foods"
              />
            </FieldRow>

            <FieldRow
              label={
                <>
                  Rentable SF
                  {sfRequired && <span className="ml-1 text-red-600 font-semibold">(required)</span>}
                  <ConfidenceFlag flagged={flag('squareFootage')} />
                </>
              }
              error={fieldErrors['squareFootage']}
            >
              <TextInput
                type="number"
                value={form.squareFootage}
                onChange={(v) => setTop('squareFootage', v)}
                placeholder="e.g. 5000"
                error={fieldErrors['squareFootage']}
              />
            </FieldRow>

            <FieldRow label="Lease Commencement" hint="Derived from the loaded rent schedule. Edit the schedule to change.">
              <DisplayField value={fmtISO(leaseStartDate)} placeholder="Load a rent schedule first" />
            </FieldRow>

            <FieldRow label="Lease Expiration" hint="Derived from the loaded rent schedule.">
              <DisplayField value={fmtISO(leaseEndDate)} placeholder="Load a rent schedule first" />
            </FieldRow>

            <FieldRow
              label="Rent Commencement Date"
              hint="If rent obligations begin on a date different from the lease commencement date, enter it here."
            >
              <TextInput
                value={form.rentCommencementDate}
                onChange={(v) => setTop('rentCommencementDate', v)}
                placeholder="MM/DD/YYYY (optional)"
              />
            </FieldRow>

            <FieldRow
              label="Effective Date of Analysis"
              hint="As-of date used to compute remaining obligations in the summary panel. Leave blank to use lease commencement."
            >
              <TextInput
                value={form.effectiveAnalysisDate}
                onChange={(v) => setTop('effectiveAnalysisDate', v)}
                placeholder="MM/DD/YYYY (optional)"
              />
            </FieldRow>
          </div>
        </SectionBox>

        {/* ══ 2. Monthly Rent Breakdown ═════════════════════════════════════ */}
        <SectionBox
          title="Monthly Rent Breakdown"
          hint="Year 1 monthly amounts for base rent and each recurring charge."
          actions={nnnModeToggle}
        >
          {form.nnnMode === 'aggregate' && (
            <div className="rounded bg-amber-50 border border-amber-200 p-2 mb-3 text-xs text-amber-700">
              Aggregate NNN mode — a single combined NNN estimate replaces individual CAMS, Insurance, and Taxes line items.
            </div>
          )}

          {/* Column headers */}
          <div className="grid grid-cols-[1fr_80px_120px_28px] gap-x-2 mb-1 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <span>Charge</span>
            <span>Type</span>
            <span>Year 1 Monthly ($)</span>
            <span />
          </div>

          {/* Base rent row (read-only, from schedule) */}
          {scheduledBaseRent != null && (
            <div className="grid grid-cols-[1fr_80px_120px_28px] gap-x-2 items-center py-1.5 border-b border-gray-100">
              <span className="text-sm text-gray-700 font-medium">Base Rent</span>
              <span className="text-xs text-gray-400 italic">—</span>
              <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm text-gray-600 font-mono">
                {formatDollar(scheduledBaseRent)}
              </div>
              <span />
            </div>
          )}

          {/* Aggregate NNN row */}
          {form.nnnMode === 'aggregate' && (
            <div className="grid grid-cols-[1fr_80px_120px_28px] gap-x-2 items-center py-1.5 border-b border-gray-100">
              <span className="text-sm text-gray-700 font-medium">
                NNN — Aggregate Estimate
                <ConfidenceFlag flagged={flag('nnnAggregate.year1')} />
              </span>
              <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-pink-100 text-pink-700 self-center">NNN</span>
              <TextInput
                type="number"
                value={form.nnnAggregate?.year1 ?? ''}
                onChange={(v) => setNNNAggregate('year1', v)}
                placeholder="0.00"
                error={fieldErrors['nnnAggregate.year1']}
              />
              <span />
            </div>
          )}

          {/* Individual charge rows */}
          {charges.map((charge, idx) => {
            if (form.nnnMode === 'aggregate' && charge.canonicalType === CANONICAL_TYPES.NNN) return null;
            const isCustom = !defaultKeys.has(charge.key);
            return (
              <div key={charge.key} className="grid grid-cols-[1fr_80px_120px_28px] gap-x-2 items-center py-1.5 border-b border-gray-100 last:border-0">
                <TextInput
                  value={charge.displayLabel}
                  onChange={(v) => updateCharge(idx, 'displayLabel', v)}
                  placeholder="Charge name"
                />
                <select
                  value={charge.canonicalType}
                  onChange={(e) => updateCharge(idx, 'canonicalType', e.target.value)}
                  className="rounded border border-gray-300 px-1 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
                  title="NNN charges contribute to Total NNN. Other charges go to the Other Charges bucket."
                >
                  <option value={CANONICAL_TYPES.NNN}>NNN</option>
                  <option value={CANONICAL_TYPES.OTHER}>Other</option>
                </select>
                <TextInput
                  type="number"
                  value={charge.year1}
                  onChange={(v) => updateCharge(idx, 'year1', v)}
                  placeholder="0"
                  error={fieldErrors[`charges.${idx}.year1`]}
                />
                {isCustom ? (
                  <button
                    type="button"
                    onClick={() => removeCharge(idx)}
                    className="text-sm text-red-400 hover:text-red-600 font-medium leading-none"
                    title="Remove charge"
                  >
                    ×
                  </button>
                ) : (
                  <span />
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={addCharge}
            className="mt-3 text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            + Add recurring charge
          </button>
        </SectionBox>

        {/* ══ 3. Escalation Assumptions ════════════════════════════════════ */}
        <SectionBox
          title="Escalation Assumptions"
          hint="Annual escalation rates and optional start dates for each recurring charge."
        >
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_100px_140px_140px] gap-x-2 mb-1 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <span>Charge</span>
            <span>Annual Rate (%)</span>
            <span>Escalation Start</span>
            <span>Billing Start</span>
          </div>

          {/* Aggregate NNN escalation row */}
          {form.nnnMode === 'aggregate' && (
            <div className="grid grid-cols-[1fr_100px_140px_140px] gap-x-2 items-center py-1.5 border-b border-gray-100">
              <span className="text-sm text-gray-700">NNN — Aggregate</span>
              <TextInput
                type="number"
                value={form.nnnAggregate?.escPct ?? ''}
                onChange={(v) => setNNNAggregate('escPct', v)}
                placeholder="0"
                error={fieldErrors['nnnAggregate.escPct']}
              />
              <span className="text-xs text-gray-400 py-1.5">—</span>
              <span className="text-xs text-gray-400 py-1.5">—</span>
            </div>
          )}

          {/* Individual charge escalation rows */}
          {charges.map((charge, idx) => {
            if (form.nnnMode === 'aggregate' && charge.canonicalType === CANONICAL_TYPES.NNN) return null;
            return (
              <div key={charge.key} className="grid grid-cols-[1fr_100px_140px_140px] gap-x-2 items-center py-1.5 border-b border-gray-100 last:border-0">
                <span className="text-sm text-gray-700 truncate">
                  {charge.displayLabel || charge.key}
                  <ConfidenceFlag flagged={flag(`${charge.key}.escPct`) || flag(`charges.${idx}.escPct`)} />
                </span>
                <TextInput
                  type="number"
                  value={charge.escPct}
                  onChange={(v) => updateCharge(idx, 'escPct', v)}
                  placeholder="0"
                  error={fieldErrors[`charges.${idx}.escPct`]}
                />
                <TextInput
                  value={charge.escStart}
                  onChange={(v) => updateCharge(idx, 'escStart', v)}
                  placeholder="MM/DD/YYYY"
                  error={fieldErrors[`charges.${idx}.escStart`]}
                />
                <TextInput
                  value={charge.chargeStart}
                  onChange={(v) => updateCharge(idx, 'chargeStart', v)}
                  placeholder="MM/DD/YYYY"
                  error={fieldErrors[`charges.${idx}.chargeStart`]}
                />
              </div>
            );
          })}

          <p className="text-xs text-gray-400 mt-2">
            Leave Escalation Start and Billing Start blank to anchor from lease commencement.
          </p>
        </SectionBox>

        {/* ══ 4. Abatement ═════════════════════════════════════════════════ */}
        <SectionBox
          title="Abatement"
          hint="Partial or full rent reduction for a specified period (e.g. during tenant improvement work). Percentage applies to base rent."
        >
          <div className="grid grid-cols-3 gap-3">
            <FieldRow
              label="# Months of Abatement"
              hint="Abatement period beginning at lease commencement. Auto-computes end date."
              error={fieldErrors['abatementMonths']}
            >
              <TextInput
                type="number"
                value={form.abatementMonths}
                onChange={handleAbatementMonths}
                placeholder="e.g. 6"
                error={fieldErrors['abatementMonths']}
              />
            </FieldRow>

            <FieldRow
              label={<>Abatement End Date <ConfidenceFlag flagged={flag('abatementEndDate')} /></>}
              hint="Last day of abatement (inclusive). Auto-filled from months, or enter directly."
              error={fieldErrors['abatementEndDate']}
            >
              <TextInput
                value={form.abatementEndDate}
                onChange={(v) => {
                  setTop('abatementEndDate', v);
                  if (form.abatementMonths) setTop('abatementMonths', '');
                }}
                placeholder="MM/DD/YYYY"
                error={fieldErrors['abatementEndDate']}
              />
            </FieldRow>

            <FieldRow
              label="Abatement Percentage (%)"
              hint="100 = full abatement (tenant pays $0). 50 = half (tenant pays half). 0 = no abatement."
              error={fieldErrors['abatementPct']}
            >
              <TextInput
                type="number"
                value={form.abatementPct}
                onChange={(v) => setTop('abatementPct', v)}
                placeholder="e.g. 100"
                error={fieldErrors['abatementPct']}
              />
            </FieldRow>
          </div>

          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-gray-500">Quick set:</span>
            {[
              { label: 'Full (100%)', value: '100' },
              { label: 'Half (50%)', value: '50' },
              { label: 'None (0%)', value: '0' },
            ].map(({ label, value }) => (
              <button
                key={value}
                type="button"
                onClick={() => setTop('abatementPct', value)}
                className={`rounded px-2.5 py-1 text-xs font-medium border transition-colors ${
                  form.abatementPct === value
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </SectionBox>

        {/* ══ 5. Free Rent ══════════════════════════════════════════════════ */}
        <SectionBox
          title="Free Rent"
          hint="Period in which the tenant pays no rent. Semantically distinct from partial abatement. If both Free Rent and Abatement are filled, Free Rent takes precedence."
        >
          <div className="grid grid-cols-2 gap-3">
            <FieldRow
              label="# Months of Free Rent"
              hint="Tenant pays $0 for this many months from lease commencement. Auto-computes the end date."
            >
              <TextInput
                type="number"
                value={form.freeRentMonths}
                onChange={handleFreeRentMonths}
                placeholder="e.g. 3"
              />
            </FieldRow>

            <FieldRow
              label="Free Rent End Date"
              hint="Last day of the free rent period (inclusive). Auto-filled from months, or enter directly."
            >
              <TextInput
                value={form.freeRentEndDate}
                onChange={(v) => {
                  setTop('freeRentEndDate', v);
                  if (form.freeRentMonths) setTop('freeRentMonths', '');
                }}
                placeholder="MM/DD/YYYY"
              />
            </FieldRow>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Free rent is applied as 100% abatement for the specified period. Use the Abatement section above for partial rent reductions.
          </p>
        </SectionBox>

        {/* ══ 6. Non-Recurring Charges ════════════════════════════════════ */}
        <SectionBox
          title="Non-Recurring Charges"
          hint="One-time charges assigned to a specific month (e.g. key money, security deposit, special assessments)."
          actions={
            <button
              type="button"
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  oneTimeItems: [...(prev.oneTimeItems ?? []), { label: '', date: '', amount: '' }],
                }))
              }
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              + Add item
            </button>
          }
        >
          {(form.oneTimeItems ?? []).length === 0 ? (
            <p className="text-xs text-gray-400">
              No non-recurring charges. Click "+ Add item" to add key money, deposits, or other one-time items.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_140px_120px_28px] gap-x-2 mb-1 text-xs font-medium text-gray-500 uppercase tracking-wide">
                <span>Label</span>
                <span>Date</span>
                <span>Amount ($)</span>
                <span />
              </div>
              {(form.oneTimeItems ?? []).map((item, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_140px_120px_28px] gap-x-2 items-center mb-2">
                  <TextInput
                    value={item.label}
                    onChange={(v) =>
                      setForm((prev) => {
                        const items = [...prev.oneTimeItems];
                        items[idx] = { ...items[idx], label: v };
                        return { ...prev, oneTimeItems: items };
                      })
                    }
                    placeholder="e.g. Key Money"
                  />
                  <TextInput
                    value={item.date}
                    onChange={(v) =>
                      setForm((prev) => {
                        const items = [...prev.oneTimeItems];
                        items[idx] = { ...items[idx], date: v };
                        return { ...prev, oneTimeItems: items };
                      })
                    }
                    placeholder="MM/DD/YYYY (optional)"
                  />
                  <TextInput
                    type="number"
                    value={item.amount}
                    onChange={(v) =>
                      setForm((prev) => {
                        const items = [...prev.oneTimeItems];
                        items[idx] = { ...items[idx], amount: v };
                        return { ...prev, oneTimeItems: items };
                      })
                    }
                    placeholder="0"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        oneTimeItems: prev.oneTimeItems.filter((_, i) => i !== idx),
                      }))
                    }
                    className="text-sm text-red-400 hover:text-red-600 font-medium leading-none"
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </>
          )}
        </SectionBox>

        {/* Submit */}
        <div className="flex items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={isProcessing}
            className="flex-1 rounded-md bg-blue-600 text-white py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isProcessing ? 'Processing...' : 'Confirm & Process Schedule'}
          </button>
        </div>
        <p className="text-xs text-gray-400 text-center">
          Processing will not begin until you click the button above. Review all fields before confirming.
        </p>
      </form>
    </div>
  );
}
