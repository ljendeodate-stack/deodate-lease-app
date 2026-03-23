/**
 * InputForm
 * Shared parameter form for both input paths.
 * Dynamic charge model: form.charges[] replaces named fields.
 * Human-in-the-loop: confirm button is the only trigger for processing.
 */

import { useState, useEffect } from 'react';
import ValidationBanner from './ValidationBanner.jsx';
import { formatDollar } from '../utils/formatUtils.js';
import { defaultChargesForm, emptyChargeForm, generateChargeKey, CANONICAL_TYPES } from '../engine/chargeTypes.js';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FieldRow({ label, hint, error, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700">
        {label}
        {hint && (
          <span className="ml-1 text-gray-400 cursor-help" title={hint}>i</span>
        )}
      </label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = 'text', error }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
        error ? 'border-red-400 bg-red-50' : 'border-gray-300'
      }`}
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

function ChargeSection({ charge, index, onChange, onRemove, confidenceFlags = [], fieldErrors = {}, defaultExpanded, isCustom }) {
  const prefix = `charges.${index}`;
  const flag = (field) => confidenceFlags.includes(`${charge.key}.${field}`) || confidenceFlags.includes(`${prefix}.${field}`);
  const err = (field) => fieldErrors[`${prefix}.${field}`] || fieldErrors[`${charge.key}.${field}`];
  const hasAnyFlag = ['year1', 'escPct', 'chargeStart', 'escStart'].some((f) => flag(f));

  const [expanded, setExpanded] = useState(() => {
    if (defaultExpanded !== undefined) return defaultExpanded;
    return hasAnyFlag || !charge?.year1;
  });

  const year1Display = charge?.year1 ? formatDollar(Number(charge.year1)) : null;
  const typeLabel = charge.canonicalType === CANONICAL_TYPES.NNN ? 'NNN' : 'Other';

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold text-gray-800 text-sm">{charge.displayLabel}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
            charge.canonicalType === CANONICAL_TYPES.NNN
              ? 'bg-pink-100 text-pink-700'
              : 'bg-gray-100 text-gray-600'
          }`}>{typeLabel}</span>
          {!expanded && year1Display && (
            <span className="text-sm text-gray-500 font-mono">{year1Display}/mo</span>
          )}
          {hasAnyFlag && <ConfidenceFlag flagged={true} />}
        </div>
        <div className="flex items-center gap-2">
          {isCustom && (
            <span
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="text-xs text-red-500 hover:text-red-700 cursor-pointer px-1"
              title="Remove charge"
            >remove</span>
          )}
          <span className="text-gray-400 text-xs">{expanded ? String.fromCharCode(9650) : String.fromCharCode(9660)}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-3 space-y-3 border-t border-gray-100">
          {/* Label and type editing */}
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Display Label">
              <TextInput
                value={charge.displayLabel}
                onChange={(v) => onChange(index, 'displayLabel', v)}
                placeholder="e.g. CAMS"
              />
            </FieldRow>
            <FieldRow label="Routing" hint="NNN charges contribute to Total NNN. Other charges go to Other Charges bucket.">
              <select
                value={charge.canonicalType}
                onChange={(e) => onChange(index, 'canonicalType', e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value={CANONICAL_TYPES.NNN}>NNN (Total NNN)</option>
                <option value={CANONICAL_TYPES.OTHER}>Other (Other Charges)</option>
              </select>
            </FieldRow>
          </div>

          {/* Amount and escalation */}
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label={<>Year 1 Monthly ($) <ConfidenceFlag flagged={flag('year1')} /></>} error={err('year1')}>
              <TextInput
                type="number"
                value={charge.year1}
                onChange={(v) => onChange(index, 'year1', v)}
                placeholder="e.g. 500"
                error={err('year1')}
              />
            </FieldRow>
            <FieldRow label={<>Annual Escalation (%) <ConfidenceFlag flagged={flag('escPct')} /></>} error={err('escPct')}>
              <TextInput
                type="number"
                value={charge.escPct}
                onChange={(v) => onChange(index, 'escPct', v)}
                placeholder="e.g. 3"
                error={err('escPct')}
              />
            </FieldRow>
          </div>

          {/* Date fields */}
          <div className="grid grid-cols-2 gap-3">
            <FieldRow
              label={<>{charge.displayLabel} Billing Start Date <ConfidenceFlag flagged={flag('chargeStart')} /></>}
              hint="Leave blank if billing begins at lease commencement."
              error={err('chargeStart')}
            >
              <TextInput
                value={charge.chargeStart}
                onChange={(v) => onChange(index, 'chargeStart', v)}
                placeholder="MM/DD/YYYY (optional)"
                error={err('chargeStart')}
              />
            </FieldRow>
            <FieldRow
              label={<>{charge.displayLabel} Escalation Start Date <ConfidenceFlag flagged={flag('escStart')} /></>}
              hint="Leave blank if escalation begins at lease commencement."
              error={err('escStart')}
            >
              <TextInput
                value={charge.escStart}
                onChange={(v) => onChange(index, 'escStart', v)}
                placeholder="MM/DD/YYYY (optional)"
                error={err('escStart')}
              />
            </FieldRow>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Default empty form state
// ---------------------------------------------------------------------------

export function emptyNNN() {
  return { year1: '', escPct: '', chargeStart: '', escStart: '' };
}

export function emptyFormState() {
  return {
    leaseName: '',
    squareFootage: '',
    abatementEndDate: '',
    abatementMonths: '',
    abatementPct: '',
    nnnMode: 'individual',
    nnnAggregate: { year1: '', escPct: '' },
    charges: defaultChargesForm(),
    oneTimeItems: [],
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

  const fieldErrors = {};
  for (const err of validationErrors ?? []) {
    fieldErrors[err.field] = err.message;
  }

  // The default 5 charge keys that cannot be removed
  const defaultKeys = new Set(['cams', 'insurance', 'taxes', 'security', 'otherItems']);

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(form);
  }

  const charges = form.charges ?? defaultChargesForm();
  const nnnCharges = charges.filter((ch) => ch.canonicalType === CANONICAL_TYPES.NNN);
  const otherCharges = charges.filter((ch) => ch.canonicalType === CANONICAL_TYPES.OTHER);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Lease Parameters</h2>
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
          {leaseStartDate && <span className="ml-1">starting {leaseStartDate}</span>}
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

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Lease Name */}
        <FieldRow
          label={<>Lease Name <ConfidenceFlag flagged={confidenceFlags?.includes('leaseName')} /></>}
          hint="Used as the title in the exported Excel workbook."
        >
          <TextInput
            value={form.leaseName}
            onChange={(v) => setTop('leaseName', v)}
            placeholder="e.g. Anita's Mexican Foods"
          />
        </FieldRow>

        {/* Square footage */}
        <FieldRow
          label={
            <>
              Square Footage {sfRequired && <span className="ml-1 text-red-600 font-semibold">(required for $/SF conversion)</span>}
              <ConfidenceFlag flagged={confidenceFlags?.includes('squareFootage')} />
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

        {/* Abatement */}
        <div className="rounded-lg border border-gray-200 p-4 space-y-3">
          <h4 className="font-semibold text-gray-800 text-sm">Rent Abatement (optional)</h4>

          <div className="grid grid-cols-3 gap-3">
            <FieldRow
              label="# Months of Abatement"
              hint="Number of months of abatement starting from lease commencement. Auto-computes the end date."
              error={fieldErrors['abatementMonths']}
            >
              <TextInput
                type="number"
                value={form.abatementMonths}
                onChange={(v) => {
                  setTop('abatementMonths', v);
                  const n = parseInt(v, 10);
                  if (leaseStartDate && !isNaN(n) && n > 0) {
                    const parts = leaseStartDate.split('-').map(Number);
                    const endDate = new Date(parts[0], parts[1] - 1 + n, 0);
                    const mm = String(endDate.getMonth() + 1).padStart(2, '0');
                    const dd = String(endDate.getDate()).padStart(2, '0');
                    const yyyy = endDate.getFullYear();
                    setTop('abatementEndDate', `${mm}/${dd}/${yyyy}`);
                  } else if (!v || v === '0') {
                    setTop('abatementEndDate', '');
                  }
                }}
                placeholder="e.g. 6"
                error={fieldErrors['abatementMonths']}
              />
            </FieldRow>
            <FieldRow
              label={<>Abatement End Date <ConfidenceFlag flagged={confidenceFlags?.includes('abatementEndDate')} /></>}
              hint="Last day of the abatement period (inclusive). Auto-filled when you enter months, or enter directly."
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
              label={
                <>
                  Abatement Percentage (%)
                  <span
                    className="ml-1 text-gray-400 cursor-help"
                    title="100 = full abatement (tenant pays $0). 50 = half abatement (tenant pays half rent). 0 = no abatement (full rent applies). This is applied as: tenant pays = rent x (1 - abatementPct/100)."
                  >i</span>
                </>
              }
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

          <div className="flex items-center gap-2">
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

          <p className="text-xs text-gray-500">
            <strong>Convention:</strong> 100 = full abatement (tenant pays nothing).
            50 = half abatement (tenant pays half). 0 = no abatement (full rent due).
            {leaseStartDate && form.abatementMonths && (
              <span className="ml-1 text-blue-600">
                Computed from lease start {leaseStartDate} + {form.abatementMonths} month{form.abatementMonths !== '1' ? 's' : ''}.
              </span>
            )}
          </p>
        </div>

        {/* NNN charges — aggregate or individual + dynamic charge sections */}
        {form.nnnMode === 'aggregate' ? (
          <>
            <div className="rounded-md bg-amber-50 border border-amber-300 p-3 space-y-1">
              <p className="text-sm font-semibold text-amber-800">
                Aggregate NNN Estimate — No Line-Item Breakdown Available
              </p>
              <p className="text-sm text-amber-700">
                The lease states a combined operating expense estimate without separate CAMS, Insurance, and Taxes figures.
                The schedule will show a single "NNN — Aggregate Estimate" column. Individual category columns will not be allocated.
              </p>
            </div>

            <div className="rounded-lg border border-amber-200 overflow-hidden">
              <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
                <span className="font-semibold text-gray-800 text-sm">
                  NNN — Aggregate Estimate
                  <ConfidenceFlag flagged={confidenceFlags?.includes('nnnAggregate.year1')} />
                </span>
              </div>
              <div className="px-4 pb-4 pt-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <FieldRow
                    label={<>Year 1 Monthly ($) <ConfidenceFlag flagged={confidenceFlags?.includes('nnnAggregate.year1')} /></>}
                    error={fieldErrors['nnnAggregate.year1']}
                  >
                    <TextInput
                      type="number"
                      value={form.nnnAggregate?.year1 ?? ''}
                      onChange={(v) => setNNNAggregate('year1', v)}
                      placeholder="e.g. 24506.50"
                      error={fieldErrors['nnnAggregate.year1']}
                    />
                  </FieldRow>
                  <FieldRow
                    label={<>Annual Escalation (%) <ConfidenceFlag flagged={confidenceFlags?.includes('nnnAggregate.escPct')} /></>}
                    error={fieldErrors['nnnAggregate.escPct']}
                  >
                    <TextInput
                      type="number"
                      value={form.nnnAggregate?.escPct ?? ''}
                      onChange={(v) => setNNNAggregate('escPct', v)}
                      placeholder="e.g. 3"
                      error={fieldErrors['nnnAggregate.escPct']}
                    />
                  </FieldRow>
                </div>
              </div>
            </div>

            {/* In aggregate mode, show only non-NNN (Other) charges */}
            {charges.filter((ch) => ch.canonicalType !== CANONICAL_TYPES.NNN).map((ch, _, arr) => {
              const globalIdx = charges.indexOf(ch);
              return (
                <ChargeSection
                  key={ch.key}
                  charge={ch}
                  index={globalIdx}
                  onChange={updateCharge}
                  onRemove={() => removeCharge(globalIdx)}
                  confidenceFlags={confidenceFlags}
                  fieldErrors={fieldErrors}
                  defaultExpanded={!ch.year1}
                  isCustom={!defaultKeys.has(ch.key)}
                />
              );
            })}
          </>
        ) : (
          /* Individual mode — show all charges */
          <>
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-gray-800 text-sm">Charges</h4>
              <button
                type="button"
                onClick={addCharge}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                + Add charge
              </button>
            </div>
            {charges.map((ch, idx) => (
              <ChargeSection
                key={ch.key}
                charge={ch}
                index={idx}
                onChange={updateCharge}
                onRemove={() => removeCharge(idx)}
                confidenceFlags={confidenceFlags}
                fieldErrors={fieldErrors}
                defaultExpanded={!ch.year1}
                isCustom={!defaultKeys.has(ch.key)}
              />
            ))}
          </>
        )}

        {/* One-time items */}
        <div className="rounded-lg border border-gray-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-gray-800 text-sm">One-time Charges (optional)</h4>
            <button
              type="button"
              onClick={() => setForm((prev) => ({
                ...prev,
                oneTimeItems: [...(prev.oneTimeItems ?? []), { label: '', date: '', amount: '' }],
              }))}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              + Add item
            </button>
          </div>
          {(form.oneTimeItems ?? []).length === 0 && (
            <p className="text-xs text-gray-400">No one-time charges. Click "+ Add item" to add key money, deposits, etc.</p>
          )}
          {(form.oneTimeItems ?? []).map((item, idx) => (
            <div key={idx} className="grid grid-cols-3 gap-2 items-end">
              <FieldRow label="Label">
                <TextInput
                  value={item.label}
                  onChange={(v) => setForm((prev) => {
                    const items = [...prev.oneTimeItems];
                    items[idx] = { ...items[idx], label: v };
                    return { ...prev, oneTimeItems: items };
                  })}
                  placeholder="e.g. Key Money"
                />
              </FieldRow>
              <FieldRow label="Date" hint="Leave blank to assign to lease commencement.">
                <TextInput
                  value={item.date}
                  onChange={(v) => setForm((prev) => {
                    const items = [...prev.oneTimeItems];
                    items[idx] = { ...items[idx], date: v };
                    return { ...prev, oneTimeItems: items };
                  })}
                  placeholder="MM/DD/YYYY (optional)"
                />
              </FieldRow>
              <FieldRow label="Amount ($)">
                <div className="flex gap-1">
                  <TextInput
                    type="number"
                    value={item.amount}
                    onChange={(v) => setForm((prev) => {
                      const items = [...prev.oneTimeItems];
                      items[idx] = { ...items[idx], amount: v };
                      return { ...prev, oneTimeItems: items };
                    })}
                    placeholder="e.g. 5000"
                  />
                  <button
                    type="button"
                    onClick={() => setForm((prev) => ({
                      ...prev,
                      oneTimeItems: prev.oneTimeItems.filter((_, i) => i !== idx),
                    }))}
                    className="text-xs text-red-500 hover:text-red-700 px-2"
                    title="Remove"
                  >X</button>
                </div>
              </FieldRow>
            </div>
          ))}
        </div>

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
