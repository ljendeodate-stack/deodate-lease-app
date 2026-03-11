/**
 * ExportButton
 * Triggers XLSX (3-sheet, fully styled, with formulas) or CSV export.
 * params prop is forwarded to exportToXLSX for the assumptions block.
 */

import { exportToXLSX, exportToCSV } from '../utils/exportUtils.js';

export default function ExportButton({ rows = [], params = {}, filename = 'lease-schedule' }) {
  if (!rows.length) return null;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-sm text-gray-600 font-medium">Export:</span>

      <button
        onClick={() => exportToXLSX(rows, params, filename)}
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

      <span className="text-xs text-gray-400">
        Excel file opens in Google Sheets — upload to Google Drive or use File → Import
      </span>
    </div>
  );
}
