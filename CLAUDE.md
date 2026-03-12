# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

### Two input paths

- **Path A (PDF)**: `UploadRouter` → `extractFromPDF()` (Anthropic/OpenAI OCR) → form pre-fill → `InputForm` → calculator
- **Path B (structured file)**: `UploadRouter` → `parseFile()` (SheetJS / PapaParse) → blank form → `InputForm` → calculator
- **Path C (manual)**: `UploadRouter` → `ScheduleEditor` (row-by-row or bulk paste entry) → `InputForm` → calculator

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
