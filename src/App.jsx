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
import { expandPeriods } from './engine/expander.js';
import { calculateAllCharges } from './engine/calculator.js';
import { validateParams, validateSchedule } from './engine/validator.js';
import { extractFromUploadedDocument } from './ocr/extractor.js';
import { classifyExpenseLabel, NNN_BUCKET_KEYS } from './engine/labelClassifier.js';
import { scoreExtraction, categorizeFields } from './engine/confidenceScorer.js';
import { checkSchedulePlausibility } from './engine/plausibility.js';
import { buildChargesFromOCR, hasDetectedNNNCharges } from './ocr/chargeNormalizer.js';
import {
  buildOCRConcessionForms,
  normalizeFormToCalculatorParams,
} from './engine/leaseTerms.js';
import { materializeScheduleSemantics } from './engine/scheduleSemantics.js';
import { buildPrepopulatedFormFromOCR, ocrScheduleToPeriodRows } from './ocr/ocrPipeline.js';

// ---------------------------------------------------------------------------
// Step constants
// ---------------------------------------------------------------------------
const STEP = {
  UPLOAD: 'upload',
  SCHEDULE: 'schedule',
  FORM: 'form',
  RESULTS: 'results',
};

const PARSER_ELIGIBLE_EXTENSIONS = new Set(['pdf', 'xlsx', 'xls', 'csv']);

export function formToCalculatorParams(form, rows = []) {
  return normalizeFormToCalculatorParams(form, rows);
}

function getFileExtension(filename = '') {
  return String(filename).split('.').pop()?.toLowerCase() ?? '';
}

function hasBlockingPlausibilityIssues(periodRows = []) {
  return checkSchedulePlausibility(periodRows).some((issue) => issue.severity === 'error');
}

function summarizeScheduleConflict(parsedRows = [], extractedRows = []) {
  if (!parsedRows.length || !extractedRows.length) return null;

  const parsedFirst = parsedRows[0];
  const extractedFirst = extractedRows[0];
  const parsedLast = parsedRows[parsedRows.length - 1];
  const extractedLast = extractedRows[extractedRows.length - 1];
  const sameLength = parsedRows.length === extractedRows.length;
  const startGapDays = Math.round((parsedFirst.periodStart - extractedFirst.periodStart) / 86400000);
  const endGapDays = Math.round((parsedLast.periodEnd - extractedLast.periodEnd) / 86400000);
  const firstRentDelta = Math.abs((parsedFirst.monthlyRent ?? 0) - (extractedFirst.monthlyRent ?? 0));

  if (sameLength && startGapDays === 0 && endGapDays === 0 && firstRentDelta < 0.01) {
    return null;
  }

  return `Structured parsing and text extraction produced different base-rent schedules. The text-first draft was kept for review because it appears to contain materially different period timing or rent values.`;
}

function chooseScheduleDraft({ parsedRows, extractionResult, parserWarnings }) {
  const semanticNormalization = extractionResult?.scheduleNormalization ?? null;
  const extractedRows = ocrScheduleToPeriodRows(extractionResult?.rentSchedule);
  const usingSemanticSchedule = Boolean(semanticNormalization?.usedAsRentSchedule);
  const parsedUsable = parsedRows.length > 0 && !hasBlockingPlausibilityIssues(parsedRows);
  const extractedUsable = extractedRows.length > 0 && !hasBlockingPlausibilityIssues(extractedRows);
  const scheduleWarnings = [...(parserWarnings ?? [])];

  const conflictMessage = parsedUsable && extractedUsable
    ? summarizeScheduleConflict(parsedRows, extractedRows)
    : null;
  if (conflictMessage) {
    scheduleWarnings.push(conflictMessage);
  }

  if (conflictMessage && extractedUsable) {
    return {
      periodRows: extractedRows,
      scheduleWarnings: [
        ...scheduleWarnings,
        usingSemanticSchedule
          ? 'Rent schedule was materialized from semantic lease language. Verify the anchor date, escalation cadence, and derived dated periods before confirming.'
          : 'Rent schedule was derived from text-first extraction. Verify all periods and amounts before confirming.',
      ],
      nextScheduleMode: usingSemanticSchedule ? 'semantic' : 'explicit',
      semanticNormalization,
      usingSemanticSchedule,
    };
  }

  if (parsedUsable) {
    return {
      periodRows: parsedRows,
      scheduleWarnings,
      nextScheduleMode: 'explicit',
      semanticNormalization,
      usingSemanticSchedule: false,
    };
  }

  if (extractedUsable) {
    return {
      periodRows: extractedRows,
      scheduleWarnings: [
        ...scheduleWarnings,
        usingSemanticSchedule
          ? 'Rent schedule was materialized from semantic lease language. Verify the anchor date, escalation cadence, and derived dated periods before confirming.'
          : 'Rent schedule was derived from text-first extraction. Verify all periods and amounts before confirming.',
      ],
      nextScheduleMode: usingSemanticSchedule ? 'semantic' : 'explicit',
      semanticNormalization,
      usingSemanticSchedule,
    };
  }

  return {
    periodRows: [],
    scheduleWarnings,
    nextScheduleMode: semanticNormalization?.candidates?.length ? 'semantic' : 'explicit',
    semanticNormalization,
    usingSemanticSchedule,
  };
}

function formatSignedOneTimeAmount(item) {
  const amount = Number(item?.amount);
  if (!Number.isFinite(amount)) return '';
  const sign = item?.sign === -1 ? -1 : item?.sign === 1 ? 1 : (amount < 0 ? -1 : 1);
  return String(Math.abs(amount) * sign);
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
  const [scheduleSemantics, setScheduleSemantics] = useState(null);
  const [scheduleMaterializationMode, setScheduleMaterializationMode] = useState(null);

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
    setScheduleSemantics(null);
    setScheduleMaterializationMode(null);
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
  const canVisitForm = step === STEP.FORM
    || step === STEP.RESULTS
    || expandedRows.length > 0
    || Boolean(scheduleSemantics?.candidates?.length);
  const canVisitResults = processedRows.length > 0;

  // ---------------------------------------------------------------------------
  // Upload handlers
  // ---------------------------------------------------------------------------

  const handleScanUpload = useCallback(async (file) => {
    setGlobalError(null);
    setInputPath('scan');
    setFileName(file.name.replace(/\.[^/.]+$/, ''));
    setMenuOpen(false);
    setIsExtracting(true);
    setExpandedRows([]);
    setDuplicateDates([]);
    setDupConfirmed(true);
    setValidationErrors([]);
    setValidationWarnings([]);
    setConfidenceResult(null);
    setFieldCategories(null);
    setPlausibilityIssues([]);

    try {
      const ext = getFileExtension(file.name);
      const [extractedDocument, parsedFile] = await Promise.all([
        extractFromUploadedDocument(file),
        PARSER_ELIGIBLE_EXTENSIONS.has(ext)
          ? parseFile(file)
          : Promise.resolve({ rows: [], warnings: [] }),
      ]);
      const { result } = extractedDocument;

      const resolvedSchedule = chooseScheduleDraft({
        parsedRows: parsedFile.rows,
        extractionResult: result,
        parserWarnings: parsedFile.warnings,
      });

      // Score confidence
      const confidence = scoreExtraction(result, resolvedSchedule.periodRows);
      setConfidenceResult(confidence);
      setFieldCategories(categorizeFields(result, confidence));

      // Run plausibility checks on the period rows
      const plausibility = checkSchedulePlausibility(resolvedSchedule.periodRows);
      setPlausibilityIssues(plausibility);

      const { rows: previewRows } = resolvedSchedule.periodRows.length > 0
        ? expandPeriods(resolvedSchedule.periodRows)
        : { rows: [] };
      applyPrepopulatedFormState(result, previewRows);
      setScheduleSemantics(resolvedSchedule.semanticNormalization);
      setScheduleMaterializationMode(resolvedSchedule.nextScheduleMode);
      setSchedulePeriodRows(resolvedSchedule.periodRows);
      setParseWarnings(resolvedSchedule.scheduleWarnings);

      if (resolvedSchedule.periodRows.length > 0) {
        setScheduleNotice({
          tone: confidence.level === 'low' ? 'warning' : 'info',
          title: 'Review extracted schedule before assumptions',
          message: resolvedSchedule.usingSemanticSchedule
            ? 'The app materialized a dated base-rent schedule from detected lease language. Review the derived periods below before continuing to lease assumptions.'
            : 'The uploaded file produced a draft base-rent schedule. Review and edit the schedule preview below before continuing to lease assumptions.',
          detail: `Extraction confidence: ${(confidence.overall * 100).toFixed(0)}% (${confidence.level})${confidence.reasons.length > 0 ? ` - ${confidence.reasons[0]}` : ''}`,
        });
        setStep(STEP.SCHEDULE);
      } else if (resolvedSchedule.semanticNormalization?.candidates?.length > 0) {
        setScheduleNotice(null);
        setStep(STEP.FORM);
      } else {
        setScheduleNotice({
          tone: 'warning',
          title: 'Manual schedule entry needed',
          message: 'The uploaded file populated assumptions, but a usable rent schedule was not identified. Enter or paste the rent schedule below before continuing.',
          detail: `Extraction confidence: ${(confidence.overall * 100).toFixed(0)}% (${confidence.level})${confidence.reasons.length > 0 ? ` - ${confidence.reasons[0]}` : ''}`,
        });
        setStep(STEP.SCHEDULE);
      }
    } catch (err) {
      // Even if everything fails, don't dead-end — route to manual
      setGlobalError(`Extraction encountered issues: ${err.message}. You can enter the schedule manually below.`);
      setSchedulePeriodRows([]);
      setScheduleSemantics(null);
      setScheduleMaterializationMode(null);
      setScheduleNotice({
        tone: 'warning',
        title: 'Manual schedule entry needed',
        message: 'Automatic extraction failed unexpectedly. Enter or paste the rent schedule below, then continue to lease assumptions.',
        detail: null,
      });
      setStep(STEP.SCHEDULE);
    } finally {
      setIsExtracting(false);
    }
  }, []);

  /**
   * Pre-populate form state from an OCR extraction result.
   *
   * Charge prefill strategy (in priority order):
   * 1. result.recurringCharges[] → buildChargesFromOCR() (lease-native labels preserved)
   * 2. Legacy fixed buckets (result.cams, result.insurance, etc.) when #1 is absent
   * 3. estimatedNNNMonthly → aggregate mode when no named charges detected at all
   */
  function prepopulateFormFromOCR(result, rows = []) {
    // ── Charges: prefer recurringCharges[] over legacy fixed buckets ──────────
    const {
      charges: builtCharges,
      confidenceFlags: chargeFlags,
      notices: chargeNotices,
    } = buildChargesFromOCR(result);

    // ── NNN mode ──────────────────────────────────────────────────────────────
    // Stay in individual mode when recurringCharges[] has NNN-type entries.
    // Fall back to aggregate only when neither recurringCharges[] nor fixed buckets
    // provide any NNN data and an estimatedNNNMonthly aggregate is present.
    const hasNNNFromRecurring = hasDetectedNNNCharges(result);
    const hasIndividualNNN =
      result.cams?.year1 != null ||
      result.insurance?.year1 != null ||
      result.taxes?.year1 != null;

    let nnnMode = 'individual';
    let nnnAggregateForm = { year1: '', escPct: '' };

    if (
      result.estimatedNNNMonthly != null &&
      !hasIndividualNNN &&
      !hasNNNFromRecurring
    ) {
      nnnMode = 'aggregate';
      nnnAggregateForm = { year1: String(result.estimatedNNNMonthly), escPct: '' };
    }

    // ── Confidence flags ──────────────────────────────────────────────────────
    let allConfidenceFlags = [
      ...(result.confidenceFlags ?? []),
      ...chargeFlags,
    ];
    if (nnnMode === 'aggregate') {
      allConfidenceFlags = [...allConfidenceFlags, 'nnnAggregate.year1'];
    }

    // ── One-time items ────────────────────────────────────────────────────────
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

    // ── Notices ───────────────────────────────────────────────────────────────
    const generatedConcessions = buildOCRConcessionForms(result, rows);
    const allNotices = [...(result.notices ?? []), ...chargeNotices, ...generatedConcessions.notices];

    // ── Assemble form state ───────────────────────────────────────────────────
    const nextFormState = {
      leaseName:        result.leaseName ?? '',
      squareFootage:    result.squareFootage != null ? String(result.squareFootage) : '',
      nnnMode,
      nnnAggregate: nnnAggregateForm,
      charges: builtCharges,
      freeRentEvents: generatedConcessions.freeRentEvents,
      abatementEvents: generatedConcessions.abatementEvents,
      legacyConcessionEvents: [],
      oneTimeItems: (result.oneTimeItems?.length ? result.oneTimeItems : depositOTC).map((item) => ({
        label:  item.label ?? item.name ?? '',
        date:   item.dueDate ?? item.date ?? '',
        amount: formatSignedOneTimeAmount(item),
      })),
    };

    setFormInitialValues(nextFormState);
    setFormDraftValues(nextFormState);
    setOcrConfidenceFlags(allConfidenceFlags);
    setOcrNotices(allNotices);
    setSfRequired(result.sfRequired ?? false);

    // Classification trace (legacy — uses fixed bucket keys for audit)
    const classifications = {};
    for (const key of NNN_BUCKET_KEYS) {
      const fieldValue = result[key];
      if (fieldValue?.year1 != null) {
        classifications[key] = classifyExpenseLabel(key);
      }
    }
    setLabelClassifications(Object.keys(classifications).length ? classifications : null);
  }

  function applyPrepopulatedFormState(result, rows = []) {
    const prepopulated = buildPrepopulatedFormFromOCR(result, rows);
    setFormInitialValues(prepopulated.formState);
    setFormDraftValues(prepopulated.formState);
    setOcrConfidenceFlags(prepopulated.confidenceFlags);
    setOcrNotices(prepopulated.notices);
    setSfRequired(prepopulated.sfRequired);
    setLabelClassifications(prepopulated.labelClassifications);
  }

  const handleFileUpload = useCallback(async (file) => {
    setGlobalError(null);
    setInputPath('file');
    setFileName(file.name.replace(/\.[^/.]+$/, ''));
    setMenuOpen(false);

    try {
      const { rows: periodRows, warnings } = await parseFile(file);
      setScheduleSemantics(null);
      setScheduleMaterializationMode('explicit');
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
      setScheduleSemantics(null);
      setScheduleMaterializationMode(null);
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
    setScheduleSemantics(null);
    setScheduleMaterializationMode('explicit');
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
      setScheduleMaterializationMode('explicit');
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

    let activePeriodRows = schedulePeriodRows;
    let activeExpandedRows = expandedRows;
    let activeDuplicateDates = duplicateDates;

    if (scheduleMaterializationMode === 'semantic' && scheduleSemantics?.candidates?.length > 0) {
      const rematerialized = materializeScheduleSemantics(scheduleSemantics, {
        base_rent_start_date: form.rentCommencementDate,
        rent_commencement_date: form.rentCommencementDate,
      });
      setScheduleSemantics(rematerialized);

      if (rematerialized?.preferredPeriodRows?.length > 0) {
        const expandedFromSemantic = expandPeriods(rematerialized.preferredPeriodRows);
        activePeriodRows = rematerialized.preferredPeriodRows;
        activeExpandedRows = expandedFromSemantic.rows;
        activeDuplicateDates = expandedFromSemantic.duplicateDates;

        setSchedulePeriodRows(rematerialized.preferredPeriodRows);
        setExpandedRows(expandedFromSemantic.rows);
        setDuplicateDates(expandedFromSemantic.duplicateDates);
        setDupConfirmed(expandedFromSemantic.duplicateDates.length === 0);
        setPlausibilityIssues(checkSchedulePlausibility(rematerialized.preferredPeriodRows));

        const semanticWarnings = [
          ...parseWarnings,
          ...expandedFromSemantic.warnings,
        ];
        if (!semanticWarnings.includes('Base-rent schedule was re-anchored from semantic lease language using the current Rent Commencement Date.')) {
          semanticWarnings.push('Base-rent schedule was re-anchored from semantic lease language using the current Rent Commencement Date.');
        }
        setParseWarnings(semanticWarnings);
      } else if (expandedRows.length === 0) {
        const materializationMessage = rematerialized?.userGuidance
          ?? 'Rent Commencement Date is required to materialize the detected semantic rent schedule.';
        setValidationErrors([{
          field: 'rentCommencementDate',
          message: materializationMessage,
          severity: 'error',
        }]);
        setValidationWarnings([]);
        setGlobalError(materializationMessage);
        return;
      }
    }

    if (activeDuplicateDates.length > 0) {
      const duplicateSetUnchanged = activeDuplicateDates.length === duplicateDates.length
        && activeDuplicateDates.every((value, index) => value === duplicateDates[index]);
      if (!(duplicateSetUnchanged && dupConfirmed)) {
        setDuplicateDates(activeDuplicateDates);
        setDupConfirmed(false);
        setGlobalError('Please confirm the duplicate date warning before processing.');
        return;
      }
    }

    // Validate — now returns { errors, warnings }
    const scheduleResult = validateSchedule(activeExpandedRows);
    const paramResult = validateParams(
      { ...form, sfRequired },
      activeExpandedRows
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
      const params = formToCalculatorParams(form, activeExpandedRows);
      const rows = calculateAllCharges(activeExpandedRows, params);
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
  }, [
    expandedRows,
    schedulePeriodRows,
    duplicateDates,
    dupConfirmed,
    sfRequired,
    labelClassifications,
    scheduleSemantics,
    scheduleMaterializationMode,
    parseWarnings,
  ]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-hero-radial text-txt-primary">
      <header className="sticky top-0 z-10 border-b border-app-border/80 bg-app-surface/72 px-6 py-4 backdrop-blur-xl">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div>
              <span className="font-display text-xl font-semibold text-accent">Lease Schedule Engine</span>
            </div>
          </div>
          {showWorkflowMenu && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                className="btn-ghost h-11 w-11 !rounded-full !p-0"
                aria-label="Open navigation menu"
              >
                <span className="flex flex-col gap-1">
                  <span className="block h-0.5 w-4 bg-current" />
                  <span className="block h-0.5 w-4 bg-current" />
                  <span className="block h-0.5 w-4 bg-current" />
                </span>
              </button>
              {menuOpen && (
                <div className="absolute right-0 z-20 mt-3 w-60 rounded-[1.2rem] border border-app-border bg-app-panel/95 p-3 shadow-glass backdrop-blur-xl">
                  <button
                    type="button"
                    onClick={() => navigateToStep(STEP.UPLOAD)}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-txt-primary hover:bg-app-surface"
                  >
                    <span>Upload</span>
                    {step === STEP.UPLOAD && <span className="status-chip border-accent/30 bg-accent/10 text-accent-soft">Current</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateToStep(STEP.SCHEDULE)}
                    disabled={!canVisitSchedule}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-txt-primary hover:bg-app-surface disabled:cursor-not-allowed disabled:text-txt-dim disabled:hover:bg-transparent"
                  >
                    <span>Schedule</span>
                    {step === STEP.SCHEDULE && <span className="status-chip border-accent/30 bg-accent/10 text-accent-soft">Current</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateToStep(STEP.FORM)}
                    disabled={!canVisitForm}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-txt-primary hover:bg-app-surface disabled:cursor-not-allowed disabled:text-txt-dim disabled:hover:bg-transparent"
                  >
                    <span>Assumptions</span>
                    {step === STEP.FORM && <span className="status-chip border-accent/30 bg-accent/10 text-accent-soft">Current</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateToStep(STEP.RESULTS)}
                    disabled={!canVisitResults}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-txt-primary hover:bg-app-surface disabled:cursor-not-allowed disabled:text-txt-dim disabled:hover:bg-transparent"
                  >
                    <span>Results</span>
                    {step === STEP.RESULTS && <span className="status-chip border-accent/30 bg-accent/10 text-accent-soft">Current</span>}
                  </button>
                  <div className="my-2 border-t border-app-border" />
                  <button
                    type="button"
                    onClick={resetWorkflow}
                    className="w-full rounded-xl px-3 py-2 text-left text-sm text-status-err-text hover:bg-status-err-bg"
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
          <div className="rounded-[1.15rem] border border-status-err-border bg-status-err-bg/92 p-4 text-sm text-status-err-text shadow-panel">
            {globalError}
          </div>
        )}

        {/* Step: Upload */}
        {step === STEP.UPLOAD && (
          <UploadRouter
            onScanUpload={handleScanUpload}
            onManualEntry={handleManualEntry}
            isExtracting={isExtracting}
          />
        )}

        {/* Step: Schedule editor (manual entry / bulk paste / fallback) */}
        {step === STEP.SCHEDULE && (
          <div className="space-y-4">
            {/* Fallback banner — shown when routing from failed/weak extraction */}
            {scheduleNotice && (
              <div className="rounded-[1.15rem] border border-status-warn-border bg-status-warn-bg/92 p-4 space-y-2 shadow-panel">
                <p className="text-sm font-semibold text-status-warn-title">
                  {scheduleNotice.title}
                </p>
                <p className="text-sm text-status-warn-text">
                  {scheduleNotice.message}
                </p>
                {scheduleNotice.detail && (
                  <p className="text-xs text-status-warn-text">
                    {scheduleNotice.detail}
                  </p>
                )}
              </div>
            )}
            <ScheduleEditor
              onConfirm={handleScheduleConfirm}
              onBack={() => navigateToStep(STEP.UPLOAD)}
              initialPeriodRows={schedulePeriodRows}
              initialEntryMode={schedulePeriodRows.length > 0 || inputPath === 'scan' ? 'manual' : 'quick'}
              semanticSchedule={scheduleSemantics}
              scheduleMaterializationMode={scheduleMaterializationMode}
            />
          </div>
        )}

        {/* Step: Form */}
        {step === STEP.FORM && (
          <div className="space-y-4">
            {/* Confidence summary (PDF path) */}
            {confidenceResult && (
              <div className={`rounded-[1.15rem] border p-4 space-y-1 shadow-panel ${
                confidenceResult.level === 'high' ? 'bg-status-ok-bg border-status-ok-border' :
                confidenceResult.level === 'medium' ? 'bg-status-warn-bg border-status-warn-border' :
                'bg-status-err-bg border-status-err-border'
              }`}>
                <p className={`text-sm font-semibold ${
                  confidenceResult.level === 'high' ? 'text-status-ok-title' :
                  confidenceResult.level === 'medium' ? 'text-status-warn-title' :
                  'text-status-err-title'
                }`}>
                  Extraction confidence: {(confidenceResult.overall * 100).toFixed(0)}% ({confidenceResult.level})
                </p>
                {confidenceResult.reasons.map((r, i) => (
                  <p key={i} className="text-xs text-txt-muted">{r}</p>
                ))}
              </div>
            )}

            {/* Parse warnings */}
            {parseWarnings.length > 0 && (
              <div className="rounded-[1.15rem] border border-status-warn-border bg-status-warn-bg/92 p-4 space-y-1 shadow-panel">
                {parseWarnings.map((w, i) => (
                  <p key={i} className="text-sm text-status-warn-text">{w}</p>
                ))}
              </div>
            )}

            {/* Plausibility warnings */}
            {plausibilityIssues.length > 0 && (
              <div className="rounded-[1.15rem] border border-status-warn-border bg-status-warn-bg/92 p-4 space-y-1 shadow-panel">
                <p className="text-sm font-semibold text-status-warn-title">Schedule plausibility checks:</p>
                {plausibilityIssues.map((issue, i) => (
                  <p key={i} className={`text-sm ${issue.severity === 'error' ? 'text-status-err-text' : 'text-status-warn-text'}`}>
                    {issue.message}
                  </p>
                ))}
              </div>
            )}

            {/* Validation warnings (non-blocking) */}
            {validationWarnings.length > 0 && (
              <div className="rounded-[1.15rem] border border-status-warn-border bg-status-warn-bg/92 p-4 space-y-1 shadow-panel">
                {validationWarnings.map((w, i) => (
                  <p key={i} className="text-sm text-status-warn-text">{w.message}</p>
                ))}
              </div>
            )}

            {/* Duplicate date warning (Flaw 5 fix) */}
            {duplicateDates.length > 0 && !dupConfirmed && (
              <div className="rounded-[1.15rem] border border-status-err-border bg-status-err-bg/92 p-4 space-y-2 shadow-panel">
                <p className="text-sm font-semibold text-status-err-title">
                  Duplicate period start dates detected in the uploaded schedule:
                </p>
                <ul className="list-disc list-inside text-sm text-status-err-text">
                  {duplicateDates.map((d) => <li key={d}>{d}</li>)}
                </ul>
                <p className="text-sm text-status-err-text">
                  The later row for each duplicate date will be used. Confirm to proceed.
                </p>
                <button
                  onClick={() => setDupConfirmed(true)}
                  className="btn-secondary"
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
                className="btn-link"
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
              resolvedRows={expandedRows}
              schedulePeriodRows={schedulePeriodRows}
              scheduledBaseRent={expandedRows.length > 0 ? expandedRows[0].monthlyRent : null}
              expandedRowCount={expandedRows.length}
              semanticSchedule={scheduleSemantics}
              scheduleMaterializationMode={scheduleMaterializationMode}
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
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div>
                <p className="section-kicker">Processed Output</p>
                <h2 className="mt-2 text-2xl font-semibold text-txt-primary">Lease Schedule - {fileName}</h2>
              </div>
              <ExportButton
                rows={processedRows}
                params={processedParams}
                filename={fileName}
                confidenceResult={confidenceResult}
                fieldCategories={fieldCategories}
                plausibilityIssues={plausibilityIssues}
                validationWarnings={validationWarnings}
                leaseMetadata={{
                  inputPath: inputPath === 'scan' ? 'scan' : 'manual',
                  ocrConfidenceFlags,
                  ocrNotices,
                  parseWarnings,
                  validationWarnings,
                  duplicateDatesConfirmed: dupConfirmed,
                  scheduleSemantics: scheduleSemantics
                    ? {
                        representationType: scheduleSemantics.preferredRepresentationType,
                        materializationStatus: scheduleSemantics.materializationStatus,
                        summaryLines: scheduleSemantics.summaryLines,
                        startRuleSummaries: scheduleSemantics.startRuleSummaries,
                      }
                    : null,
                }}
              />
            </div>

            {/* Back navigation row */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => navigateToStep(STEP.FORM)}
                className="btn-secondary !px-4 !py-2 !text-xs"
              >
                Back to assumptions
              </button>
              {canVisitSchedule && (
                <button
                  type="button"
                  onClick={() => navigateToStep(STEP.SCHEDULE)}
                  className="btn-ghost !px-4 !py-2 !text-xs"
                >
                  Back to schedule
                </button>
              )}
              <button
                type="button"
                onClick={resetWorkflow}
                className="btn-ghost !border-status-err-border !px-4 !py-2 !text-xs !text-status-err-text hover:!bg-status-err-bg"
              >
                Start over
              </button>
            </div>

            {/* Confidence / plausibility summary on results page */}
            {(confidenceResult?.level === 'low' || plausibilityIssues.some((i) => i.severity === 'warning')) && (
              <div className="rounded-[1.15rem] border border-status-warn-border bg-status-warn-bg/92 p-4 space-y-1 shadow-panel">
                <p className="text-sm font-semibold text-status-warn-title">Review recommended</p>
                {confidenceResult?.level === 'low' && (
                  <p className="text-sm text-status-warn-text">
                    Extraction confidence was low ({(confidenceResult.overall * 100).toFixed(0)}%). Verify all values before relying on this output.
                  </p>
                )}
                {plausibilityIssues.filter((i) => i.severity === 'warning').map((issue, i) => (
                  <p key={i} className="text-sm text-status-warn-text">{issue.message}</p>
                ))}
              </div>
            )}

            <SummaryPanel rows={processedRows} />

            <div>
              <p className="section-kicker">Detailed Ledger</p>
              <h3 className="mt-2 mb-3 text-xl font-semibold text-txt-primary">Monthly Ledger</h3>
              <p className="text-xs text-txt-muted mb-2">
                Click any row to expand its calculation trace.
                <span className="status-chip ml-2 border-status-warn-border bg-status-warn-bg text-status-warn-text">Free rent / abatement rows</span>
              </p>
              <LedgerTable rows={processedRows} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
