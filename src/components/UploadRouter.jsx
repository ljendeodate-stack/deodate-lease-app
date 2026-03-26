/**
 * UploadRouter
 * Presents three intake options:
 *   1. Scan Lease - PDF upload -> OCR extraction
 *   2. Input Schedule - routes to ScheduleEditor (manual entry / file upload)
 *   3. Download Blank Excel Template - static download
 */

import { useRef, useState } from 'react';

const OCR_NOTICES = [
  'Scanned or image-based PDFs',
  'Image-heavy lease exhibits',
  'Rent escalation embedded in narrative legal prose (not a table)',
  'Non-standard or multi-column rent schedule layouts',
];

function StepBadge({ number, muted = false }) {
  return (
    <span className={`inline-flex h-10 w-10 items-center justify-center rounded-full border text-sm font-semibold ${
      muted
        ? 'border-app-border text-txt-dim'
        : 'border-accent/45 bg-accent/12 text-accent'
    }`}>
      {number}
    </span>
  );
}

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
    <div className="mx-auto max-w-4xl space-y-8">
      <section className="surface-glass px-8 py-10">
        <p className="section-kicker">Institutional Lease Review</p>
        <div className="mt-4 max-w-3xl">
          <h1 className="text-4xl font-semibold leading-tight text-txt-primary sm:text-5xl">
            Build a lease schedule from scan, schedule input, or template.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-txt-muted">
            Choose the intake path that matches the document you have today.
            Every path converges into the same review flow, calculations, and export package.
          </p>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <section className="surface-panel overflow-hidden">
          <div className="border-b border-app-border px-6 py-5">
            <div className="flex items-center gap-4">
              <StepBadge number="1" />
              <div>
                <p className="section-kicker">Preferred Path</p>
                <h2 className="mt-1 text-2xl font-semibold text-txt-primary">Scan Lease</h2>
              </div>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-txt-muted">
              Upload a raw lease PDF and extract the rent schedule draft through OCR.
              The system pre-fills the review flow, but human confirmation is still required before processing.
            </p>
          </div>

          <div className="px-6 py-6">
            <div className="rounded-3xl border border-status-warn-border bg-status-warn-bg/75 p-4">
              <p className="font-display text-sm font-semibold text-status-warn-title">
                Reduced extraction reliability for:
              </p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-status-warn-text">
                {OCR_NOTICES.map((notice) => (
                  <li key={notice}>{notice}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs uppercase tracking-[0.2em] text-status-warn-title/80">
                Manual review remains recommended.
              </p>
            </div>

            <div
              className={`mt-5 rounded-[2rem] border border-dashed px-6 py-12 transition-all ${
                dragOver
                  ? 'border-accent bg-accent/10 shadow-accent'
                  : 'border-app-border-strong bg-app-chrome/70 hover:border-accent/45 hover:bg-app-panel-strong'
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
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
              <div className="mx-auto max-w-md text-center">
                <p className="section-kicker">{isExtracting ? 'OCR in Progress' : 'Drop Zone'}</p>
                <p className="mt-3 font-display text-2xl font-semibold text-txt-primary">
                  {isExtracting ? 'Extracting lease structure...' : 'Drop PDF here or click to browse'}
                </p>
                <p className="mt-3 text-sm text-txt-muted">
                  Accepts PDF lease files. OCR only prepares the draft; review happens in the next steps.
                </p>
              </div>
            </div>
          </div>
        </section>

        <div className="space-y-5">
          <section className="surface-panel px-6 py-6">
            <div className="flex items-center gap-4">
              <StepBadge number="2" />
              <div>
                <p className="section-kicker">Direct Entry</p>
                <h2 className="mt-1 text-xl font-semibold text-txt-primary">Input Schedule</h2>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-txt-muted">
              Type, paste, or generate the rent schedule directly. Supports quick entry, bulk paste,
              and structured uploads with the same downstream results.
            </p>
            <button
              type="button"
              onClick={onManualEntry}
              className="btn-secondary mt-5 w-full"
            >
              Open Schedule Editor
            </button>
          </section>

          <section className="surface-panel px-6 py-6">
            <div className="flex items-center gap-4">
              <StepBadge number="3" muted />
              <div>
                <p className="section-kicker">Offline Prep</p>
                <h2 className="mt-1 text-xl font-semibold text-txt-primary">Download Blank Template</h2>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-txt-muted">
              Download the blank workbook with the correct sheet structure and assumptions block,
              then complete it offline in Excel or Google Sheets.
            </p>
            <a
              href="/deodate-lease-template.xlsx"
              download
              className="btn-ghost mt-5 w-full"
            >
              Download Template (.xlsx)
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}
