/**
 * ExportButton
 * Triggers XLSX (3-sheet, fully styled, with formulas), CSV, or Review Memo export.
 * params prop is forwarded to exportToXLSX for the assumptions block.
 */

import { exportToXLSX, exportToCSV } from '../utils/exportUtils.js';
import { generateLeaseDoc } from '../utils/leaseDocGenerator.js';

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
  leaseMetadata = null,
}) {
  if (!rows.length) return null;

  async function handleLeaseDoc() {
    try {
      const blob = await generateLeaseDoc(rows, params, leaseMetadata ?? {});
      downloadBlob(blob, `${filename}-lease-review.docx`);
    } catch (err) {
      console.error('Word export failed:', err);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="section-kicker !tracking-[0.22em]">Export</span>

      <button
        onClick={() => void exportToXLSX(rows, params, filename)}
        className="btn-primary"
        title="3-sheet workbook: Lease Schedule, Annual Summary, and Audit Trail."
      >
        Excel / Google Sheets
      </button>

      <button
        onClick={() => exportToCSV(rows, params, filename)}
        className="btn-secondary"
        title="Plain CSV with standard columns and raw numeric values."
      >
        CSV
      </button>

      <button
        onClick={() => void handleLeaseDoc()}
        className="btn-ghost"
        title="Word document with lease overview, assumptions, warnings, and workbook guidance."
      >
        Lease Review Doc
      </button>

      <span className="text-xs text-txt-dim">
        Excel can be opened in Google Sheets after upload to Drive or via File &gt; Import.
      </span>
    </div>
  );
}
