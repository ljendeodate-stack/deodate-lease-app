/**
 * @fileoverview Multi-format rent schedule file parser.
 *
 * Replicates and extends n8n node: "Read XLSX Spreadsheet"
 * Fixes Flaw 1: accepts .xlsx, .xls, .csv, and structured .pdf (not just .xlsx).
 *
 * All parsers return a normalised array of period rows:
 *   { periodStart: Date, periodEnd: Date, monthlyRent: number }
 *
 * No UI dependencies. All functions are pure given the same binary/text input.
 */

import XLSX from 'xlsx-js-style';
import Papa from 'papaparse';
import { parseExcelDate, toISOLocal } from './yearMonth.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to find columns for period start, period end, and monthly rent
 * from a sheet's header row, using fuzzy matching.
 *
 * @param {string[]} headers
 * @returns {{ startCol: string, endCol: string, rentCol: string }}
 */
function detectColumns(headers) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

  const startPatterns = ['periodstart', 'startdate', 'start', 'commencement', 'from', 'leasestart'];
  const endPatterns = ['periodend', 'enddate', 'end', 'expiry', 'expiration', 'to', 'leaseend'];
  const rentPatterns = ['monthlybaserent', 'monthlyrent', 'baserent', 'rent', 'monthly'];

  const find = (patterns) =>
    headers.find((h) => patterns.some((p) => norm(h).includes(p))) ?? null;

  return {
    startCol: find(startPatterns),
    endCol: find(endPatterns),
    rentCol: find(rentPatterns),
  };
}

/**
 * Normalise raw row objects (from any parser) into period-row structs.
 * Requires periodStart, periodEnd, monthlyRent to be resolvable.
 *
 * @param {Object[]} rawRows - Array of plain objects with string/number values.
 * @param {{ startCol: string, endCol: string, rentCol: string }} cols
 * @returns {{ periodStart: Date, periodEnd: Date, monthlyRent: number }[]}
 */
function normaliseRows(rawRows, cols) {
  const result = [];
  for (const row of rawRows) {
    const startVal = row[cols.startCol];
    const endVal = row[cols.endCol];
    const rentVal = row[cols.rentCol];

    const periodStart = parseExcelDate(startVal);
    const periodEnd = parseExcelDate(endVal);
    const monthlyRent = Number(rentVal);

    if (!periodStart || !periodEnd) continue;
    if (isNaN(monthlyRent)) continue;

    result.push({ periodStart, periodEnd, monthlyRent });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public parsers
// ---------------------------------------------------------------------------

/**
 * Parse an XLSX or XLS file buffer into period rows.
 *
 * @param {ArrayBuffer} buffer - Raw file bytes.
 * @returns {{ rows: { periodStart: Date, periodEnd: Date, monthlyRent: number }[], warnings: string[] }}
 *
 * @n8nNode "Read XLSX Spreadsheet" (extended to also handle .xls)
 */
export function parseXLSX(buffer) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  } catch (e) {
    return { rows: [], warnings: [`Could not read spreadsheet: ${e.message}`] };
  }

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    return { rows: [], warnings: ['Spreadsheet contains no sheets.'] };
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  if (!rawRows.length) return { rows: [], warnings: ['Spreadsheet appears to be empty.'] };

  const headers = Object.keys(rawRows[0]);
  const cols = detectColumns(headers);

  const warnings = [];
  if (!cols.startCol) warnings.push('Could not detect a "Period Start" column. Check column headers.');
  if (!cols.endCol) warnings.push('Could not detect a "Period End" column. Check column headers.');
  if (!cols.rentCol) warnings.push('Could not detect a "Monthly Base Rent" column. Check column headers.');

  if (!cols.startCol || !cols.endCol || !cols.rentCol) {
    return { rows: [], warnings };
  }

  const rows = normaliseRows(rawRows, cols);
  return { rows, warnings };
}

/**
 * Parse a CSV text string or ArrayBuffer into period rows.
 *
 * @param {string|ArrayBuffer} input - CSV text or raw bytes.
 * @returns {{ rows: { periodStart: Date, periodEnd: Date, monthlyRent: number }[], warnings: string[] }}
 *
 * @n8nNode "Read XLSX Spreadsheet" (extended to support CSV — Flaw 1 fix)
 */
export function parseCSV(input) {
  const text =
    typeof input === 'string'
      ? input
      : new TextDecoder().decode(input);

  const result = Papa.parse(text, { header: true, skipEmptyLines: true });

  if (result.errors.length) {
    const msgs = result.errors.map((e) => `Row ${e.row}: ${e.message}`);
    return { rows: [], warnings: msgs };
  }

  const rawRows = result.data;
  if (!rawRows.length) return { rows: [], warnings: ['CSV appears to be empty.'] };

  const headers = Object.keys(rawRows[0]);
  const cols = detectColumns(headers);

  const warnings = [];
  if (!cols.startCol) warnings.push('Could not detect a "Period Start" column in CSV.');
  if (!cols.endCol) warnings.push('Could not detect a "Period End" column in CSV.');
  if (!cols.rentCol) warnings.push('Could not detect a "Monthly Base Rent" column in CSV.');

  if (!cols.startCol || !cols.endCol || !cols.rentCol) {
    return { rows: [], warnings };
  }

  const rows = normaliseRows(rawRows, cols);
  return { rows, warnings };
}

/**
 * Extract text from a structured (digitally generated) PDF and parse it as
 * a rent schedule. Uses pdfjs-dist for text extraction. Falls back gracefully
 * if no tabular data is detected.
 *
 * NOTE: pdfjs-dist must have its worker configured before this is called.
 * In the app entry point: pdfjsLib.GlobalWorkerOptions.workerSrc = ...
 *
 * @param {ArrayBuffer} buffer - Raw PDF bytes.
 * @returns {Promise<{ rows: { periodStart: Date, periodEnd: Date, monthlyRent: number }[], warnings: string[] }>}
 *
 * @n8nNode "Read XLSX Spreadsheet" (extended to support structured PDF — Flaw 1 fix)
 */
export async function parsePDF(buffer) {
  let pdf;
  try {
    // Dynamic import to avoid bundling issues if pdfjs isn't configured yet
    const pdfjsLib = await import('pdfjs-dist');
    const loadingTask = pdfjsLib.getDocument({ data: buffer });
    pdf = await loadingTask.promise;
  } catch (e) {
    return {
      rows: [],
      warnings: [
        `Could not read PDF: ${e.message}. ` +
        'The file may be encrypted, corrupted, or unsupported. Try uploading an XLSX or CSV instead.',
      ],
    };
  }

  const allLines = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    // Group items by approximate vertical position (y coordinate) to reconstruct rows
    const itemsByY = new Map();
    for (const item of textContent.items) {
      const y = Math.round(item.transform[5]);
      if (!itemsByY.has(y)) itemsByY.set(y, []);
      itemsByY.get(y).push(item);
    }

    // Sort y descending (top of page first) and collect lines
    const sortedYs = Array.from(itemsByY.keys()).sort((a, b) => b - a);
    for (const y of sortedYs) {
      const lineItems = itemsByY.get(y).sort((a, b) => a.transform[4] - b.transform[4]);
      const lineText = lineItems.map((i) => i.str.trim()).filter(Boolean).join('\t');
      if (lineText) allLines.push(lineText);
    }
  }

  // Attempt to parse the extracted text as TSV (tab-separated)
  const csvText = allLines.join('\n');
  const result = Papa.parse(csvText, { header: true, delimiter: '\t', skipEmptyLines: true });
  const rawRows = result.data;

  if (!rawRows.length) {
    return {
      rows: [],
      warnings: [
        'No structured table data could be extracted from this PDF. ' +
        'This may be a scanned or image-based PDF — use the OCR path or upload an XLSX/CSV instead.',
      ],
    };
  }

  const headers = Object.keys(rawRows[0]);
  const cols = detectColumns(headers);

  const warnings = [];
  if (!cols.startCol || !cols.endCol || !cols.rentCol) {
    warnings.push(
      'PDF text extracted but rent schedule columns could not be identified. ' +
      'Consider converting to XLSX or CSV for reliable parsing.'
    );
    return { rows: [], warnings };
  }

  const rows = normaliseRows(rawRows, cols);
  if (!rows.length) {
    warnings.push('PDF columns were identified but no valid date/rent rows could be parsed.');
  }
  return { rows, warnings };
}

/**
 * Route a File object to the correct parser based on its extension.
 *
 * @param {File} file - Browser File object.
 * @returns {Promise<{ rows: { periodStart: Date, periodEnd: Date, monthlyRent: number }[], warnings: string[] }>}
 */
export async function parseFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const buffer = await file.arrayBuffer();

  switch (ext) {
    case 'xlsx':
    case 'xls':
      return parseXLSX(buffer);
    case 'csv':
      return parseCSV(buffer);
    case 'pdf':
      return parsePDF(buffer);
    default:
      return {
        rows: [],
        warnings: [`Unsupported file type ".${ext}". Please upload .xlsx, .xls, .csv, or .pdf.`],
      };
  }
}

/**
 * Convert a normalised period row to a plain display object for debugging.
 *
 * @param {{ periodStart: Date, periodEnd: Date, monthlyRent: number }} row
 * @returns {{ periodStart: string, periodEnd: string, monthlyRent: number }}
 */
export function periodRowToDisplay(row) {
  return {
    periodStart: toISOLocal(row.periodStart),
    periodEnd: toISOLocal(row.periodEnd),
    monthlyRent: row.monthlyRent,
  };
}
