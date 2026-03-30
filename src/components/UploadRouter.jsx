import { useRef, useState } from 'react';

const EXTRACTION_NOTICES = [
  'Scanned or image-based PDFs',
  'Image-heavy lease exhibits',
  'Rent escalation embedded in narrative legal prose',
  'Non-standard or multi-column rent schedule layouts',
];

function StepBadge({ number }) {
  return (
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-accent/45 bg-accent/12 text-sm font-semibold text-accent">
      {number}
    </span>
  );
}

export default function UploadRouter({ onScanUpload, onManualEntry, isExtracting }) {
  const uploadRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(event) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) onScanUpload(file);
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    onScanUpload(file);
    event.target.value = '';
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <section className="surface-glass px-8 py-10">
        <div className="mt-4 max-w-3xl">
          <h1 className="text-4xl font-semibold leading-tight text-txt-primary sm:text-5xl">
            Lease Schedule Engine
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-txt-muted">
            Build a lease schedule from a lease file, schedule file, or unstructured notes. File-based intake routes through the same review, calculation, and export flow.
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
              Upload a lease PDF, schedule file, or narrative notes file. Native-text uploads route through text extraction, while scanned PDFs add OCR before the same downstream review.
            </p>
          </div>

          <div className="px-6 py-6">
            <div className="rounded-3xl border border-status-warn-border bg-status-warn-bg/75 p-4">
              <p className="font-display text-sm font-semibold text-status-warn-title">
                Reduced extraction reliability for:
              </p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-status-warn-text">
                {EXTRACTION_NOTICES.map((notice) => (
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
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => !isExtracting && uploadRef.current?.click()}
            >
              <input
                ref={uploadRef}
                type="file"
                accept=".pdf,.docx,.txt,.xlsx,.xls,.csv"
                className="hidden"
                onChange={handleFileChange}
              />
              <div className="mx-auto max-w-md text-center">
                <p className="section-kicker">{isExtracting ? 'Extraction In Progress' : 'Drop Zone'}</p>
                <p className="mt-3 font-display text-2xl font-semibold text-txt-primary">
                  {isExtracting ? 'Extracting lease structure...' : 'Drop file here or click to browse'}
                </p>
                <p className="mt-3 text-sm text-txt-muted">
                  Accepts .pdf, .docx, .txt, .xlsx, .xls, and .csv. Review still happens before processing.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="surface-panel px-6 py-6">
          <div className="flex items-center gap-4">
            <StepBadge number="2" />
            <div>
              <p className="section-kicker">Direct Entry</p>
              <h2 className="mt-1 text-xl font-semibold text-txt-primary">Input Schedule</h2>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-txt-muted">
            Type, paste, or generate the rent schedule directly. Use this path when you want to build or correct the schedule manually before lease assumptions are finalized.
          </p>
          <div className="mt-5 space-y-3">
            <button
              type="button"
              onClick={onManualEntry}
              className="btn-secondary w-full"
            >
              Open Schedule Editor
            </button>
            <p className="text-xs text-txt-dim">
              Manual entry supports quick entry, bulk paste, and direct schedule editing only.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
