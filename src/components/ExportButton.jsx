/**
 * ExportButton
 * Triggers XLSX (3-sheet, fully styled, with formulas), CSV, or Review Memo export.
 * params prop is forwarded to exportToXLSX for the assumptions block.
 */

import { exportToXLSX, exportToCSV } from '../utils/exportUtils.js';
import { generateReviewMemo } from '../utils/reviewDocGenerator.js';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

export default function ExportButton({
  rows = [],
  params = {},
  filename = 'lease-schedule',
  confidenceResult = null,
  fieldCategories = null,
  plausibilityIssues = [],
  validationWarnings = [],
}) {
  if (!rows.length) return null;

  async function handleReviewMemo() {
    const leaseStart = rows.length > 0 ? rows[0].date : null;
    const leaseEnd = rows.length > 0 ? rows[rows.length - 1].date : null;

    const blob = await generateReviewMemo({
      leaseName: params.leaseName || filename,
      leaseStart,
      leaseEnd,
      squareFootage: params.squareFootage || 0,
      totalMonths: rows.length,
      confidenceResult,
      fieldCategories,
      plausibilityIssues,
      validationWarnings,
      nnnMode: params.nnnMode || 'individual',
      generatedDate: new Date().toLocaleDateString('en-US'),
    });

    downloadBlob(blob, `${filename}-review-memo.docx`);
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-sm text-gray-600 font-medium">Export:</span>

      <button
        onClick={() => void exportToXLSX(rows, params, filename)}
        className="rounded-md bg-emerald-600 text-white px-4 py-2 text-sm font-semibold hover:bg-emerald-700 transition-colors"
        title="3-sheet workbook: Lease Schedule (assumptions block + live formulas), Annual Summary (SUMIF formulas), Audit Trail. Opens in Excel and Google Sheets."
      >
        ↓ Excel / Google Sheets
      </button>

      <button
        onClick={() => exportToCSV(rows, filename)}
        className="rounded-md bg-gray-500 text-white px-4 py-2 text-sm font-semibold hover:bg-gray-600 transition-colors"
        title="Plain CSV — standard columns only, raw numeric values."
      >
        ↓ CSV
      </button>

      <button
        onClick={() => void handleReviewMemo()}
        className="rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-semibold hover:bg-blue-700 transition-colors"
        title="1-page Word document summarizing extraction confidence, plausibility checks, and items requiring manual review."
      >
        ↓ Review Memo
      </button>

      <span className="text-xs text-gray-400">
        Excel file opens in Google Sheets — upload to Google Drive or use File → Import
      </span>
    </div>
  );
}
