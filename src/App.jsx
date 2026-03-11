/**
 * App.jsx
 * Root application component. Manages the step-by-step processing pipeline:
 *   upload → (ocr extraction?) → form → processing → results
 *
 * Human-in-the-loop: processing is never triggered automatically.
 * The user must explicitly confirm the form before calculator.js runs.
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
import { extractFromPDF } from './ocr/extractor.js';
import { parseMDYStrict, parseExcelDate } from './engine/yearMonth.js';

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

function formToCalculatorParams(form) {
  return {
    squareFootage: Number(form.squareFootage) || 0,
    abatementEndDate: parseMDYStrict(form.abatementEndDate),
    abatementPct: Number(form.abatementPct) || 0,
    cams: {
      year1: Number(form.cams?.year1) || 0,
      escPct: Number(form.cams?.escPct) || 0,
      escStart: parseMDYStrict(form.cams?.escStart),
      chargeStart: parseMDYStrict(form.cams?.chargeStart),
    },
    insurance: {
      year1: Number(form.insurance?.year1) || 0,
      escPct: Number(form.insurance?.escPct) || 0,
      escStart: parseMDYStrict(form.insurance?.escStart),
      chargeStart: parseMDYStrict(form.insurance?.chargeStart),
    },
    taxes: {
      year1: Number(form.taxes?.year1) || 0,
      escPct: Number(form.taxes?.escPct) || 0,
      escStart: parseMDYStrict(form.taxes?.escStart),
      chargeStart: parseMDYStrict(form.taxes?.chargeStart),
    },
    security: {
      year1: Number(form.security?.year1) || 0,
      escPct: Number(form.security?.escPct) || 0,
      escStart: parseMDYStrict(form.security?.escStart),
      chargeStart: parseMDYStrict(form.security?.chargeStart),
    },
    otherItems: {
      year1: Number(form.otherItems?.year1) || 0,
      escPct: Number(form.otherItems?.escPct) || 0,
      escStart: parseMDYStrict(form.otherItems?.escStart),
      chargeStart: parseMDYStrict(form.otherItems?.chargeStart),
    },
  };
}

/**
 * Convert the rentSchedule array from the OCR result into canonical period rows
 * suitable for expandPeriods(). OCR dates are MM/DD/YYYY strings; parseMDYStrict
 * handles the strict format and parseExcelDate covers variants without leading zeros.
 *
 * @param {Array<{periodStart: string, periodEnd: string, monthlyRent: number}>} rentSchedule
 * @returns {{ periodStart: Date, periodEnd: Date, monthlyRent: number }[]}
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
  const [inputPath, setInputPath] = useState(null);   // 'pdf' | 'file'
  const [fileName, setFileName] = useState('lease-schedule');

  // Schedule rows (from parser + expander)
  const [expandedRows, setExpandedRows] = useState([]);
  const [parseWarnings, setParseWarnings] = useState([]);
  const [duplicateDates, setDuplicateDates] = useState([]);
  const [dupConfirmed, setDupConfirmed] = useState(false);

  // Form state
  const [formInitialValues, setFormInitialValues] = useState(null);
  const [ocrConfidenceFlags, setOcrConfidenceFlags] = useState([]);
  const [ocrNotices, setOcrNotices] = useState([]);
  const [sfRequired, setSfRequired] = useState(false);

  // Processing state
  const [validationErrors, setValidationErrors] = useState([]);
  const [processedRows, setProcessedRows] = useState([]);
  const [processedParams, setProcessedParams] = useState({});
  const [isExtracting, setIsExtracting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [globalError, setGlobalError] = useState(null);

  // ---------------------------------------------------------------------------
  // Upload handlers
  // ---------------------------------------------------------------------------

  const handlePDFUpload = useCallback(async (file) => {
    setGlobalError(null);
    setInputPath('pdf');
    setFileName(file.name.replace(/\.[^/.]+$/, ''));
    setIsExtracting(true);

    try {
      // Run OCR extraction and file parsing in parallel
      const buffer = await file.arrayBuffer();
      const [{ result, isLikelyScanned }, parsedFile] = await Promise.all([
        extractFromPDF(buffer),
        parseFile(file),
      ]);

      // Prefer rows from the structured file parser; fall back to the OCR rent schedule.
      // The structured PDF parser returns empty rows for normal lease PDFs (no table headers),
      // so the OCR result is the primary source for Path A uploads.
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

      const { rows, duplicateDates: dups } = expandPeriods(periodRows);
      setExpandedRows(rows);
      setParseWarnings(scheduleWarnings);
      setDuplicateDates(dups);
      setDupConfirmed(dups.length === 0);

      // Pre-populate form from OCR result
      const nnnToForm = (cat) => ({
        year1: cat?.year1 != null ? String(cat.year1) : '',
        escPct: cat?.escPct != null ? String(cat.escPct) : '',
        chargeStart: cat?.chargeStart ?? '',
        escStart: cat?.escStart ?? '',
      });

      setFormInitialValues({
        squareFootage: result.squareFootage != null ? String(result.squareFootage) : '',
        abatementEndDate: result.abatementEndDate ?? '',
        abatementPct: result.abatementPct != null ? String(result.abatementPct) : '',
        cams: nnnToForm(result.cams),
        insurance: nnnToForm(result.insurance),
        taxes: nnnToForm(result.taxes),
        security: nnnToForm(result.security),
        otherItems: nnnToForm(result.otherItems),
      });

      setOcrConfidenceFlags(result.confidenceFlags ?? []);
      setOcrNotices(result.notices ?? []);
      setSfRequired(result.sfRequired ?? false);
    } catch (err) {
      setGlobalError(`OCR extraction failed: ${err.message}`);
    } finally {
      setIsExtracting(false);
      setStep(STEP.FORM);
    }
  }, []);

  const handleFileUpload = useCallback(async (file) => {
    setGlobalError(null);
    setInputPath('file');
    setFileName(file.name.replace(/\.[^/.]+$/, ''));

    try {
      const { rows: periodRows, warnings } = await parseFile(file);
      const { rows, duplicateDates: dups } = expandPeriods(periodRows);
      setExpandedRows(rows);
      setParseWarnings(warnings);
      setDuplicateDates(dups);
      setDupConfirmed(dups.length === 0);
      setFormInitialValues(emptyFormState());
      setOcrConfidenceFlags([]);
      setOcrNotices([]);
      setSfRequired(false);
      setStep(STEP.FORM);
    } catch (err) {
      setGlobalError(`File parsing failed: ${err.message}`);
    }
  }, []);

  const handleManualEntry = useCallback(() => {
    setGlobalError(null);
    setInputPath('manual');
    setFileName('lease-schedule');
    setExpandedRows([]);
    setParseWarnings([]);
    setDuplicateDates([]);
    setDupConfirmed(true);
    setFormInitialValues(emptyFormState());
    setOcrConfidenceFlags([]);
    setOcrNotices([]);
    setSfRequired(false);
    setStep(STEP.SCHEDULE);
  }, []);

  const handleScheduleConfirm = useCallback((periodRows, warnings) => {
    setGlobalError(null);
    try {
      const { rows, duplicateDates: dups } = expandPeriods(periodRows);
      setExpandedRows(rows);
      setParseWarnings(warnings);
      setDuplicateDates(dups);
      setDupConfirmed(dups.length === 0);
      setStep(STEP.FORM);
    } catch (err) {
      setGlobalError(`Schedule parsing failed: ${err.message}`);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Form submit → processing
  // ---------------------------------------------------------------------------

  const handleFormSubmit = useCallback((form) => {
    setGlobalError(null);

    // Require duplicate confirmation before processing
    if (duplicateDates.length > 0 && !dupConfirmed) {
      setGlobalError('Please confirm the duplicate date warning before processing.');
      return;
    }

    // Validate schedule
    const scheduleErrors = validateSchedule(expandedRows);
    const paramErrors = validateParams(
      { ...form, sfRequired },
      expandedRows
    );
    const allErrors = [...scheduleErrors, ...paramErrors];
    setValidationErrors(allErrors);
    if (allErrors.length) return;

    setIsProcessing(true);
    try {
      const params = formToCalculatorParams(form);
      const rows = calculateAllCharges(expandedRows, params);
      setProcessedRows(rows);
      setProcessedParams(params);
      setStep(STEP.RESULTS);
    } catch (err) {
      setGlobalError(`Processing error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [expandedRows, duplicateDates, dupConfirmed, sfRequired]);

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
          {step !== STEP.UPLOAD && (
            <button
              onClick={() => {
                setStep(STEP.UPLOAD);
                setInputPath(null);
                setProcessedRows([]);
                setExpandedRows([]);
                setValidationErrors([]);
                setGlobalError(null);
                setDuplicateDates([]);
                setDupConfirmed(false);
              }}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              Start over
            </button>
          )}
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-6 py-8 space-y-8">
        {/* Global error */}
        {globalError && (
          <div className="rounded-md bg-red-50 border border-red-300 p-4 text-sm text-red-700">
            ⚠ {globalError}
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

        {/* Step: Schedule editor (manual entry / bulk paste) */}
        {step === STEP.SCHEDULE && (
          <ScheduleEditor
            onConfirm={handleScheduleConfirm}
            onBack={() => setStep(STEP.UPLOAD)}
          />
        )}

        {/* Step: Form */}
        {step === STEP.FORM && (
          <div className="space-y-4">
            {/* Parse warnings */}
            {parseWarnings.length > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-1">
                {parseWarnings.map((w, i) => (
                  <p key={i} className="text-sm text-amber-800">⚠ {w}</p>
                ))}
              </div>
            )}

            {/* Duplicate date warning (Flaw 5 fix) */}
            {duplicateDates.length > 0 && !dupConfirmed && (
              <div className="rounded-md bg-red-50 border border-red-300 p-4 space-y-2">
                <p className="text-sm font-semibold text-red-800">
                  ⚠ Duplicate period start dates detected in the uploaded schedule:
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

            <InputForm
              initialValues={formInitialValues}
              confidenceFlags={ocrConfidenceFlags}
              notices={ocrNotices}
              validationErrors={validationErrors}
              sfRequired={sfRequired}
              onSubmit={handleFormSubmit}
              onBack={() => setStep(STEP.UPLOAD)}
              isProcessing={isProcessing}
            />
          </div>
        )}

        {/* Step: Results */}
        {step === STEP.RESULTS && (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">Lease Schedule — {fileName}</h2>
              <ExportButton rows={processedRows} params={processedParams} filename={fileName} />
            </div>

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
