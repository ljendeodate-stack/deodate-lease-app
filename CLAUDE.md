# CLAUDE.md — deodate-lease-app

## Style

## Global Rules (CRITICAL: Follow always)
- Concise: Code diffs only. No explanations, line-by-line logs, or summaries, unless requested.
- No progress reports or chit-chat. Output: edited files + 1-line commit msg, unless requested.
- Skip verbose thinking; act directly.
- Workflow: Edit → test → commit. No status updates, unless requested.

On compact: Preserve only code changes/tests. Drop explanations.

## Quality Standards (DEODATE)

All work on this project must prioritize **institutional-quality, decision-grade output**.

**Non-negotiable guardrails:**
- Do not introduce math, unit, or logic errors. Maintain internal consistency and tie-outs.
- Do not use ambiguous timing. Use specific as-of dates and effective dates.
- Do not make unsupported conclusions. State assumptions, limitations, and evidentiary basis.
- Preserve existing lease calculation logic unless a change is strictly required.
- Do not silently alter parser assumptions or remove useful output.

**Tone:**
- Use calibrated language (indicates, supports, consistent with) — avoid overstatement of certainty.
- Avoid emojis, slang, filler, and casual phrasing.
- Keep formatting clean and scannable — prefer bullets and tables over long prose blocks.

**Vocabulary defaults:**
- Replace `~` with `approx.`
- Replace `prove/proof` with `support/indicates/consistent with`
- Replace `guarantee` with `target/expectation/objective`
- Replace `we will` with `we plan to/intend to/expect to`

See `IMPLEMENTATION_PLAN.md` for any major feature changes or refactoring tasks.

## Project overview
**DEODATE Lease Schedule Engine** — a React single-page application that processes commercial lease documents and produces a monthly charge ledger. Users upload a PDF lease or structured file (CSV/Excel), review OCR-extracted data, fill in NNN/CAM charge parameters, and export a finalized schedule.

## Tech stack
- **React 18** with functional components and hooks
- **Vite** for dev server and bundling
- **Tailwind CSS** for styling
- **pdfjs-dist** for PDF text extraction (OCR path)
- **papaparse** for CSV parsing
- **xlsx-js-style** for Excel parsing and export
- **docx** for Word document (.docx) generation

## Project structure
```
src/
  App.jsx                  # Root component; owns all step state and pipeline
  components/
    UploadRouter.jsx        # Step 1: Three intake options (Scan, Input Schedule, Download Template)
    ScheduleEditor.jsx      # Step 2 (manual path): Quick Entry, manual rows, bulk paste, or file upload
    InputForm.jsx           # Step 2/3: NNN charge parameter form
    ValidationBanner.jsx    # Inline validation error display
    LedgerTable.jsx         # Results: monthly ledger with expandable trace rows
    SummaryPanel.jsx        # Results: totals summary
    ExportButton.jsx        # Results: triggers Excel, Word doc, or CSV export
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
    exportUtils.js              # XLSX and CSV export (now contains fixed Annual Summary builder)
    leaseDocGenerator.js        # Word document (.docx) generation with lease-specific guidance
    mdFormatter.js              # Markdown document builder (institutional style)
```

## Commands
```bash
npm run dev       # start Vite dev server (http://localhost:5173)
npm run build     # production build → dist/
npm run preview   # serve the production build locally
```

There is no test runner and no lint script configured.

## Environment

Create `.env` in the project root:

```
VITE_ANTHROPIC_API_KEY=sk-ant-...        # primary OCR provider (required for PDF path)
VITE_OPENAI_API_KEY=sk-...               # optional fallback OCR provider
VITE_OCR_PROVIDER=anthropic              # 'anthropic' (default) or 'openai'
VITE_OPENAI_OCR_MODEL=gpt-4o            # optional; only used when provider is openai
```

`VITE_ANTHROPIC_API_KEY` is only ever read in `src/ocr/extractor.js`. Accessing it anywhere else is a security boundary violation.

## Architecture

### Application flow (steps)

```
UPLOAD → (optional: SCHEDULE editor) → FORM → RESULTS
```

`App.jsx` is the sole state orchestrator. It owns all state and passes callbacks down. **Processing never triggers automatically** — the user must explicitly click "Confirm & Process" in `InputForm` before `calculator.js` runs.

### Input paths

1. **Scan Lease** — user uploads PDF; OCR extraction via `extractor.js` pre-fills form
2. **Input Schedule** — user enters schedule via `ScheduleEditor` (Quick Entry, manual rows, bulk paste, or file upload)
3. **Download Template** — static `.xlsx` file download (no processing)

Two processing paths (Scan and Input Schedule both converge):
- **Scan path**: `UploadRouter` → `handlePDFUpload()` → `extractFromPDF()` → `ScheduleEditor` (pre-populated) → `InputForm` → `calculator.js` → Results
- **Input path**: `UploadRouter` → `onManualEntry()` → `ScheduleEditor` (empty or file-loaded) → `InputForm` → `calculator.js` → Results

Both converge at Results with identical output structure: `processedRows[]` + `processedParams` + `leaseMetadata`.

Template download is isolated: no form, no processing, direct browser download.

### Engine pipeline (pure functions, no UI deps)

```
parser.js / periodParser.js
    ↓  { periodStart, periodEnd, monthlyRent }[]
expander.js (expandPeriods)
    ↓  { date, periodEnd, monthlyRent, 'Month #', 'Year #' }[]
validator.js (validateSchedule + validateParams)
    ↓  ValidationError[]
calculator.js (calculateAllCharges)
    ↓  processedRows[]   (all charge fields + remaining balances)
exportUtils.js (exportToXLSX / exportToCSV)
```

All engine files are pure — no imports from React, DOM, or components.

### Calculator two-pass model (`src/engine/calculator.js`)

- **Pass 1 (forward)**: per-row charges — `periodFactor`, `baseRentProrationFactor`, `isChargeActive`, `yearsSinceStart`, all NNN amounts, one-time item amounts, `totalMonthlyObligation`
- **Pass 2 (reverse, last→first)**: remaining balance accumulation — `totalObligationRemaining`, `totalBaseRentRemaining`, `totalNNNRemaining`, `totalOtherChargesRemaining`

**NNN classification** (critical):
- `totalNNN` (col L in export) = CAMS + Insurance + Taxes **only**
- Security + Other Items + one-time items = `totalOtherChargesAmount` (Other Charges bucket)

### One-time items pipeline

One-time items (`{ label, date, amount }`) flow: `InputForm` form state → `formToCalculatorParams()` (App.jsx) → `calculateAllCharges()` → `row.oneTimeItemAmounts: { [label]: amount }` on each row. The export derives `otLabels` by scanning all rows for non-zero `oneTimeItemAmounts` entries — **not** from `params.oneTimeItems`. This makes the export robust against params not flowing through.

### XLSX export column layout (`src/utils/exportUtils.js`)

Columns are dynamically indexed because one-time item columns are inserted between col L (Total NNN) and Total Monthly Obligation:

```
A–L  (cols 0–11): fixed base columns
M…   (cols 12…12+otCount-1): one OT column per unique label (blue hardcoded)
+0   Total Monthly Obligation (formula: F+L+J+K+[OT cols])
+1   Effective $/SF
+2   Obligation Remaining  (tail-SUM of TotalMonthly)
+3   Base Rent Remaining   (tail-SUM of F)
+4   NNN Remaining         (tail-SUM of L)
+5   Other Charges Remaining (SUM(J tail)+SUM(K tail)+SUM each OT col tail)
```

All indices downstream of `OT_START` are computed as offsets from `OT_START + otCount`. Never hardcode column letters for the tail columns.

### Cell colour convention (XLSX)

- **Blue font (`fcInput`)** = hardcoded user input values (incl. one-time event cells and assumption inputs)
- **Black font (`fcCalc` / `cFmla`)** = formula outputs or engine-calculated values
- **Dark-green font (`fcCrossSheet`)** = cross-sheet SUMIF formulas (Annual Summary tab)
- Red-pink fill = NNN / obligation columns (F–L)
- Amber fill = abatement period rows

### Date handling

All dates inside the engine are `Date` objects at **midnight local time**. ISO strings (`YYYY-MM-DD`) are used for storage on row objects (`row.date`, `row.periodStart`, `row.periodEnd`). User-facing dates are `MM/DD/YYYY`. Use `parseMDYStrict` for user input, `parseISODate` for ISO strings, `parseExcelDate` for SheetJS cell values.

### `abatementEndDate` convention

The abatement end date is the **last day of abatement (inclusive)**. Full rent begins the following day. A row is amber (`isAbatementRow`) only when its entire period falls on or before the abatement end date; boundary months are not amber.

## Key conventions
- Processing is **never triggered automatically** — the user must explicitly confirm the form.
- OCR confidence flags highlight pre-filled fields that need user review.
- NNN charges support two modes: `individual` (CAM/insurance/taxes separately) or `aggregate` (single monthly estimate).
- Duplicate period start dates are surfaced and require explicit user confirmation before processing proceeds.
- Abatement percentage uses a **0–100 scale**: 100 = full abatement (tenant pays $0), 50 = half, 0 = none.
- Quick Entry mode generates annual escalation periods from commencement date, expiration date, Year 1 rent, and escalation rate.

## Reference files
- `reference/LEASE_INPUT_SPEC.md` — canonical input field reference with format specs and mapping table
- `reference/LEASE_OUTPUT_TABLES_INSTRUCTIONS.md` — Obligation Remaining, Buyout, and Renegotiation panel implementation spec
- `reference/lease_output_template_ref1.xlsx` — Excel template reference (confidential, gitignored)
