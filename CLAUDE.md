# CLAUDE.md — deodate-lease-app

## Project overview
**DEODATE Lease Schedule Engine** — a React single-page application that processes commercial lease documents and produces a monthly charge ledger. Users upload a PDF lease or structured file (CSV/Excel), review OCR-extracted data, fill in NNN/CAM charge parameters, and export a finalized schedule.

## Tech stack
- **React 18** with functional components and hooks
- **Vite** for dev server and bundling
- **Tailwind CSS** for styling
- **pdfjs-dist** for PDF text extraction (OCR path)
- **papaparse** for CSV parsing
- **xlsx-js-style** for Excel parsing and export

## Project structure
```
src/
  App.jsx                  # Root component; owns all step state and pipeline
  components/
    UploadRouter.jsx        # Step 1: PDF / file / manual entry chooser
    ScheduleEditor.jsx      # Step 2 (manual path): bulk-paste rent schedule editor
    InputForm.jsx           # Step 2/3: NNN charge parameter form
    ValidationBanner.jsx    # Inline validation error display
    LedgerTable.jsx         # Results: monthly ledger with expandable trace rows
    SummaryPanel.jsx        # Results: totals summary
    ExportButton.jsx        # Excel/CSV export trigger
  engine/
    calculator.js           # Core charge calculation logic
    expander.js             # Expand period rows to monthly rows
    parser.js               # Structured file parser (CSV/Excel)
    validator.js            # Parameter and schedule validation
    yearMonth.js            # Date parsing utilities (parseMDYStrict, parseExcelDate)
  ocr/
    extractor.js            # PDF text extraction and field parsing
  utils/
    dateUtils.js
    formatUtils.js
    exportUtils.js
```

## Processing pipeline
1. **Upload** — user picks PDF, structured file, or manual entry
2. **OCR extraction** (PDF path) — `extractor.js` pulls rent schedule + NNN fields
3. **Schedule editor** (manual path) — user pastes/types period rows
4. **Form** — user reviews/edits NNN parameters pre-populated from OCR
5. **Processing** — `calculator.js` runs on confirmed form data (never auto-triggered)
6. **Results** — ledger table + summary panel + export

## Dev commands
```bash
npm run dev      # start Vite dev server
npm run build    # production build
npm run preview  # preview production build
```

## Key conventions
- Processing is **never triggered automatically** — the user must explicitly confirm the form.
- OCR confidence flags highlight pre-filled fields that need user review.
- NNN charges support two modes: `individual` (CAM/insurance/taxes separately) or `aggregate` (single monthly estimate).
- Duplicate period start dates are surfaced and require explicit user confirmation before processing proceeds.
