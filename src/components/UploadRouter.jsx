/**
 * UploadRouter
 * Presents three intake options:
 *   1. Scan Lease — PDF upload → OCR extraction
 *   2. Input Schedule — routes to ScheduleEditor (manual entry / file upload)
 *   3. Download Blank Excel Template — static download
 */

import { useRef, useState } from 'react';

const OCR_NOTICES = [
  'Scanned or image-based PDFs',
  'Image-heavy lease exhibits',
  'Rent escalation embedded in narrative legal prose (not a table)',
  'Non-standard or multi-column rent schedule layouts',
];

export default function UploadRouter({ onPDFUpload, onFileUpload, onManualEntry, isExtracting }) {
  const pdfRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onPDFUpload(file);
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    onPDFUpload(file);
    e.target.value = '';
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">DEODATE Lease Schedule</h1>
        <p className="mt-1 text-sm text-gray-500">
          Choose how to begin. All paths produce the same output package.
        </p>
      </div>

      <div className="space-y-5">
        {/* Option 1 — Scan Lease */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold">1</span>
            <h2 className="text-lg font-semibold text-gray-800">Scan Lease</h2>
          </div>
          <p className="text-sm text-gray-600">
            Upload a raw lease PDF. The system will extract rent schedule parameters via OCR
            and pre-fill the form. <strong>You must review and confirm all fields before processing.</strong>
          </p>

          {/* OCR limitation notice */}
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
            <p className="font-semibold mb-1">Reduced extraction reliability for:</p>
            <ul className="list-disc list-inside space-y-0.5">
              {OCR_NOTICES.map((n) => <li key={n}>{n}</li>)}
            </ul>
            <p className="mt-1">In these cases, manual field review is strongly recommended.</p>
          </div>

          <div
            className={`border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors ${
              dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !isExtracting && pdfRef.current?.click()}
          >
            <input
              ref={pdfRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="text-center">
              {isExtracting ? (
                <p className="text-sm text-blue-600 font-medium animate-pulse">Extracting via OCR...</p>
              ) : (
                <>
                  <p className="text-sm font-medium text-gray-700">Drop PDF here or click to browse</p>
                  <p className="text-xs text-gray-400 mt-1">Accepts: .pdf</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Option 2 — Input Schedule */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-emerald-600 text-white text-sm font-bold">2</span>
            <h2 className="text-lg font-semibold text-gray-800">Input Schedule</h2>
          </div>
          <p className="text-sm text-gray-600">
            Type, paste, or upload a rent schedule directly. Supports Quick Entry (4 fields),
            bulk paste from a lease document, or structured file upload (CSV/XLSX).
          </p>
          <button
            type="button"
            onClick={onManualEntry}
            className="w-full rounded-lg border-2 border-dashed border-emerald-300 hover:border-emerald-500 hover:bg-emerald-50 p-4 transition-colors text-center"
          >
            <p className="text-sm font-medium text-gray-700">Open schedule editor</p>
            <p className="text-xs text-gray-400 mt-1">Quick Entry, manual rows, bulk paste, or file upload</p>
          </button>
        </div>

        {/* Option 3 — Download Blank Template */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gray-500 text-white text-sm font-bold">3</span>
            <h2 className="text-lg font-semibold text-gray-800">Download Blank Excel Template</h2>
          </div>
          <p className="text-sm text-gray-600">
            Download an empty template with the correct sheet structure, headers, and assumptions block.
            Fill it out offline in Excel or Google Sheets.
          </p>
          <a
            href="/deodate-lease-template.xlsx"
            download
            className="inline-block rounded-md bg-gray-100 border border-gray-300 text-gray-700 px-4 py-2 text-sm font-semibold hover:bg-gray-200 transition-colors"
          >
            Download Template (.xlsx)
          </a>
        </div>
      </div>
    </div>
  );
}
