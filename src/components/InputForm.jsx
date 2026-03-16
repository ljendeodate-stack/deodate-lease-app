/**
 * InputForm
 * Shared parameter form for both input paths (Section 2).
 * Flaw 4 fix: abatement percentage tooltip confirms convention (100 = full, 0 = none).
 * Flaw 6 fix: each NNN charge date field is labelled with its category name.
 * Human-in-the-loop: confirm button is the only trigger for processing.
 */

import { useState, useEffect } from 'react';
import ValidationBanner from './ValidationBanner.jsx';
import { formatDollar } from '../utils/formatUtils.js';
import { NNN_BUCKET_KEYS, EXPENSE_CATEGORY_DEFS } from '../engine/labelClassifier.js';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FieldRow({ label, hint, error, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700">
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
      ⚠ Low confidence — verify
    </span>
  );
}

function NNNSection({ label, prefix, values, onChange, confidenceFlags = [], fieldErrors = {}, defaultExpanded }) {
  const flag = (field) => confidenceFlags.includes(`${prefix}.${field}`);
  const err = (field) => fieldErrors[`${prefix}.${field}`];
  const hasAnyFlag = ['year1', 'escPct', 'chargeStart', 'escStart'].some((f) => flag(f));

  const [expanded, setExpanded] = useState(() => {
    if (defaultExpanded !== undefined) return defaultExpanded;
    return hasAnyFlag || !values?.year1;
  });

  const year1Display = values?.year1 ? formatDollar(Number(values.year1)) : null;

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold text-gray-800 text-sm">{label}</span>
          {!expanded && year1Display && (
            <span className="text-sm text-gray-500 font-mono">{year1Display}/mo</span>
          )}
          {hasAnyFlag && <ConfidenceFlag flagged={true} />}
        </div>
        <span className="text-gray-400 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-3 space-y-3 border-t border-gray-100">
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label={<>Year 1 Monthly ($) <ConfidenceFlag flagged={flag('year1')} /></>} error={err('year1')}>
              <TextInput
                type="number"
                value={values.year1}
                onChange={(v) => onChange(prefix, 'year1', v)}
                placeholder="e.g. 500"
                error={err('year1')}
              />
            </FieldRow>
            <FieldRow label={<>Annual Escalation (%) <ConfidenceFlag flagged={flag('escPct')} /></>} error={err('escPct')}>
              <TextInput
                type="number"
                value={values.escPct}
                onChange={(v) => onChange(prefix, 'escPct', v)}
                placeholder="e.g. 3"
                error={err('escPct')}
              />
            </FieldRow>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FieldRow
              label={<>{label} Billing Start Date <ConfidenceFlag flagged={flag('chargeStart')} /></>}
              hint="Leave blank if billing begins at lease commencement."
              error={err('chargeStart')}
            >
              <TextInput
                value={values.chargeStart}
                onChange={(v) => onChange(prefix, 'chargeStart', v)}
                placeholder="MM/DD/YYYY (optional)"
                error={err('chargeStart')}
              />
            </FieldRow>
            <FieldRow
              label={<>{label} Escalation Start Date <ConfidenceFlag flagged={flag('escStart')} /></>}
              hint="Leave blank if escalation begins at lease commencement."
              error={err('escStart')}
            >
              <TextInput
                value={values.escStart}
                onChange={(v) => onChange(prefix, 'escStart', v)}
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

function OneTimeChargesSection({ charges, onChange }) {
  const [expanded, setExpanded] = useState(() => charges.length > 0);

  function addCharge() {
    onChange([...charges, { name: '', amount: '', date: '' }]);
    setExpanded(true);
  }

  function removeCharge(idx) {
    onChange(charges.filter((_, i) => i !== idx));
  }

  function updateCharge(idx, field, value) {
    const updated = charges.map((c, i) => (i === idx ? { ...c, [field]: value } : c));
    onChange(updated);
  }

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold text-gray-800 text-sm">One-Time Charges</span>
          {charges.length > 0 && (
            <span className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
              {charges.length} charge{charges.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <span className="text-gray-400 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-3 border-t border-gray-100 space-y-3">
          {charges.length === 0 ? (
            <p className="text-xs text-gray-400">No one-time charges. Click "+ Add Charge" to add a fee that applies in a single month.</p>
          ) : (
            <div className="space-y-3">
              {charges.map((charge, idx) => (
                <div key={idx} className="rounded-md border border-gray-200 bg-gray-50 p-3">
                  <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                    <FieldRow label="Charge Name">
                      <TextInput
                        value={charge.name}
                        onChange={(v) => updateCharge(idx, 'name', v)}
                        placeholder="e.g. Security Deposit"
                      />
                    </FieldRow>
                    <FieldRow label="Amount ($)">
                      <TextInput
                        type="number"
                        value={charge.amount}
                        onChange={(v) => updateCharge(idx, 'amount', v)}
                        placeholder="e.g. 5000"
                      />
                    </FieldRow>
                    <FieldRow label="Month (MM/DD/YYYY)">
                      <TextInput
                        value={charge.date}
                        onChange={(v) => updateCharge(idx, 'date', v)}
                        placeholder="MM/DD/YYYY"
                      />
                    </FieldRow>
                    <button
                      type="button"
                      onClick={() => removeCharge(idx)}
                      className="mb-0.5 rounded-md bg-red-50 border border-red-300 text-red-600 px-2 py-1.5 text-xs font-semibold hover:bg-red-100 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              {/* Net cash effect summary */}
              {(() => {
                const netTotal = charges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
                return (
                  <div className={`flex items-center justify-end gap-2 pt-2 border-t border-gray-200 text-sm font-semibold ${netTotal >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                    <span className="text-gray-600 font-medium">Net Cash Effect:</span>
                    <span>{netTotal >= 0 ? '+' : ''}{formatDollar(netTotal)}</span>
                    <span className="text-xs font-normal text-gray-500">
                      {netTotal > 0 ? '(tenant outflow)' : netTotal < 0 ? '(landlord credit)' : '(net zero)'}
                    </span>
                  </div>
                );
              })()}
            </div>
          )}
          <button
            type="button"
            onClick={addCharge}
            className="rounded-md bg-blue-50 border border-blue-300 text-blue-700 px-3 py-1.5 text-xs font-semibold hover:bg-blue-100 transition-colors"
          >
            + Add Charge
          </button>
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
    abatementPct: '',
    nnnMode: 'individual',
    nnnAggregate: { year1: '', escPct: '' },
    cams: emptyNNN(),
    insurance: emptyNNN(),
    taxes: emptyNNN(),
    security: emptyNNN(),
    otherItems: emptyNNN(),
    oneTimeCharges: [],
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function InputForm({
  initialValues,       // pre-populated from OCR (optional)
  confidenceFlags,     // string[] — field paths flagged by OCR
  notices,             // string[] — OCR notices
  validationErrors,    // ValidationError[]
  sfRequired,          // boolean — $/SF conversion needed
  onSubmit,            // (params) => void
  onBack,              // () => void
  isProcessing,
}) {
  const [form, setForm] = useState(() => ({
    ...emptyFormState(),
    ...initialValues,
  }));

  // Sync if parent updates initialValues (e.g. after OCR completes)
  useEffect(() => {
    if (initialValues) {
      setForm((prev) => ({ ...prev, ...initialValues }));
    }
  }, [initialValues]);

  function setTop(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function setNNN(prefix, field, value) {
    setForm((prev) => ({
      ...prev,
      [prefix]: { ...prev[prefix], [field]: value },
    }));
  }

  function setNNNAggregate(field, value) {
    setForm((prev) => ({
      ...prev,
      nnnAggregate: { ...prev.nnnAggregate, [field]: value },
    }));
  }

  function setOneTimeCharges(charges) {
    setForm((prev) => ({ ...prev, oneTimeCharges: charges }));
  }

  // Build a quick lookup: field → error message
  const fieldErrors = {};
  for (const err of validationErrors ?? []) {
    fieldErrors[err.field] = err.message;
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(form);
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Lease Parameters</h2>
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-gray-500 hover:text-gray-700 underline"
        >
          ← Back to upload
        </button>
      </div>

      {/* OCR notices */}
      {notices?.length > 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1">
          {notices.map((n, i) => (
            <p key={i} className="text-sm text-amber-800">⚠ {n}</p>
          ))}
        </div>
      )}

      {/* Validation errors */}
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
          <div className="grid grid-cols-2 gap-3">
            <FieldRow
              label={<>Abatement End Date <ConfidenceFlag flagged={confidenceFlags?.includes('abatementEndDate')} /></>}
              hint="Last day of the abatement period (inclusive). E.g. if the lease says 'until June 30', enter 06/30/YYYY."
              error={fieldErrors['abatementEndDate']}
            >
              <TextInput
                value={form.abatementEndDate}
                onChange={(v) => setTop('abatementEndDate', v)}
                placeholder="MM/DD/YYYY"
                error={fieldErrors['abatementEndDate']}
              />
            </FieldRow>
            <FieldRow
              label={
                <>
                  Abatement Percentage (%)
                  {/* Flaw 4 fix: explicit tooltip confirming convention */}
                  <span
                    className="ml-1 text-gray-400 cursor-help"
                    title="100 = full abatement (tenant pays $0). 50 = half abatement (tenant pays half rent). 0 = no abatement (full rent applies). This is applied as: tenant pays = rent × (1 − abatementPct÷100)."
                  >ⓘ</span>
                </>
              }
              error={fieldErrors['abatementPct']}
            >
              <TextInput
                type="number"
                value={form.abatementPct}
                onChange={(v) => setTop('abatementPct', v)}
                placeholder="e.g. 100 = full, 50 = half, 0 = none"
                error={fieldErrors['abatementPct']}
              />
            </FieldRow>
          </div>
          <p className="text-xs text-gray-500">
            <strong>Convention:</strong> 100 = full abatement (tenant pays nothing).
            50 = half abatement (tenant pays half). 0 = no abatement (full rent due).
          </p>
        </div>

        {/* NNN charges — aggregate or individual path */}
        {form.nnnMode === 'aggregate' ? (
          <>
            {/* Aggregate NNN warning */}
            <div className="rounded-md bg-amber-50 border border-amber-300 p-3 space-y-1">
              <p className="text-sm font-semibold text-amber-800">
                ⚠ Aggregate NNN Estimate — No Line-Item Breakdown Available
              </p>
              <p className="text-sm text-amber-700">
                The lease states a combined operating expense estimate without separate CAMS, Insurance, and Taxes figures.
                The schedule will show a single "NNN — Aggregate Estimate" column. Individual category columns will not be allocated.
              </p>
            </div>

            {/* Single aggregate NNN section */}
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

            {/* Security and Other Items still shown individually */}
            {['security', 'otherItems'].map((prefix) => {
              const label = EXPENSE_CATEGORY_DEFS[prefix].displayLabel;
              return { prefix, label };
            }).map(({ prefix, label }) => {
              const hasFlag = ['year1', 'escPct', 'chargeStart', 'escStart'].some(
                (f) => confidenceFlags?.includes(`${prefix}.${f}`)
              );
              return (
                <NNNSection
                  key={prefix}
                  label={label}
                  prefix={prefix}
                  values={form[prefix]}
                  onChange={setNNN}
                  confidenceFlags={confidenceFlags}
                  fieldErrors={fieldErrors}
                  defaultExpanded={hasFlag || !form[prefix]?.year1}
                />
              );
            })}
          </>
        ) : (
          /* Individual NNN mode — labels sourced from EXPENSE_CATEGORY_DEFS */
          NNN_BUCKET_KEYS.map((prefix) => {
            const label = EXPENSE_CATEGORY_DEFS[prefix].displayLabel;
            return { prefix, label };
          }).map(({ prefix, label }) => {
            const hasFlag = ['year1', 'escPct', 'chargeStart', 'escStart'].some(
              (f) => confidenceFlags?.includes(`${prefix}.${f}`)
            );
            return (
              <NNNSection
                key={prefix}
                label={label}
                prefix={prefix}
                values={form[prefix]}
                onChange={setNNN}
                confidenceFlags={confidenceFlags}
                fieldErrors={fieldErrors}
                defaultExpanded={hasFlag || !form[prefix]?.year1}
              />
            );
          })
        )}

        {/* One-Time Charges */}
        <OneTimeChargesSection
          charges={form.oneTimeCharges ?? []}
          onChange={setOneTimeCharges}
        />

        {/* Submit */}
        <div className="flex items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={isProcessing}
            className="flex-1 rounded-md bg-blue-600 text-white py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isProcessing ? 'Processing…' : 'Confirm & Process Schedule'}
          </button>
        </div>
        <p className="text-xs text-gray-400 text-center">
          Processing will not begin until you click the button above. Review all fields before confirming.
        </p>
      </form>
    </div>
  );
}
