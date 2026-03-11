/**
 * UploadRouter
 * Presents two upload paths (Section 1):
 *   Path A — PDF upload → OCR extraction
 *   Path B — Structured file upload → direct form
 *
 * OCR limitation notices per Section 5 are shown at the point of upload.
 */

import { useRef, useState } from 'react';

const OCR_NOTICES = [
  'Scanned or image-based PDFs',
  'Image-heavy lease exhibits',
  'Rent escalation embedded in narrative legal prose (not a table)',
  'Non-standard or multi-column rent schedule layouts',
];

const STRUCTURED_FORMATS = '.xlsx, .xls, .csv, or a digitally generated (non-scanned) .pdf';

export default function UploadRouter({ onPDFUpload, onFileUpload, onManualEntry, isExtracting }) {
  const pdfRef = useRef(null);
  const fileRef = useRef(null);
  const [dragOver, setDragOver] = useState(null); // 'pdf' | 'file' | null

  function handleDrop(e, path) {
    e.preventDefault();
    setDragOver(null);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (path === 'pdf') onPDFUpload(file);
    else onFileUpload(file);
  }

  function handleFileChange(e, path) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (path === 'pdf') onPDFUpload(file);
    else onFileUpload(file);
    e.target.value = '';
  }

  const dropClass = (key) =>
    `border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors ${
      dragOver === key ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
    }`;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">DEODATE Lease Schedule</h1>
        <p className="mt-1 text-sm text-gray-500">
          Choose how to provide the rent schedule. Both paths converge into the same
          parameter form before processing begins.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Path A — PDF OCR */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold">A</span>
            <h2 className="font-semibold text-gray-800">PDF Upload with OCR</h2>
          </div>
          <p className="text-sm text-gray-600">
            Upload a raw lease PDF. The Anthropic API will extract rent schedule
            parameters and pre-fill the form. <strong>You must review and confirm
            all fields before processing.</strong>
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
            className={dropClass('pdf')}
            onDragOver={(e) => { e.preventDefault(); setDragOver('pdf'); }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => handleDrop(e, 'pdf')}
            onClick={() => !isExtracting && pdfRef.current?.click()}
          >
            <input
              ref={pdfRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => handleFileChange(e, 'pdf')}
            />
            <div className="text-center">
              <div className="text-4xl mb-2">📄</div>
              {isExtracting ? (
                <p className="text-sm text-blue-600 font-medium animate-pulse">Extracting via OCR…</p>
              ) : (
                <>
                  <p className="text-sm font-medium text-gray-700">Drop PDF here or click to browse</p>
                  <p className="text-xs text-gray-400 mt-1">Accepts: .pdf</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Path B — Structured file */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-600 text-white text-xs font-bold">B</span>
            <h2 className="font-semibold text-gray-800">Structured File Upload</h2>
          </div>
          <p className="text-sm text-gray-600">
            Upload a structured rent schedule file with Period Start, Period End,
            and Monthly Base Rent columns. Complete the parameter form manually.
            Bypasses OCR.
          </p>

          <div className="rounded-md bg-gray-50 border border-gray-200 p-3 text-xs text-gray-600">
            <p className="font-semibold mb-1">Accepted formats:</p>
            <p>{STRUCTURED_FORMATS}</p>
            <p className="mt-1">
              <strong>Note:</strong> PDF on this path must be a digitally generated
              (non-scanned) rent schedule exhibit. Scanned PDFs will fail to parse.
            </p>
          </div>

          <div
            className={dropClass('file')}
            onDragOver={(e) => { e.preventDefault(); setDragOver('file'); }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => handleDrop(e, 'file')}
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv,.pdf"
              className="hidden"
              onChange={(e) => handleFileChange(e, 'file')}
            />
            <div className="text-center">
              <div className="text-4xl mb-2">📊</div>
              <p className="text-sm font-medium text-gray-700">Drop file here or click to browse</p>
              <p className="text-xs text-gray-400 mt-1">Accepts: .xlsx, .xls, .csv, .pdf</p>
            </div>
          </div>
        </div>

        {/* Path C — Manual entry / bulk paste */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-violet-600 text-white text-xs font-bold">C</span>
            <h2 className="font-semibold text-gray-800">Manual Entry</h2>
          </div>
          <p className="text-sm text-gray-600">
            Type or paste a rent schedule directly. Accepts flexible period formats
            (<code className="text-xs bg-gray-100 px-1 rounded">3/1/18-2/28/19</code>,{' '}
            <code className="text-xs bg-gray-100 px-1 rounded">3/1/18</code>, etc.)
            and supports bulk paste from a lease PDF or Word doc.
          </p>

          <div className="rounded-md bg-gray-50 border border-gray-200 p-3 text-xs text-gray-600">
            <p className="font-semibold mb-1">Flexible input:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Date ranges with or without spaces around dash</li>
              <li>Two-digit years (18 → 2018, 28 → 2028)</li>
              <li>Single start date — end inferred from next row</li>
              <li>Asterisk (*) on rent flags potential abatement</li>
            </ul>
          </div>

          <button
            type="button"
            onClick={onManualEntry}
            className="rounded-lg border-2 border-dashed border-violet-300 hover:border-violet-500 hover:bg-violet-50 p-6 transition-colors text-center"
          >
            <div className="text-4xl mb-2">✏️</div>
            <p className="text-sm font-medium text-gray-700">Open schedule editor</p>
            <p className="text-xs text-gray-400 mt-1">Type rows or bulk paste a rent table</p>
          </button>
        </div>
      </div>
    </div>
  );
}
