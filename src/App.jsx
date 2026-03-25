/**
 * App.jsx
 * Root application component. Manages the step-by-step processing pipeline:
 *   upload → (ocr extraction?) → form → processing → results
 *
 * Human-in-the-loop: processing is never triggered automatically.
 * The user must explicitly confirm the form before calculator.js runs.
 *
 * Resilient pipeline: extraction/parsing failures never dead-end the user.
 * Low-confidence extractions auto-route to the manual schedule editor.
 */

import { useState, useCallback } from 'react';

import UploadRouter from './components/UploadRouter.jsx';
import ScheduleEditor from './components/ScheduleEditor.jsx';
import InputForm, { emptyFormState } from './components/InputForm.jsx';
import ValidationBanner from './components/ValidationBanner.jsx';
import LedgerTable from './components/LedgerTable.jsx';
import SummaryPanel from './components/SummaryPanel.jsx';
import ExportButton from './components/ExportButton.jsx';

import { parseFile } from './engine/parser.js';
import { defaultChargesForm } from './engine/chargeTypes.js';
import { expandPeriods } from './engine/expander.js';
import { calculateAllCharges } from './engine/calculator.js';
import { validateParams, validateSchedule } from './engine/validator.js';
import { extractFromPDF } from './ocr/extractor.js';
import { parseMDYStrict, parseExcelDate } from './engine/yearMonth.js';
import { classifyExpenseLabel, NNN_BUCKET_KEYS } from './engine/labelClassifier.js';
import { scoreExtraction, categorizeFields } from './engine/confidenceScorer.js';
import { checkSchedulePlausibility } from './engine/plausibility.js';

// ---------------------------------------------------------------------------
// Step constants
// ---------------------------------------------------------------------------
const STEP = {
  UPLOAD: 'upload',
  SCHEDULE: 'schedule',
  FORM: 'form',
  RESULTS: 'results',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getChargeFormByKey(form, key) {
  if (Array.isArray(form.charges) && form.charges.length > 0) {
    return form.charges.find((charge) => charge.key === key) ?? {};
  }
  return form[key] ?? {};
}

function mapChargeFormToParams(form, key) {
  const charge = getChargeFormByKey(form, key);
  return {
    year1: Number(charge.year1) || 0,
    escPct: Number(charge.escPct) || 0,
    escStart: parseMDYStrict(charge.escStart),
    chargeStart: parseMDYStrict(charge.chargeStart),
  };
}

function buildInitialCharges(result, nnnToForm) {
  return defaultChargesForm().map((charge) => {
    const initialValues = nnnToForm(result[charge.key]);
    return {
      ...charge,
      ...initialValues,
      displayLabel: initialValues.displayLabel || charge.displayLabel,
    };
  });
}

export function formToCalculatorParams(form) {
  // Free Rent takes precedence over Abatement when set.
  // Free rent is 100% abatement for the specified period.
  const hasFreeRent = Boolean(
    form.freeRentEndDate ||
    (form.freeRentMonths && Number(form.freeRentMonths) > 0)
  );

  return {
    leaseName: String(form.leaseName || '').trim(),
    nnnMode: form.nnnMode ?? 'individual',
    nnnAggregate: {
      year1: Number(form.nnnAggregate?.year1) || 0,
      escPct: Number(form.nnnAggregate?.escPct) || 0,
    },
    squareFootage: Number(form.squareFootage) || 0,
    // Lease Drivers metadata — preserved in params for export model / scenario use.
    rentCommencementDate:  parseMDYStrict(form.rentCommencementDate),
    effectiveAnalysisDate: parseMDYStrict(form.effectiveAnalysisDate),
    // Free rent overrides abatement when set (always 100% for the free rent period).
    abatementEndDate: hasFreeRent
      ? parseMDYStrict(form.freeRentEndDate)
      : parseMDYStrict(form.abatementEndDate),
    abatementPct: hasFreeRent ? 100 : (Number(form.abatementPct) || 0),
    // Preserve raw free-rent fields for export display (separate from resolved abatement).
    freeRentMonths: hasFreeRent ? (Number(form.freeRentMonths) || 0) : 0,
    freeRentEndDate: hasFreeRent ? parseMDYStrict(form.freeRentEndDate) : null,
    oneTimeItems: (form.oneTimeItems ?? [])
      .map((item) => ({
        label:  item.label ?? '',
        date:   parseMDYStrict(item.date),
        amount: Number(item.amount) || 0,
      }))
      .filter((item) => item.amount !== 0),
    // Normalized charges array — drives dynamic charge calculation in calculator.js.
    // Preserves all user-defined charges (including custom keys) with parsed dates.
    charges: (form.charges ?? []).map((c) => ({
      key:          c.key,
      canonicalType: c.canonicalType ?? 'other',
      displayLabel:  c.displayLabel ?? c.key,
      year1:        Number(c.year1) || 0,
      escPct:       Number(c.escPct) || 0,
      escStart:     parseMDYStrict(c.escStart),
      chargeStart:  parseMDYStrict(c.chargeStart),
    })),
    // Legacy charge params retained for backward compat (consumed when charges[] absent).
    cams: mapChargeFormToParams(form, 'cams'),
    insurance: mapChargeFormToParams(form, 'insurance'),
    taxes: mapChargeFormToParams(form, 'taxes'),
    security: mapChargeFormToParams(form, 'security'),
    otherItems: mapChargeFormToParams(form, 'otherItems'),
    oneTimeCharges: (form.oneTimeCharges ?? [])
      .map((c) => ({ name: String(c.name || '').trim(), amount: Number(c.amount) || 0, date: String(c.date || '').trim() }))
      .filter((c) => c.name),
  };
}

/**
 * Convert the rentSchedule array from the OCR result into canonical period rows.
 */
function ocrScheduleToPeriodRows(rentSchedule) {
  if (!Array.isArray(rentSchedule)) return [];
  return rentSchedule
    .map(({ periodStart, periodEnd, monthlyRent }) => ({
      periodStart: parseMDYStrict(periodStart) ?? parseExcelDate(periodStart),
      periodEnd:   parseMDYStrict(periodEnd)   ?? parseExcelDate(periodEnd),
      monthlyRent: Number(monthlyRent),
    }))
    .filter((r) => r.periodStart && r.periodEnd && !isNaN(r.monthlyRent));
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [step, setStep] = useState(STEP.UPLOAD);
  const [inputPath, setInputPath] = useState(null);
  const [fileName, setFileName] = useState('lease-schedule');
  const [menuOpen, setMenuOpen] = useState(false);

  // Schedule rows (from parser + expander)
  const [expandedRows, setExpandedRows] = useState([]);
  const [schedulePeriodRows, setSchedulePeriodRows] = useState([]);
  const [parseWarnings, setParseWarnings] = useState([]);
  const [duplicateDates, setDuplicateDates] = useState([]);
  const [dupConfirmed, setDupConfirmed] = useState(false);

  // Form state
  const [formInitialValues, setFormInitialValues] = useState(null);
  const [formDraftValues, setFormDraftValues] = useState(null);
  const [ocrConfidenceFlags, setOcrConfidenceFlags] = useState([]);
  const [ocrNotices, setOcrNotices] = useState([]);
  const [sfRequired, setSfRequired] = useState(false);

  // Confidence / plausibility
  const [confidenceResult, setConfidenceResult] = useState(null);
  const [fieldCategories, setFieldCategories] = useState(null);
  const [plausibilityIssues, setPlausibilityIssues] = useState([]);

  const [scheduleNotice, setScheduleNotice] = useState(null);

  // Processing state
  const [validationErrors, setValidationErrors] = useState([]);
  const [validationWarnings, setValidationWarnings] = useState([]);
  const [processedRows, setProcessedRows] = useState([]);
  const [processedParams, setProcessedParams] = useState({});
  const [labelClassifications, setLabelClassifications] = useState(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [globalError, setGlobalError] = useState(null);

  const resetWorkflow = useCallback(() => {
    setStep(STEP.UPLOAD);
    setInputPath(null);
    setFileName('lease-schedule');
    setMenuOpen(false);
    setExpandedRows([]);
    setSchedulePeriodRows([]);
    setParseWarnings([]);
    setDuplicateDates([]);
    setDupConfirmed(false);
    setFormInitialValues(null);
    setFormDraftValues(null);
    setOcrConfidenceFlags([]);
    setOcrNotices([]);
    setSfRequired(false);
    setConfidenceResult(null);
    setFieldCategories(null);
    setPlausibilityIssues([]);
    setScheduleNotice(null);
    setValidationErrors([]);
    setValidationWarnings([]);
    setProcessedRows([]);
    setProcessedParams({});
    setLabelClassifications(null);
    setIsExtracting(false);
    setIsProcessing(false);
    setGlobalError(null);
  }, []);

  const navigateToStep = useCallback((nextStep) => {
    setStep(nextStep);
    setMenuOpen(false);
  }, []);

  const showWorkflowMenu = inputPath !== null || schedulePeriodRows.length > 0 || expandedRows.length > 0 || processedRows.length > 0;
  const canVisitSchedule = step === STEP.SCHEDULE || schedulePeriodRows.length > 0 || inputPath !== null;
  const canVisitForm = step === STEP.FORM || step === STEP.RESULTS || expandedRows.length > 0;
  const canVisitResults = processedRows.length > 0;

  // ---------------------------------------------------------------------------
  // Upload handlers
  // ---------------------------------------------------------------------------

  const handlePDFUpload = useCallback(async (file) => {
    setGlobalError(null);
    setInputPath('pdf');
    setFileName(file.name.replace(/\.[^/.]+$/, ''));
    setMenuOpen(false);
    setIsExtracting(true);

    try {
      const buffer = await file.arrayBuffer();
      const [{ result, isLikelyScanned }, parsedFile] = await Promise.all([
        extractFromPDF(buffer),
        parseFile(file),
      ]);

      // Prefer structured file parser; fall back to OCR schedule
      const usingOcrSchedule = parsedFile.rows.length === 0 && result.rentSchedule?.length > 0;
      const periodRows = usingOcrSchedule
        ? ocrScheduleToPeriodRows(result.rentSchedule)
        : parsedFile.rows;

      const scheduleWarnings = [
        ...parsedFile.warnings,
        ...(usingOcrSchedule
          ? ['Rent schedule loaded from OCR extraction. Verify all periods and amounts before confirming.']
          : []),
      ];

      // Score confidence
      const confidence = scoreExtraction(result, periodRows);
      setConfidenceResult(confidence);
      setFieldCategories(categorizeFields(result, confidence));

      // Run plausibility checks on the period rows
      const plausibility = checkSchedulePlausibility(periodRows);
      setPlausibilityIssues(plausibility);

      prepopulateFormFromOCR(result);
      setSchedulePeriodRows(periodRows);
      setParseWarnings(scheduleWarnings);
      setScheduleNotice({
        tone: confidence.level === 'low' ? 'warning' : 'info',
        title: periodRows.length > 0 ? 'Review OCR schedule before assumptions' : 'Manual schedule entry needed',
        message: periodRows.length > 0
          ? 'OCR extracted a draft rent schedule. Review and edit the schedule preview below before continuing to lease assumptions.'
          : 'OCR extracted assumptions, but a usable rent schedule was not identified. Enter or paste the rent schedule below before continuing.',
        detail: `Extraction confidence: ${(confidence.overall * 100).toFixed(0)}% (${confidence.level})${confidence.reasons.length > 0 ? ` - ${confidence.reasons[0]}` : ''}`,
      });
      setStep(STEP.SCHEDULE);
    } catch (err) {
      // Even if everything fails, don't dead-end — route to manual
      setGlobalError(`Extraction encountered issues: ${err.message}. You can enter the schedule manually below.`);
      setSchedulePeriodRows([]);
      setScheduleNotice({
        tone: 'warning',
        title: 'Manual schedule entry needed',
        message: 'OCR extraction failed unexpectedly. Enter or paste the rent schedule below, then continue to lease assumptions.',
        detail: null,
      });
      setStep(STEP.SCHEDULE);
    } finally {
      setIsExtracting(false);
    }
  }, []);

  /**
   * Pre-populate form state from an OCR extraction result.
   */
  function prepopulateFormFromOCR(result) {
    const nnnToForm = (cat) => ({
      year1: cat?.year1 != null ? String(cat.year1) : '',
      escPct: cat?.escPct != null ? String(cat.escPct) : '',
      chargeStart: cat?.chargeStart ?? '',
      escStart: cat?.escStart ?? '',
    });

    let allConfidenceFlags = [...(result.confidenceFlags ?? [])];

    const hasIndividualNNN = result.cams?.year1 != null ||
      result.insurance?.year1 != null ||
      result.taxes?.year1 != null;

    let nnnMode = 'individual';
    let nnnAggregateForm = { year1: '', escPct: '' };

    if (result.estimatedNNNMonthly != null && !hasIndividualNNN) {
      nnnMode = 'aggregate';
      nnnAggregateForm = { year1: String(result.estimatedNNNMonthly), escPct: '' };
      allConfidenceFlags = [...allConfidenceFlags, 'nnnAggregate.year1'];
    }

    let depositOTC;
    if (Array.isArray(result.oneTimeCharges) && result.oneTimeCharges.length > 0) {
      depositOTC = result.oneTimeCharges.map((c) => ({
        name:   String(c.label || c.name || '').trim(),
        amount: String(c.amount ?? 0),
        date:   String(c.dueDate || c.date || ''),
      })).filter((c) => c.name);
    } else if (result.securityDeposit != null && result.securityDeposit > 0) {
      depositOTC = [{
        name:   'Security Deposit',
        amount: String(result.securityDeposit),
        date:   result.securityDepositDate ?? result.rentSchedule?.[0]?.periodStart ?? '',
      }];
    } else {
      depositOTC = [];
    }

    const nextFormState = {
      leaseName:        result.leaseName ?? '',
      squareFootage:    result.squareFootage != null ? String(result.squareFootage) : '',
      abatementEndDate: result.abatementEndDate ?? '',
      abatementPct: result.abatementPct != null ? String(result.abatementPct) : '',
      nnnMode,
      nnnAggregate: nnnAggregateForm,
      charges: buildInitialCharges(result, nnnToForm),
      oneTimeItems: (result.oneTimeItems?.length ? result.oneTimeItems : depositOTC).map((item) => ({
        label:  item.label ?? item.name ?? '',
        date:   item.dueDate ?? item.date ?? '',
        amount: item.amount != null
          ? String(Math.abs(item.amount) * (item.sign === -1 ? -1 : 1))
          : '',
      })),
    };

    setFormInitialValues(nextFormState);
    setFormDraftValues(nextFormState);

    setOcrConfidenceFlags(allConfidenceFlags);
    setOcrNotices(result.notices ?? []);
    setSfRequired(result.sfRequired ?? false);

    // Classification trace
    const classifications = {};
    for (const key of NNN_BUCKET_KEYS) {
      const fieldValue = result[key];
      if (fieldValue?.year1 != null) {
        classifications[key] = classifyExpenseLabel(key);
      }
    }
    setLabelClassifications(Object.keys(classifications).length ? classifications : null);
  }

  const handleFileUpload = useCallback(async (file) => {
    setGlobalError(null);
    setInputPath('file');
    setFileName(file.name.replace(/\.[^/.]+$/, ''));
    setMenuOpen(false);

    try {
      const { rows: periodRows, warnings } = await parseFile(file);
      setSchedulePeriodRows(periodRows);

      // Run plausibility checks
      const plausibility = checkSchedulePlausibility(periodRows);
      setPlausibilityIssues(plausibility);

      const { rows, duplicateDates: dups, warnings: expandWarnings } = expandPeriods(periodRows);
      setExpandedRows(rows);
      setParseWarnings([...warnings, ...expandWarnings]);
      setDuplicateDates(dups);
      setDupConfirmed(dups.length === 0);
      const emptyState = emptyFormState();
      setFormInitialValues(emptyState);
      setFormDraftValues(emptyState);
      setOcrConfidenceFlags([]);
      setOcrNotices([]);
      setSfRequired(false);
      setLabelClassifications(null);
      setConfidenceResult(null);
      setFieldCategories(null);

      // If no rows were produced, route to manual entry
      if (rows.length === 0 && periodRows.length === 0) {
        setScheduleNotice({
          tone: 'warning',
          title: 'Manual schedule entry needed',
          message: 'No valid rent schedule data could be extracted from the file. Enter or paste the rent schedule below.',
          detail: null,
        });
        setStep(STEP.SCHEDULE);
      } else {
        setScheduleNotice(null);
        setStep(STEP.FORM);
      }
    } catch (err) {
      // Don't dead-end — route to manual
      setGlobalError(`File parsing encountered issues: ${err.message}. You can enter the schedule manually.`);
      setSchedulePeriodRows([]);
      setScheduleNotice({
        tone: 'warning',
        title: 'Manual schedule entry needed',
        message: 'File parsing failed. Enter or paste the rent schedule below.',
        detail: null,
      });
      setStep(STEP.SCHEDULE);
    }
  }, []);

  const handleManualEntry = useCallback(() => {
    setGlobalError(null);
    setInputPath('manual');
    setFileName('lease-schedule');
    setMenuOpen(false);
    setExpandedRows([]);
    setSchedulePeriodRows([]);
    setParseWarnings([]);
    setDuplicateDates([]);
    setDupConfirmed(true);
    const emptyState = emptyFormState();
    setFormInitialValues(emptyState);
    setFormDraftValues(emptyState);
    setOcrConfidenceFlags([]);
    setOcrNotices([]);
    setSfRequired(false);
    setLabelClassifications(null);
    setConfidenceResult(null);
    setFieldCategories(null);
    setPlausibilityIssues([]);
    setScheduleNotice(null);
    setStep(STEP.SCHEDULE);
  }, []);

  const handleScheduleConfirm = useCallback((periodRows, warnings) => {
    setGlobalError(null);
    try {
      setSchedulePeriodRows(periodRows);
      const { rows, duplicateDates: dups, warnings: expandWarnings } = expandPeriods(periodRows);
      setExpandedRows(rows);
      setParseWarnings([...warnings, ...expandWarnings]);
      setDuplicateDates(dups);
      setDupConfirmed(dups.length === 0);

      // Run plausibility checks on the confirmed schedule
      const plausibility = checkSchedulePlausibility(periodRows);
      setPlausibilityIssues(plausibility);
      setStep(STEP.FORM);
    } catch (err) {
      setGlobalError(`Schedule parsing failed: ${err.message}`);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Form submit -> processing
  // ---------------------------------------------------------------------------

  const handleFormSubmit = useCallback((form) => {
    setGlobalError(null);

    // Require duplicate confirmation before processing
    if (duplicateDates.length > 0 && !dupConfirmed) {
      setGlobalError('Please confirm the duplicate date warning before processing.');
      return;
    }

    // Validate — now returns { errors, warnings }
    const scheduleResult = validateSchedule(expandedRows);
    const paramResult = validateParams(
      { ...form, sfRequired },
      expandedRows
    );

    const allErrors = [...scheduleResult.errors, ...paramResult.errors];
    const allWarnings = [...scheduleResult.warnings, ...paramResult.warnings];

    setValidationErrors(allErrors);
    setValidationWarnings(allWarnings);

    // Only block on errors, not warnings
    if (allErrors.length > 0) return;

    setIsProcessing(true);
    try {
      setFormDraftValues(form);
      const params = formToCalculatorParams(form);
      const rows = calculateAllCharges(expandedRows, params);
      const annotatedRows = labelClassifications
        ? rows.map((r) => ({ ...r, labelClassifications }))
        : rows;
      setProcessedRows(annotatedRows);
      setProcessedParams(params);
      setStep(STEP.RESULTS);
    } catch (err) {
      setGlobalError(`Processing error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [expandedRows, duplicateDates, dupConfirmed, sfRequired, labelClassifications]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-blue-700 font-bold text-lg tracking-tight">DEODATE</span>
            <span className="text-gray-300">|</span>
            <span className="text-gray-600 text-sm">Lease Schedule Engine</span>
          </div>
          {showWorkflowMenu && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 hover:text-gray-800"
                aria-label="Open navigation menu"
              >
                <span className="flex flex-col gap-1">
                  <span className="block h-0.5 w-4 bg-current" />
                  <span className="block h-0.5 w-4 bg-current" />
                  <span className="block h-0.5 w-4 bg-current" />
                </span>
              </button>
              {menuOpen && (
                <div className="absolute right-0 z-20 mt-2 w-56 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                  <button
                    type="button"
                    onClick={() => navigateToStep(STEP.UPLOAD)}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <span>Upload</span>
                    {step === STEP.UPLOAD && <span className="text-xs text-blue-600">Current</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateToStep(STEP.SCHEDULE)}
                    disabled={!canVisitSchedule}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-white"
                  >
                    <span>Schedule</span>
                    {step === STEP.SCHEDULE && <span className="text-xs text-blue-600">Current</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateToStep(STEP.FORM)}
                    disabled={!canVisitForm}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-white"
                  >
                    <span>Assumptions</span>
                    {step === STEP.FORM && <span className="text-xs text-blue-600">Current</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateToStep(STEP.RESULTS)}
                    disabled={!canVisitResults}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-white"
                  >
                    <span>Results</span>
                    {step === STEP.RESULTS && <span className="text-xs text-blue-600">Current</span>}
                  </button>
                  <div className="my-2 border-t border-gray-200" />
                  <button
                    type="button"
                    onClick={resetWorkflow}
                    className="w-full rounded-md px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    Start over
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-6 py-8 space-y-8">
        {/* Global error */}
        {globalError && (
          <div className="rounded-md bg-red-50 border border-red-300 p-4 text-sm text-red-700">
            {globalError}
          </div>
        )}

        {/* Step: Upload */}
        {step === STEP.UPLOAD && (
          <UploadRouter
            onPDFUpload={handlePDFUpload}
            onFileUpload={handleFileUpload}
            onManualEntry={handleManualEntry}
            isExtracting={isExtracting}
          />
        )}

        {/* Step: Schedule editor (manual entry / bulk paste / fallback) */}
        {step === STEP.SCHEDULE && (
          <div className="space-y-4">
            {/* Fallback banner — shown when routing from failed/weak extraction */}
            {scheduleNotice && (
              <div className="rounded-md bg-amber-50 border border-amber-300 p-4 space-y-2">
                <p className="text-sm font-semibold text-amber-800">
                  {scheduleNotice.title}
                </p>
                <p className="text-sm text-amber-700">
                  {scheduleNotice.message}
                </p>
                {scheduleNotice.detail && (
                  <p className="text-xs text-amber-600">
                    {scheduleNotice.detail}
                  </p>
                )}
              </div>
            )}
            <ScheduleEditor
              onConfirm={handleScheduleConfirm}
              onBack={() => navigateToStep(STEP.UPLOAD)}
              initialPeriodRows={schedulePeriodRows}
              initialEntryMode={schedulePeriodRows.length > 0 || inputPath === 'pdf' ? 'manual' : 'quick'}
            />
          </div>
        )}

        {/* Step: Form */}
        {step === STEP.FORM && (
          <div className="space-y-4">
            {/* Confidence summary (PDF path) */}
            {confidenceResult && (
              <div className={`rounded-md border p-3 space-y-1 ${
                confidenceResult.level === 'high' ? 'bg-green-50 border-green-200' :
                confidenceResult.level === 'medium' ? 'bg-amber-50 border-amber-200' :
                'bg-red-50 border-red-200'
              }`}>
                <p className={`text-sm font-semibold ${
                  confidenceResult.level === 'high' ? 'text-green-800' :
                  confidenceResult.level === 'medium' ? 'text-amber-800' :
                  'text-red-800'
                }`}>
                  Extraction confidence: {(confidenceResult.overall * 100).toFixed(0)}% ({confidenceResult.level})
                </p>
                {confidenceResult.reasons.map((r, i) => (
                  <p key={i} className="text-xs text-gray-600">{r}</p>
                ))}
              </div>
            )}

            {/* Parse warnings */}
            {parseWarnings.length > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1">
                {parseWarnings.map((w, i) => (
                  <p key={i} className="text-sm text-amber-800">{w}</p>
                ))}
              </div>
            )}

            {/* Plausibility warnings */}
            {plausibilityIssues.length > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1">
                <p className="text-sm font-semibold text-amber-800">Schedule plausibility checks:</p>
                {plausibilityIssues.map((issue, i) => (
                  <p key={i} className={`text-sm ${issue.severity === 'error' ? 'text-red-700' : 'text-amber-700'}`}>
                    {issue.message}
                  </p>
                ))}
              </div>
            )}

            {/* Validation warnings (non-blocking) */}
            {validationWarnings.length > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1">
                {validationWarnings.map((w, i) => (
                  <p key={i} className="text-sm text-amber-700">{w.message}</p>
                ))}
              </div>
            )}

            {/* Duplicate date warning (Flaw 5 fix) */}
            {duplicateDates.length > 0 && !dupConfirmed && (
              <div className="rounded-md bg-red-50 border border-red-300 p-4 space-y-2">
                <p className="text-sm font-semibold text-red-800">
                  Duplicate period start dates detected in the uploaded schedule:
                </p>
                <ul className="list-disc list-inside text-sm text-red-700">
                  {duplicateDates.map((d) => <li key={d}>{d}</li>)}
                </ul>
                <p className="text-sm text-red-700">
                  The later row for each duplicate date will be used. Confirm to proceed.
                </p>
                <button
                  onClick={() => setDupConfirmed(true)}
                  className="rounded-md bg-red-600 text-white px-4 py-1.5 text-sm font-semibold hover:bg-red-700"
                >
                  I understand — proceed with de-duplicated schedule
                </button>
              </div>
            )}

            {/* Edit schedule link — always available */}
            <div className="flex justify-end">
              <button
                onClick={() => {
                  navigateToStep(STEP.SCHEDULE);
                }}
                className="text-xs text-blue-600 hover:text-blue-800 underline"
              >
                Edit rent schedule manually
              </button>
            </div>

            <InputForm
              initialValues={formDraftValues ?? formInitialValues}
              confidenceFlags={ocrConfidenceFlags}
              notices={ocrNotices}
              validationErrors={validationErrors}
              sfRequired={sfRequired}
              leaseStartDate={expandedRows.length > 0 ? expandedRows[0].date : null}
              leaseEndDate={expandedRows.length > 0 ? expandedRows[expandedRows.length - 1].periodEnd : null}
              scheduledBaseRent={expandedRows.length > 0 ? expandedRows[0].monthlyRent : null}
              expandedRowCount={expandedRows.length}
              onSubmit={handleFormSubmit}
              onBack={() => navigateToStep(STEP.UPLOAD)}
              onBackToSchedule={() => navigateToStep(STEP.SCHEDULE)}
              onDraftChange={setFormDraftValues}
              isProcessing={isProcessing}
            />
          </div>
        )}

        {/* Step: Results */}
        {step === STEP.RESULTS && (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">Lease Schedule — {fileName}</h2>
              <ExportButton
                rows={processedRows}
                params={processedParams}
                filename={fileName}
                confidenceResult={confidenceResult}
                fieldCategories={fieldCategories}
                plausibilityIssues={plausibilityIssues}
                validationWarnings={validationWarnings}
                leaseMetadata={{
                  inputPath: inputPath === 'pdf' ? 'scan' : 'manual',
                  ocrConfidenceFlags,
                  ocrNotices,
                  parseWarnings,
                  validationWarnings,
                  duplicateDatesConfirmed: dupConfirmed,
                }}
              />
            </div>

            {/* Back navigation row */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigateToStep(STEP.FORM)}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                Back to assumptions
              </button>
              {canVisitSchedule && (
                <button
                  type="button"
                  onClick={() => navigateToStep(STEP.SCHEDULE)}
                  className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                >
                  Back to schedule
                </button>
              )}
              <button
                type="button"
                onClick={resetWorkflow}
                className="rounded border border-red-200 bg-white px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
              >
                Start over
              </button>
            </div>

            {/* Confidence / plausibility summary on results page */}
            {(confidenceResult?.level === 'low' || plausibilityIssues.some((i) => i.severity === 'warning')) && (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1">
                <p className="text-sm font-semibold text-amber-800">Review recommended</p>
                {confidenceResult?.level === 'low' && (
                  <p className="text-sm text-amber-700">
                    Extraction confidence was low ({(confidenceResult.overall * 100).toFixed(0)}%). Verify all values before relying on this output.
                  </p>
                )}
                {plausibilityIssues.filter((i) => i.severity === 'warning').map((issue, i) => (
                  <p key={i} className="text-sm text-amber-700">{issue.message}</p>
                ))}
              </div>
            )}

            <SummaryPanel rows={processedRows} />

            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-3">Monthly Ledger</h3>
              <p className="text-xs text-gray-500 mb-2">
                Click any row to expand its calculation trace.
                <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-xs">amber rows = abatement period</span>
              </p>
              <LedgerTable rows={processedRows} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
