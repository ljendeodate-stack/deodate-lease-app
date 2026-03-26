/**
 * InputForm
 * Assumption entry form organized into six visible sections.
 * Human-in-the-loop: confirm button is the only trigger for processing.
 */

import { useState, useEffect } from 'react';
import ValidationBanner from './ValidationBanner.jsx';
import { formatDollar } from '../utils/formatUtils.js';
import {
  defaultChargesForm,
  emptyChargeForm,
  generateChargeKey,
  CANONICAL_TYPES,
} from '../engine/chargeTypes.js';

function SectionBox({ title, hint, children, actions }) {
  return (
    <div className="surface-panel overflow-hidden">
      <div className="border-b border-app-border bg-app-panel-strong px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="section-kicker">Assumptions</p>
            <h4 className="mt-1 font-display text-base font-semibold text-txt-primary">{title}</h4>
          </div>
          <div className="flex items-center gap-3">
            {hint && <span className="cursor-help text-xs text-txt-dim" title={hint}>i</span>}
            {actions}
          </div>
        </div>
      </div>
      <div className="bg-app-panel px-5 py-5">{children}</div>
    </div>
  );
}

function FieldRow({ label, hint, error, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold uppercase tracking-[0.16em] text-txt-dim">
        {label}
        {hint && <span className="ml-1 cursor-help text-txt-faint" title={hint}>i</span>}
      </label>
      {children}
      {error && <p className="text-xs text-status-err-text">{error}</p>}
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
      className={`field-dark ${error ? 'border-status-err-border bg-status-err-bg/70' : ''} ${className}`}
    />
  );
}

function SelectInput({ value, onChange, children, className = '' }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`field-dark ${className}`}
    >
      {children}
    </select>
  );
}

function ConfidenceFlag({ flagged }) {
  if (!flagged) return null;
  return (
    <span className="ml-2 inline-flex items-center rounded-full border border-status-warn-border bg-status-warn-bg px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-status-warn-title">
      Review
    </span>
  );
}

function DisplayField({ value, placeholder }) {
  return (
    <div className="surface-flat min-h-[44px] px-3 py-2 text-sm text-txt-primary">
      {value || <span className="text-xs italic text-txt-dim">{placeholder ?? 'Not available'}</span>}
    </div>
  );
}

function ColumnHeader({ children, className = '' }) {
  return (
    <span className={`text-xs font-semibold uppercase tracking-[0.16em] text-txt-dim ${className}`}>
      {children}
    </span>
  );
}

function fmtISO(isoStr) {
  if (!isoStr) return '';
  const match = String(isoStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return isoStr;
  return `${match[2]}/${match[3]}/${match[1]}`;
}

export function emptyNNN() {
  return { year1: '', escPct: '', chargeStart: '', escStart: '' };
}

export function emptyFormState() {
  return {
    leaseName: '',
    squareFootage: '',
    rentCommencementDate: '',
    effectiveAnalysisDate: '',
    abatementEndDate: '',
    abatementMonths: '',
    abatementPct: '',
    freeRentMonths: '',
    freeRentEndDate: '',
    nnnMode: 'individual',
    nnnAggregate: { year1: '', escPct: '' },
    charges: defaultChargesForm(),
    oneTimeItems: [],
  };
}

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
  onDraftChange,
  isProcessing,
}) {
  const [form, setForm] = useState(() => ({
    ...emptyFormState(),
    ...initialValues,
  }));

  useEffect(() => {
    onDraftChange?.(form);
  }, [form, onDraftChange]);

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
      const existingKeys = charges.map((charge) => charge.key);
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

  function handleAbatementMonths(value) {
    setTop('abatementMonths', value);
    const count = parseInt(value, 10);
    if (leaseStartDate && !isNaN(count) && count > 0) {
      const parts = leaseStartDate.split('-').map(Number);
      const endDate = new Date(parts[0], parts[1] - 1 + count, 0);
      const mm = String(endDate.getMonth() + 1).padStart(2, '0');
      const dd = String(endDate.getDate()).padStart(2, '0');
      setTop('abatementEndDate', `${mm}/${dd}/${endDate.getFullYear()}`);
    } else if (!value || value === '0') {
      setTop('abatementEndDate', '');
    }
  }

  function handleFreeRentMonths(value) {
    setTop('freeRentMonths', value);
    const count = parseInt(value, 10);
    if (leaseStartDate && !isNaN(count) && count > 0) {
      const parts = leaseStartDate.split('-').map(Number);
      const endDate = new Date(parts[0], parts[1] - 1 + count, 0);
      const mm = String(endDate.getMonth() + 1).padStart(2, '0');
      const dd = String(endDate.getDate()).padStart(2, '0');
      setTop('freeRentEndDate', `${mm}/${dd}/${endDate.getFullYear()}`);
    } else if (!value || value === '0') {
      setTop('freeRentEndDate', '');
    }
  }

  const fieldErrors = {};
  for (const err of validationErrors ?? []) {
    fieldErrors[err.field] = err.message;
  }

  const defaultKeys = new Set(['cams', 'insurance', 'taxes', 'security', 'otherItems']);
  const charges = form.charges ?? defaultChargesForm();
  const flag = (field) => confidenceFlags?.includes(field);

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(form);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-kicker">Review Inputs</p>
          <h2 className="mt-2 text-2xl font-semibold text-txt-primary">Lease Assumptions</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {onBackToSchedule && (
            <button type="button" onClick={onBackToSchedule} className="btn-ghost !px-4 !py-2">
              Edit schedule
            </button>
          )}
          <button type="button" onClick={onBack} className="btn-secondary !px-4 !py-2">
            Start over
          </button>
        </div>
      </div>

      {expandedRowCount > 0 && (
        <div className="surface-flat px-4 py-3 text-sm text-txt-muted">
          Rent schedule loaded: <strong className="text-txt-primary">{expandedRowCount}</strong> monthly row{expandedRowCount !== 1 ? 's' : ''}
          {leaseStartDate && <span className="ml-1">starting {fmtISO(leaseStartDate)}</span>}
        </div>
      )}

      {notices?.length > 0 && (
        <div className="rounded-[1.1rem] border border-status-warn-border bg-status-warn-bg/92 p-4 space-y-1">
          {notices.map((notice, i) => (
            <p key={i} className="text-sm text-status-warn-text">{notice}</p>
          ))}
        </div>
      )}

      <ValidationBanner errors={validationErrors ?? []} />

      <form onSubmit={handleSubmit} className="space-y-5">
        <SectionBox title="Lease Drivers">
          <div className="grid gap-3 md:grid-cols-2">
            <FieldRow label={<>Lease Name <ConfidenceFlag flagged={flag('leaseName')} /></>}>
              <TextInput
                value={form.leaseName}
                onChange={(value) => setTop('leaseName', value)}
                placeholder="e.g. Anita's Mexican Foods"
              />
            </FieldRow>

            <FieldRow
              label={
                <>
                  Rentable SF
                  {sfRequired && <span className="ml-2 text-status-err-text normal-case tracking-normal">(required)</span>}
                  <ConfidenceFlag flagged={flag('squareFootage')} />
                </>
              }
              error={fieldErrors['squareFootage']}
            >
              <TextInput
                type="number"
                value={form.squareFootage}
                onChange={(value) => setTop('squareFootage', value)}
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
              hint="If rent obligations begin on a date different from lease commencement, enter it here."
            >
              <TextInput
                value={form.rentCommencementDate}
                onChange={(value) => setTop('rentCommencementDate', value)}
                placeholder="MM/DD/YYYY (optional)"
              />
            </FieldRow>

            <FieldRow
              label="Effective Date of Analysis"
              hint="As-of date used to compute remaining obligations in the summary panel."
            >
              <TextInput
                value={form.effectiveAnalysisDate}
                onChange={(value) => setTop('effectiveAnalysisDate', value)}
                placeholder="MM/DD/YYYY (optional)"
              />
            </FieldRow>
          </div>
        </SectionBox>

        <SectionBox
          title="Monthly Rent Breakdown"
          hint="Year 1 monthly amounts for base rent and each recurring charge."
          actions={(
            <div className="segmented-control">
              <button
                type="button"
                onClick={() => setTop('nnnMode', 'individual')}
                className={`segmented-option ${form.nnnMode === 'individual' ? 'segmented-option-active' : ''}`}
              >
                Individual
              </button>
              <button
                type="button"
                onClick={() => setTop('nnnMode', 'aggregate')}
                className={`segmented-option ${form.nnnMode === 'aggregate' ? 'segmented-option-active' : ''}`}
              >
                Aggregate
              </button>
            </div>
          )}
        >
          {form.nnnMode === 'aggregate' && (
            <div className="mb-4 rounded-[1rem] border border-status-warn-border bg-status-warn-bg/90 p-3 text-xs text-status-warn-text">
              Aggregate NNN mode: a single combined NNN estimate replaces individual CAMS, Insurance, and Taxes line items.
            </div>
          )}

          <div className="mb-2 grid grid-cols-[1fr_80px_140px_28px] gap-x-2">
            <ColumnHeader>Charge</ColumnHeader>
            <ColumnHeader>Type</ColumnHeader>
            <ColumnHeader>Year 1 Monthly ($)</ColumnHeader>
            <span />
          </div>

          {scheduledBaseRent != null && (
            <div className="grid grid-cols-[1fr_80px_140px_28px] items-center gap-x-2 border-b border-app-border py-2">
              <span className="text-sm font-medium text-txt-primary">Base Rent</span>
              <span className="text-xs italic text-txt-dim">-</span>
              <div className="surface-flat px-3 py-2 text-sm font-mono text-txt-muted">
                {formatDollar(scheduledBaseRent)}
              </div>
              <span />
            </div>
          )}

          {form.nnnMode === 'aggregate' && (
            <div className="grid grid-cols-[1fr_80px_140px_28px] items-center gap-x-2 border-b border-app-border py-2">
              <span className="text-sm font-medium text-txt-primary">
                NNN - Aggregate Estimate
                <ConfidenceFlag flagged={flag('nnnAggregate.year1')} />
              </span>
              <span className="status-chip w-fit border-accent/30 bg-accent/10 text-accent-soft">NNN</span>
              <TextInput
                type="number"
                value={form.nnnAggregate?.year1 ?? ''}
                onChange={(value) => setNNNAggregate('year1', value)}
                placeholder="0.00"
                error={fieldErrors['nnnAggregate.year1']}
              />
              <span />
            </div>
          )}

          {charges.map((charge, idx) => {
            if (form.nnnMode === 'aggregate' && charge.canonicalType === CANONICAL_TYPES.NNN) return null;
            const isCustom = !defaultKeys.has(charge.key);
            return (
              <div key={charge.key} className="grid grid-cols-[1fr_80px_140px_28px] items-center gap-x-2 border-b border-app-border py-2 last:border-0">
                <TextInput
                  value={charge.displayLabel}
                  onChange={(value) => updateCharge(idx, 'displayLabel', value)}
                  placeholder="Charge name"
                />
                <SelectInput
                  value={charge.canonicalType}
                  onChange={(value) => updateCharge(idx, 'canonicalType', value)}
                  className="!px-2 !py-2 !text-xs"
                >
                  <option value={CANONICAL_TYPES.NNN}>NNN</option>
                  <option value={CANONICAL_TYPES.OTHER}>Other</option>
                </SelectInput>
                <TextInput
                  type="number"
                  value={charge.year1}
                  onChange={(value) => updateCharge(idx, 'year1', value)}
                  placeholder="0"
                  error={fieldErrors[`charges.${idx}.year1`]}
                />
                {isCustom ? (
                  <button
                    type="button"
                    onClick={() => removeCharge(idx)}
                    className="text-sm font-medium leading-none text-status-err-text hover:text-status-err-title"
                    title="Remove charge"
                  >
                    x
                  </button>
                ) : (
                  <span />
                )}
              </div>
            );
          })}

          <button type="button" onClick={addCharge} className="btn-link mt-4">
            + Add recurring charge
          </button>
        </SectionBox>

        <SectionBox
          title="Escalation Assumptions"
          hint="Annual escalation rates and optional start dates for each recurring charge."
        >
          <div className="mb-2 grid grid-cols-[1fr_110px_160px_160px] gap-x-2">
            <ColumnHeader>Charge</ColumnHeader>
            <ColumnHeader>Annual Rate (%)</ColumnHeader>
            <ColumnHeader>Escalation Start</ColumnHeader>
            <ColumnHeader>Billing Start</ColumnHeader>
          </div>

          {form.nnnMode === 'aggregate' && (
            <div className="grid grid-cols-[1fr_110px_160px_160px] items-center gap-x-2 border-b border-app-border py-2">
              <span className="text-sm text-txt-primary">NNN - Aggregate</span>
              <TextInput
                type="number"
                value={form.nnnAggregate?.escPct ?? ''}
                onChange={(value) => setNNNAggregate('escPct', value)}
                placeholder="0"
                error={fieldErrors['nnnAggregate.escPct']}
              />
              <span className="py-2 text-xs text-txt-dim">-</span>
              <span className="py-2 text-xs text-txt-dim">-</span>
            </div>
          )}

          {charges.map((charge, idx) => {
            if (form.nnnMode === 'aggregate' && charge.canonicalType === CANONICAL_TYPES.NNN) return null;
            return (
              <div key={charge.key} className="grid grid-cols-[1fr_110px_160px_160px] items-center gap-x-2 border-b border-app-border py-2 last:border-0">
                <span className="truncate text-sm text-txt-primary">
                  {charge.displayLabel || charge.key}
                  <ConfidenceFlag flagged={flag(`${charge.key}.escPct`) || flag(`charges.${idx}.escPct`)} />
                </span>
                <TextInput
                  type="number"
                  value={charge.escPct}
                  onChange={(value) => updateCharge(idx, 'escPct', value)}
                  placeholder="0"
                  error={fieldErrors[`charges.${idx}.escPct`]}
                />
                <TextInput
                  value={charge.escStart}
                  onChange={(value) => updateCharge(idx, 'escStart', value)}
                  placeholder="MM/DD/YYYY"
                  error={fieldErrors[`charges.${idx}.escStart`]}
                />
                <TextInput
                  value={charge.chargeStart}
                  onChange={(value) => updateCharge(idx, 'chargeStart', value)}
                  placeholder="MM/DD/YYYY"
                  error={fieldErrors[`charges.${idx}.chargeStart`]}
                />
              </div>
            );
          })}

          <p className="mt-3 text-xs text-txt-dim">
            Leave Escalation Start and Billing Start blank to anchor from lease commencement.
          </p>
        </SectionBox>

        <SectionBox
          title="Abatement"
          hint="Partial or full rent reduction for a specified period. Percentage applies to base rent."
        >
          <div className="grid gap-3 md:grid-cols-3">
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
              hint="Last day of abatement (inclusive). Auto-filled from months or enter directly."
              error={fieldErrors['abatementEndDate']}
            >
              <TextInput
                value={form.abatementEndDate}
                onChange={(value) => {
                  setTop('abatementEndDate', value);
                  if (form.abatementMonths) setTop('abatementMonths', '');
                }}
                placeholder="MM/DD/YYYY"
                error={fieldErrors['abatementEndDate']}
              />
            </FieldRow>

            <FieldRow
              label="Abatement Percentage (%)"
              hint="100 = full abatement, 50 = half, 0 = none."
              error={fieldErrors['abatementPct']}
            >
              <TextInput
                type="number"
                value={form.abatementPct}
                onChange={(value) => setTop('abatementPct', value)}
                placeholder="e.g. 100"
                error={fieldErrors['abatementPct']}
              />
            </FieldRow>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-txt-dim">Quick set</span>
            {[
              { label: 'Full (100%)', value: '100' },
              { label: 'Half (50%)', value: '50' },
              { label: 'None (0%)', value: '0' },
            ].map(({ label, value }) => (
              <button
                key={value}
                type="button"
                onClick={() => setTop('abatementPct', value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  form.abatementPct === value
                    ? 'border-accent bg-accent text-accent-fg shadow-accent'
                    : 'border-app-border-strong bg-app-panel-strong text-txt-muted hover:bg-app-panel-hover'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </SectionBox>

        <SectionBox
          title="Free Rent"
          hint="If both Free Rent and Abatement are filled, Free Rent takes precedence."
        >
          <div className="grid gap-3 md:grid-cols-2">
            <FieldRow
              label="# Months of Free Rent"
              hint="Tenant pays zero base rent for this many months from lease commencement."
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
              hint="Last day of the free rent period (inclusive)."
            >
              <TextInput
                value={form.freeRentEndDate}
                onChange={(value) => {
                  setTop('freeRentEndDate', value);
                  if (form.freeRentMonths) setTop('freeRentMonths', '');
                }}
                placeholder="MM/DD/YYYY"
              />
            </FieldRow>
          </div>
          <p className="mt-3 text-xs text-txt-dim">
            Free rent is applied as 100% abatement for the specified period. Use Abatement for partial rent reductions.
          </p>
        </SectionBox>

        <SectionBox
          title="Non-Recurring Charges"
          hint="One-time charges assigned to a specific month."
          actions={(
            <button
              type="button"
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  oneTimeItems: [...(prev.oneTimeItems ?? []), { label: '', date: '', amount: '' }],
                }))
              }
              className="btn-link"
            >
              + Add item
            </button>
          )}
        >
          {(form.oneTimeItems ?? []).length === 0 ? (
            <p className="text-xs text-txt-dim">
              No non-recurring charges. Click "+ Add item" to add key money, deposits, or other one-time items.
            </p>
          ) : (
            <>
              <div className="mb-2 grid grid-cols-[1fr_150px_130px_28px] gap-x-2">
                <ColumnHeader>Label</ColumnHeader>
                <ColumnHeader>Date</ColumnHeader>
                <ColumnHeader>Amount ($)</ColumnHeader>
                <span />
              </div>
              {(form.oneTimeItems ?? []).map((item, idx) => (
                <div key={idx} className="mb-2 grid grid-cols-[1fr_150px_130px_28px] items-center gap-x-2">
                  <TextInput
                    value={item.label}
                    onChange={(value) =>
                      setForm((prev) => {
                        const items = [...prev.oneTimeItems];
                        items[idx] = { ...items[idx], label: value };
                        return { ...prev, oneTimeItems: items };
                      })
                    }
                    placeholder="e.g. Key Money"
                  />
                  <TextInput
                    value={item.date}
                    onChange={(value) =>
                      setForm((prev) => {
                        const items = [...prev.oneTimeItems];
                        items[idx] = { ...items[idx], date: value };
                        return { ...prev, oneTimeItems: items };
                      })
                    }
                    placeholder="MM/DD/YYYY"
                  />
                  <TextInput
                    type="number"
                    value={item.amount}
                    onChange={(value) =>
                      setForm((prev) => {
                        const items = [...prev.oneTimeItems];
                        items[idx] = { ...items[idx], amount: value };
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
                    className="text-sm font-medium leading-none text-status-err-text hover:text-status-err-title"
                    title="Remove"
                  >
                    x
                  </button>
                </div>
              ))}
            </>
          )}
        </SectionBox>

        <div className="pt-2">
          <button
            type="submit"
            disabled={isProcessing}
            className="btn-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isProcessing ? 'Processing...' : 'Confirm & Process Schedule'}
          </button>
          <p className="mt-3 text-center text-xs text-txt-dim">
            Processing will not begin until you click the button above. Review all fields before confirming.
          </p>
        </div>
      </form>
    </div>
  );
}
