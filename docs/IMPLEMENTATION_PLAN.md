# DEODATE Lease Schedule Engine — Implementation Plan

**Prepared by:** DEODATE
**As-of:** March 20, 2026
**Status:** Plan mode only. No code changes authorized.

---

## A. Executive Summary

The lease schedule app currently presents three intake paths (PDF OCR, structured file upload, manual entry) that converge into a shared calculation pipeline, producing an Excel export and on-screen ledger. Two issues require resolution, and one new capability must be added:

1. **Excel export is broken.** A `ReferenceError: assumpBorder is not defined` crash occurs every time a user clicks the Excel export button. A second layer of failures exists in the Annual Summary sheet builder (undefined `Ar` and `totE` variables). Both stem from incomplete merge resolution on the `main` branch.

2. **Start page needs simplification.** The current three-column layout (PDF OCR, Structured File, Manual Entry) must be replaced with exactly three options: Scan Lease, Input Schedule, Download Blank Excel Template.

3. **Word document output must be added.** Both the scan and manual-input flows must produce a lease-specific Word document summarizing idiosyncrasies, assumptions, confidence notes, and guidance for interpreting and editing the Excel output. A prior unfinished attempt exists on branch `claude/vibrant-shannon` (`reviewDocGenerator.js`) and can be used as a starting point, but its scope was narrower (OCR confidence memo only) and it depends on modules (`confidenceScorer.js`, `plausibility.js`, `chargeCategories.js`) not present on `main`.

The plan preserves all existing calculator logic unchanged and limits changes to: (a) fixing the export crash, (b) simplifying the start page, (c) building a shared output pipeline that produces both Excel and Word deliverables, and (d) adding the blank template download option.

---

## B. Current Architecture Map

### B.1 File Inventory

| File | Role |
|---|---|
| `src/App.jsx` | Root orchestrator. Owns all step state. Routes between UPLOAD → SCHEDULE → FORM → RESULTS. |
| `src/components/UploadRouter.jsx` | Start page. Three-column layout: PDF OCR (Path A), Structured File (Path B), Manual Entry (Path C). |
| `src/components/ScheduleEditor.jsx` | Step 2: Row-by-row or bulk-paste rent schedule editor. |
| `src/components/InputForm.jsx` | Step 2/3: NNN charge parameter form. Exports `emptyFormState()`. |
| `src/components/LedgerTable.jsx` | Results: monthly ledger with expandable trace rows. |
| `src/components/SummaryPanel.jsx` | Results: totals summary panel. |
| `src/components/ExportButton.jsx` | Results: triggers `exportToXLSX` and `exportToCSV`. |
| `src/components/TracePanel.jsx` | Expandable calculation trace per row. |
| `src/components/ValidationBanner.jsx` | Inline validation error display. |
| `src/engine/calculator.js` | Core charge calculation (two-pass model). Pure. |
| `src/engine/expander.js` | Expand period rows to monthly rows. Pure. |
| `src/engine/parser.js` | Structured file parser (CSV/Excel). Pure. |
| `src/engine/periodParser.js` | Flexible period text parser. Pure. |
| `src/engine/validator.js` | Parameter and schedule validation. Pure. |
| `src/engine/yearMonth.js` | Date parsing utilities. Pure. |
| `src/engine/labelClassifier.js` | NNN expense label classifier and OCR correction. Pure. |
| `src/ocr/extractor.js` | PDF text extraction via Anthropic/OpenAI API. |
| `src/utils/exportUtils.js` | XLSX and CSV export (3-sheet workbook). **Currently broken.** |
| `src/utils/mdFormatter.js` | Markdown document builder (institutional style). Not used in main export flow. |
| `src/utils/formatUtils.js` | Dollar formatting utility. |
| `src/utils/dateUtils.js` | Date formatting utility. |
| `reference/lease_output_template_ref1.xlsx` | Reference Excel template. |

### B.2 Data Flow

```
UploadRouter
  ├─ handlePDFUpload()   → extractFromPDF() + parseFile() → ocrScheduleToPeriodRows()
  ├─ handleFileUpload()  → parseFile()
  └─ handleManualEntry() → empty state
       ↓
ScheduleEditor (review/edit period rows)
       ↓ handleScheduleConfirm(periodRows, warnings)
expandPeriods(periodRows) → expandedRows[]
       ↓
InputForm (NNN parameters, abatement, one-time items)
       ↓ handleFormSubmit(form)
formToCalculatorParams(form) → params
calculateAllCharges(expandedRows, params) → processedRows[]
       ↓
RESULTS step
  ├─ LedgerTable(processedRows)
  ├─ SummaryPanel(processedRows)
  └─ ExportButton(processedRows, processedParams, fileName)
       ├─ exportToXLSX(rows, params, filename)  ← BROKEN
       └─ exportToCSV(rows, filename)
```

### B.3 Normalized Lease Data Object

The final processed state that feeds export consists of two objects:

- `processedRows[]` — Array of monthly row objects from `calculateAllCharges()`, each containing: `periodStart`, `periodEnd`, `leaseMonth`, `leaseYear`, `scheduledBaseRent`, `baseRentApplied`, `camsAmount`, `insuranceAmount`, `taxesAmount`, `securityAmount`, `otherItemsAmount`, `oneTimeItemAmounts`, `totalMonthlyObligation`, `effectivePerSF`, `totalObligationRemaining`, `totalBaseRentRemaining`, `totalNNNRemaining`, `totalOtherChargesRemaining`, `isAbatementRow`, `periodFactor`, `baseRentProrationFactor`, `prorationBasis`, plus per-category escalation year and active flags.

- `processedParams` — The params object from `formToCalculatorParams()`, containing: `leaseName`, `nnnMode`, `nnnAggregate`, `squareFootage`, `abatementEndDate`, `abatementPct`, `oneTimeItems`, `cams`, `insurance`, `taxes`, `security`, `otherItems`.

### B.4 Existing Word/Docx Logic

- **On `main`:** No Word document generation exists. `mdFormatter.js` produces markdown strings (not docx).
- **On `claude/vibrant-shannon`:** A `reviewDocGenerator.js` (332 lines) exists that generates a 1-page `.docx` review memo using the `docx` npm package. It covers: lease summary, extraction confidence, field status (reliable/uncertain/missing), plausibility warnings, validation notes, and action items. It depends on `confidenceScorer.js` and `plausibility.js` (also only on that branch) and the `docx` npm package (added to `package.json` on that branch).

### B.5 Blank Template Download Logic

No blank template download exists in the current app. The reference template at `reference/lease_output_template_ref1.xlsx` is for development reference only, not served to users.

### B.6 Branch Status

| Branch | Commit | Status |
|---|---|---|
| `main` (HEAD) | `f8c3aab` | Merge commit. Excel export broken (assumpBorder undefined + Annual Summary undefined vars). |
| `claude/intelligent-blackburn` | `513f384` | Fixes `assumpBorder` only. Not merged to main. |
| `claude/vibrant-shannon` | `2f81714` | Major refactor with charge registry, review doc, confidence scoring. Too broad to merge wholesale — contains 2,495 new/changed lines across 16 files. |
| `claude/modest-shockley` | `155e7c7` | Pre-merge state. No relevant fixes. |

---

## C. Excel Export Failure Diagnosis

### Root Cause 1 (Primary crash): `assumpBorder` undefined

**File:** `src/utils/exportUtils.js`, line 454
**Symptom:** `ReferenceError: assumpBorder is not defined`
**Cause:** The `buildAssumptionsBlock` function at line 437 defines a `labelStyle` object with inline border properties, then on line 454 references `assumpBorder` in the row helper — a variable that was never declared in this version of the file. The fix on `claude/intelligent-blackburn` extracts the border object into a `const assumpBorder = { ... }` at line 438, but this fix was never merged to `main`.

**Severity:** Fatal. Every Excel export click throws immediately.

### Root Cause 2 (Secondary crash): `Ar` and `totE` undefined in Annual Summary

**File:** `src/utils/exportUtils.js`, lines 754–758
**Symptom:** `ReferenceError: Ar is not defined` (and `totE` on line 758)
**Cause:** The `buildAnnualSummary` function uses `${Ar}` in SUMIF/COUNTIF formula strings (lines 754–757) and `${totE}` in a percentage formula (line 758). These are JavaScript template literal interpolations, but no variables named `Ar` or `totE` are declared in the function scope. They appear to be intended as Excel cell references (`A{r}` for the year cell in each row, and `E{totRow}` for the total), but were written as JS variable references instead of string literals.

**Intended formula (line 754):** `COUNTIF(range, A2)` where `A2` is the year cell in the current row.
**Actual code:** `` `COUNTIF(${Dabs},${Ar})` `` — JS interpolates `Ar` as undefined → `"COUNTIF(...,undefined)"`.

**Intended formula (line 758):** `IF(E{totRow}=0,0,E{r}/E{totRow})`
**Actual code:** `` `IF(${totE}=0,0,E${r}/${totE})` `` — same issue with `totE`.

**Severity:** Fatal. Even if Root Cause 1 is fixed, the Annual Summary sheet builder will crash.

### Root Cause 3 (Structural): Column layout mismatch in Annual Summary

The `SUMMARY_HEADERS` array defines 8 columns (Period Start, Period End, Lease Year, Months, Base Rent Applied, Total NNN, Total Monthly Obligation, % of Grand Total), but the row builder only populates columns 0–5 (year at col 0, then COUNTIF at col 1, three SUMIFs at cols 2–4, percentage at col 5). Columns 0–1 do not contain Period Start/Period End dates despite the headers suggesting they should. The `yearDateMap` is computed but never used. The `gsum` totals reference columns D–G which do not align with the 8-column header layout.

**Severity:** Non-fatal but produces a misaligned, misleading spreadsheet.

### Diagnosis Ranking

1. **`assumpBorder` undefined** — immediate crash, 100% reproducible.
2. **`Ar` / `totE` undefined** — crashes Annual Summary builder, 100% reproducible if Root Cause 1 is patched first.
3. **Column layout mismatch** — produces incorrect output, does not crash.

---

## D. Recommended End-State Design

### D.1 Start Page

Three options, full stop:

1. **Scan Lease** — corresponds to current Path A (PDF OCR). Relabeled.
2. **Input Schedule** — merges current Path B (structured file) and Path C (manual entry) into a single flow. User enters the ScheduleEditor where they can either upload a structured file or type/paste rows manually.
3. **Download Blank Excel Template** — static download of a pre-built blank template file. No parsing, no form, no processing.

### D.2 Shared Output Pipeline

Both Scan Lease and Input Schedule must converge to the same final output package:

```
processedRows[] + processedParams + leaseMetadata
       ↓
OutputPackage
  ├─ exportToXLSX(rows, params, filename)     → .xlsx download
  ├─ generateLeaseDoc(rows, params, metadata)  → .docx download
  └─ exportToCSV(rows, filename)               → .csv download (optional, keep)
```

The `leaseMetadata` object is a new lightweight structure that captures:

```js
{
  inputPath: 'scan' | 'manual',
  fileName: string,
  ocrConfidenceFlags: string[],       // empty for manual path
  ocrNotices: string[],               // empty for manual path
  extractionWarnings: string[],       // parse/OCR warnings
  parseWarnings: string[],            // expander warnings
  validationErrors: ValidationError[],// (should be empty post-confirm)
  duplicateDatesConfirmed: boolean,
  nnnMode: 'individual' | 'aggregate',
  abatementConfigured: boolean,
  oneTimeItemCount: number,
  sfProvided: boolean,
  formState: object,                  // raw form values for assumption traceability
}
```

This object is assembled in `App.jsx` from existing state variables at the point where RESULTS step is entered. No new data collection is needed — all fields already exist in App state.

### D.3 Blank Template Download

A static `.xlsx` file is placed in `public/deodate-lease-template.xlsx` (generated once from the existing export pipeline with empty rows and default assumptions). The download button triggers a simple `<a href>` download. No processing pipeline involvement.

### D.4 Architecture Diagram

```
UploadRouter (simplified: 3 options)
  ├─ "Scan Lease"        → handlePDFUpload (existing)
  ├─ "Input Schedule"    → handleManualEntry (existing, routes to ScheduleEditor)
  └─ "Download Template" → static <a> download (no state change)
       ↓ (options 1 & 2 only)
ScheduleEditor → InputForm → calculator
       ↓
RESULTS step
  ├─ LedgerTable
  ├─ SummaryPanel
  └─ ExportButton (enhanced)
       ├─ Excel export (fixed)
       ├─ Word doc export (new)
       └─ CSV export (existing)
```

---

## E. Word Doc Design

### E.1 Purpose

The Word document serves as a companion to the Excel workbook. It explains what is unusual about this specific lease, what assumptions the system made, and how the user should interpret and potentially edit the Excel output.

### E.2 Proposed Section Structure

**Section 1: Lease Overview**
- Lease name, commencement date, expiration date, total term in months
- Rentable square footage
- Input path (scan vs. manual entry)
- Data source: `processedRows` (first/last row dates), `processedParams.leaseName`, `processedParams.squareFootage`, `leaseMetadata.inputPath`

**Section 2: Key Extracted Terms**
- Year 1 monthly base rent
- Annual escalation rate
- NNN mode (individual vs. aggregate) with category breakdown
- Abatement configuration (months, percentage, end date)
- One-time charges (count and labels)
- Data source: `processedParams`, `leaseMetadata.formState`

**Section 3: Idiosyncrasies and Unusual Provisions**
- Conditional content, only present when relevant:
  - Aggregate NNN (no line-item breakdown available)
  - Partial-month abatement boundary (non-integer proration factor)
  - Free rent period (abatement at 100%)
  - Partial abatement (abatement between 1–99%)
  - Step-ups detected (Year 1 rent differs from Year 2+)
  - Non-standard escalation start dates for any NNN category
  - Delayed billing start dates for any NNN category
  - One-time charges with specific trigger dates
  - One-time charges without dates (assigned to lease commencement)
  - Stub periods (first or last year has fewer than 12 months)
- Data source: `processedRows` (scan for `isAbatementRow`, `prorationBasis`, escalation year patterns), `processedParams` (charge start/esc start dates, abatement config, one-time items)

**Section 4: Assumptions the System Made**
- Escalation compounding model: annual, applied at year boundaries based on Year # column
- NNN escalation uses same Year # as base rent unless category-specific escStart was provided
- Abatement applies to base rent only (NNN charges are not abated)
- One-time items without dates are assigned to the first row (lease commencement)
- Remaining balances are tail-sums (simple forward accumulation, not NPV)
- Data source: Static text (engine design) combined with `processedParams` for which assumptions were active

**Section 5: Warnings and Confidence Notes**
- OCR confidence flags (scan path only): list fields flagged as low-confidence
- OCR notices (scan path only): extraction limitation notices
- Extraction warnings: any warnings from parse or OCR steps
- Parse warnings: duplicate dates, format issues
- If manual-input path: note that no OCR validation was performed; all values are user-supplied
- Data source: `leaseMetadata.ocrConfidenceFlags`, `leaseMetadata.ocrNotices`, `leaseMetadata.extractionWarnings`, `leaseMetadata.parseWarnings`

**Section 6: How to Interpret the Excel Workbook**
- Tab overview: Lease Schedule, Annual Summary, Audit Trail
- Color coding reference table (blue = input, black = formula, amber = abatement, red-pink = NNN)
- Assumptions block location (rows 5–22, column C)
- How formulas reference assumption cells (e.g., Scheduled Base Rent = $C$8 * (1+$C$9)^(Year-1))
- Footnote key (circled numbers 1–5 in the spreadsheet)
- Data source: Static text (export layout design)

**Section 7: Which Fields the User May Want to Verify Manually**
- Square footage (affects Effective $/SF column)
- Abatement end date and percentage
- NNN Year 1 amounts and escalation rates
- One-time charge amounts and dates
- Any field flagged with low OCR confidence (scan path)
- Data source: `leaseMetadata.ocrConfidenceFlags`, `processedParams` (check for zero/missing values)

**Section 8: Formula-Driven vs. Assumption-Driven Values**
- Table listing each column and whether it is formula-driven (black) or assumption-driven (blue)
- Explain that editing blue cells in the assumptions block will automatically recalculate all formula cells
- Warn against overwriting formula cells directly
- Data source: Static text (export column layout)

**Section 9: Common Correction Scenarios**
- "My rent is wrong" → Edit $C$8 (Year 1 base rent) or $C$9 (escalation rate)
- "NNN amounts are wrong" → Edit $C$13–$C$22
- "Abatement period is wrong" → Edit $C$11 (month count) or $C$12 (partial factor)
- "I need to add a one-time charge" → Insert a new column after the last OT column, update Total Monthly Obligation formula
- "My square footage changed" → Edit $C$5
- Data source: Static text (export cell map)

**Section 10: Notes on Specific Lease Features**
- Conditional paragraphs, only included when the feature was active in this lease:
  - **Abatements:** Abatement end date convention (inclusive last day), how boundary months are prorated, amber row highlighting
  - **Step-ups:** How escalation is calculated using Year # exponent
  - **Free rent:** Distinction between 100% abatement and $0 base rent periods
  - **Partial months:** How periodFactor and baseRentProrationFactor interact
  - **NNN categories:** CAMS + Insurance + Taxes = Total NNN; Security and Other Items are Other Charges
  - **One-time charges:** Blue hardcoded values, not formula-driven
  - **Percentage rent:** Not currently supported; note if OCR detected percentage rent language
  - **Security deposits:** Classified as Other Charges, not NNN
  - **Landlord work / TI allowance:** If detected by OCR, note that these are typically one-time credits
  - **Missing values:** Which fields defaulted to zero
  - **Inferred dates:** Whether any period end dates were inferred from the next period start
  - **OCR uncertainty:** Summary of fields where extraction confidence was below threshold
- Data source: `processedRows`, `processedParams`, `leaseMetadata`

### E.3 Implementation Approach

- Use the `docx` npm package (already added on `vibrant-shannon` branch, needs to be added to `main`)
- Create `src/utils/leaseDocGenerator.js` as a new pure-function module
- Signature: `generateLeaseDoc(rows, params, metadata) → Promise<Blob>`
- The generator must work for both scan and manual paths. Sections that depend on OCR data are conditionally included. When `metadata.inputPath === 'manual'`, OCR-specific sections are replaced with a note that all values are user-supplied.
- The `reviewDocGenerator.js` from `vibrant-shannon` can be used as a structural reference for the docx builder pattern (heading, bullet, kvRow helpers), but the content and section structure must be rebuilt per the spec above.

---

## F. File-by-File Implementation Plan

### F.1 `src/utils/exportUtils.js`

**Why:** Excel export is broken (3 bugs).

**Changes:**
1. Define `const assumpBorder` inside `buildAssumptionsBlock` (extract border object from `labelStyle` into a named constant). Reference: `claude/intelligent-blackburn` commit `513f384`.
2. Fix `buildAnnualSummary` lines 754–758: Replace `${Ar}` with `A${r}` (string literal Excel cell reference). Replace `${totE}` with `E${totRow}` (string literal reference to the totals row in column E).
3. Fix column layout mismatch in `buildAnnualSummary`: Populate Period Start (col 0) and Period End (col 1) from `yearDateMap`, shift Lease Year to col 2, Months to col 3, Base Rent to col 4, NNN to col 5, Total Monthly Obligation to col 6, % of Grand Total to col 7. Update `gsum` references accordingly.

**Must not change:** Ledger sheet builder, Audit Trail builder, CSV export, cell style definitions, color conventions, column layout for the main Lease Schedule tab.

### F.2 `src/components/UploadRouter.jsx`

**Why:** Start page must show exactly 3 options with new labels.

**Changes:**
1. Rename "PDF Upload with OCR" to "Scan Lease". Keep the OCR limitation notice.
2. Merge "Structured File Upload" and "Manual Entry" into a single "Input Schedule" option that routes to `ScheduleEditor` (via `onManualEntry` callback). The ScheduleEditor already supports both file upload and manual entry.
3. Add "Download Blank Excel Template" option with a simple `<a href="/deodate-lease-template.xlsx" download>` link.
4. Remove the three-column A/B/C badge layout. Replace with a cleaner vertical or card-based layout for the three options.

**Must not change:** The `onPDFUpload`, `onFileUpload`, `onManualEntry` callback signatures. The OCR limitation notices content.

### F.3 `src/App.jsx`

**Why:** Must assemble `leaseMetadata` and pass it to ExportButton. Must support the simplified routing.

**Changes:**
1. Add a `leaseMetadata` state object (or compute it inline at RESULTS step).
2. Pass `leaseMetadata` to `ExportButton` alongside `processedRows` and `processedParams`.
3. Verify that the "Input Schedule" path correctly routes through `handleManualEntry` → `ScheduleEditor`. The existing `handleManualEntry` callback already does this — no pipeline changes needed.
4. The `handleFileUpload` callback may need to be surfaced inside `ScheduleEditor` rather than `UploadRouter`, since structured file upload is now part of the "Input Schedule" flow. Alternatively, `ScheduleEditor` already supports file input via its bulk-paste and import features — verify and adjust as needed.

**Must not change:** `formToCalculatorParams`, `ocrScheduleToPeriodRows`, step state machine logic, `handleFormSubmit` processing pipeline, `calculateAllCharges` invocation.

### F.4 `src/components/ExportButton.jsx`

**Why:** Must add Word doc export button.

**Changes:**
1. Import `generateLeaseDoc` from new `leaseDocGenerator.js`.
2. Accept `leaseMetadata` prop.
3. Add a "Review Doc" button that calls `generateLeaseDoc(rows, params, metadata)` and triggers a `.docx` download.
4. Keep existing Excel and CSV buttons.

**Must not change:** Excel and CSV export invocations.

### F.5 `src/utils/leaseDocGenerator.js` (NEW FILE)

**Why:** Word document generation does not exist on `main`.

**Changes:** Create this file implementing the spec in Section E. Pure function, no UI dependencies. Returns `Promise<Blob>` via `docx` package's `Packer.toBlob()`.

**Must not change:** N/A (new file).

### F.6 `src/components/ScheduleEditor.jsx`

**Why:** May need to accept file upload capability that was previously in UploadRouter's "Structured File" path.

**Changes:** If ScheduleEditor does not already support structured file import (CSV/XLSX upload within the editor), add a file-upload zone at the top of the editor that calls `parseFile()` and populates the period rows. Review the existing component — it is 35K and may already have this capability.

**Must not change:** Period row editing logic, bulk paste logic, Quick Entry mode, validation logic.

### F.7 `public/deodate-lease-template.xlsx` (NEW FILE)

**Why:** Blank template download option requires a static file.

**Changes:** Generate a blank template from the existing `exportToXLSX` pipeline (empty rows, default assumptions, all formulas intact) and place it in `public/`. This can be done once as a build step or committed as a static asset.

**Must not change:** N/A (new file).

### F.8 `package.json`

**Why:** `docx` npm package must be added as a dependency.

**Changes:** Add `"docx": "^9.x"` (or latest stable) to dependencies.

**Must not change:** Existing dependencies.

---

## G. Acceptance Criteria

### G.1 Homepage Options

- [ ] Start page displays exactly three options: "Scan Lease", "Input Schedule", "Download Blank Excel Template"
- [ ] No other intake options are visible
- [ ] "Scan Lease" accepts `.pdf` files and triggers OCR extraction
- [ ] "Input Schedule" routes to the ScheduleEditor where user can type, paste, or upload a structured file
- [ ] "Download Blank Excel Template" downloads a `.xlsx` file immediately with no navigation

### G.2 Scan Output Behavior

- [ ] Scan flow produces a fully rendered results page with LedgerTable, SummaryPanel, and ExportButton
- [ ] ExportButton offers Excel, CSV, and Word doc downloads
- [ ] Excel download completes without errors
- [ ] Word doc download completes without errors
- [ ] Word doc contains lease-specific content (not generic boilerplate)
- [ ] Word doc includes OCR confidence flags and extraction warnings

### G.3 Input Schedule Output Behavior

- [ ] Manual input flow produces the same results page structure as scan flow
- [ ] ExportButton offers the same three download options
- [ ] Excel download completes without errors
- [ ] Word doc download completes without errors
- [ ] Word doc omits OCR-specific sections and instead notes that values are user-supplied
- [ ] Word doc still includes assumptions, correction guidance, and Excel interpretation sections

### G.4 Blank Template Download

- [ ] Clicking "Download Blank Excel Template" triggers an immediate `.xlsx` download
- [ ] No form, no processing, no navigation occurs
- [ ] The downloaded file opens in Excel and contains the correct sheet structure (Lease Schedule, Annual Summary, Audit Trail) with headers and assumptions block but no data rows

### G.5 Excel Export Functioning

- [ ] `exportToXLSX` completes without `ReferenceError` or any runtime exception
- [ ] Assumptions block renders correctly with bordered cells
- [ ] Annual Summary sheet renders with correct column layout and functional cross-sheet formulas
- [ ] All three sheets (Lease Schedule, Annual Summary, Audit Trail) are present and populated
- [ ] Formulas in the workbook calculate correctly when opened in Excel or Google Sheets

### G.6 Word Doc Generation

- [ ] Word doc is a valid `.docx` file that opens in Microsoft Word and Google Docs
- [ ] Document contains all specified sections (overview, terms, idiosyncrasies, assumptions, warnings, interpretation guide, verification fields, formula vs. assumption table, correction scenarios, feature-specific notes)
- [ ] Conditional sections appear only when the relevant feature is active (e.g., abatement section only when abatement is configured)
- [ ] OCR-specific sections appear only for scan-path leases

### G.7 Output Parity

- [ ] Given identical lease parameters, the Excel output from the scan path and the manual-input path are byte-identical (excluding the generated-date timestamp)
- [ ] The Word doc from both paths covers the same structural sections, differing only in OCR-specific content

---

## H. Test Matrix

### H.1 Scan Flow — Typical Lease

| Step | Action | Expected |
|---|---|---|
| 1 | Upload a well-structured lease PDF | OCR extraction completes; ScheduleEditor shows pre-populated rows |
| 2 | Confirm schedule, fill NNN params | Form validates; processing produces results |
| 3 | Click Excel export | `.xlsx` downloads; opens without errors; 3 sheets present |
| 4 | Click Word doc export | `.docx` downloads; opens in Word; contains OCR confidence notes |
| 5 | Click CSV export | `.csv` downloads; rows match ledger |

### H.2 Scan Flow — OCR Noise / Missing Data

| Step | Action | Expected |
|---|---|---|
| 1 | Upload a scanned/image-heavy PDF | Extraction may partially fail; warnings displayed |
| 2 | ScheduleEditor shows partial/empty rows | User can manually correct rows |
| 3 | Complete form and process | Results render correctly |
| 4 | Word doc includes extraction warnings | Low-confidence flags listed; "verify manually" guidance present |

### H.3 Manual Input Flow

| Step | Action | Expected |
|---|---|---|
| 1 | Click "Input Schedule" | ScheduleEditor opens with empty rows |
| 2 | Enter 3 annual periods via Quick Entry | Rows auto-generate |
| 3 | Add NNN params, one-time charge, abatement | Form accepts all inputs |
| 4 | Process and export Excel | `.xlsx` downloads correctly |
| 5 | Export Word doc | `.docx` contains no OCR sections; includes assumption and correction guidance |

### H.4 Export to Excel — Regression

| Test | Expected |
|---|---|
| Lease with 0 one-time charges | OT columns absent; Total Monthly Obligation formula correct |
| Lease with 3 one-time charges | 3 OT columns inserted; formulas reference correct columns |
| Aggregate NNN mode | CAMS column shows aggregate amount; Insurance/Taxes columns show zero |
| Abatement configured | Amber rows present; Base Rent Applied shows $0 for abated months |
| No abatement | No amber rows; all Base Rent Applied = Scheduled Base Rent |
| Annual Summary formulas | SUMIF/COUNTIF formulas resolve correctly against Lease Schedule tab |

### H.5 Blank Template Download

| Test | Expected |
|---|---|
| Click download button | `.xlsx` file downloads immediately |
| Open in Excel | 3 tabs present; headers correct; no data rows; assumptions block has placeholder labels |
| No navigation occurs | User remains on start page |

### H.6 Word Doc Generation — Content Verification

| Test | Expected |
|---|---|
| Lease with abatement | Abatement section present with correct dates and percentage |
| Lease without abatement | Abatement section omitted |
| Aggregate NNN | Idiosyncrasy note about aggregate NNN present |
| One-time charges present | One-time charge section lists labels and dates |
| Scan path | OCR confidence and extraction warning sections present |
| Manual path | OCR sections replaced with "user-supplied values" note |

### H.7 Git Merge Breakage Checks

| Test | Expected |
|---|---|
| `assumpBorder` defined before use | No ReferenceError in `buildAssumptionsBlock` |
| `Ar` replaced with `A${r}` | No ReferenceError in `buildAnnualSummary` |
| `totE` replaced with `E${totRow}` | No ReferenceError in `buildAnnualSummary` |
| No `<<<<<<` merge markers in any `.js`/`.jsx` file | Clean codebase |

### H.8 Browser Click-Through Path Validation

| Path | Steps | Expected |
|---|---|---|
| Scan → Results → Excel | 6 clicks | No errors at any step |
| Scan → Results → Word | 6 clicks | No errors at any step |
| Input → Quick Entry → Results → Excel | 5 clicks | No errors at any step |
| Input → Bulk Paste → Results → Word | 5 clicks | No errors at any step |
| Download Template | 1 click | File downloads |
| Start Over from Results | 1 click | Returns to start page |

---

## I. Risks and Edge Cases

### I.1 Parser Output Shape Mismatch

The OCR extractor produces `rentSchedule` objects with string dates (`MM/DD/YYYY`), while the structured parser produces period rows with `Date` objects. `ocrScheduleToPeriodRows()` normalizes OCR output, and `expandPeriods()` expects `{ periodStart: Date, periodEnd: Date, monthlyRent: number }`. Both paths converge before the ScheduleEditor, so this is already handled. **Risk: Low.**

### I.2 Manual-Input Missing Fields

Manual-input rows will never have OCR confidence flags. The Word doc generator must handle `null`/empty arrays for all OCR-specific metadata fields without crashing. Every conditional section must be guarded.

### I.3 Partial-Month Logic

The calculator's `baseRentProrationFactor` handles boundary months where abatement ends mid-period. The Word doc must detect and explain this when `abatementPartialFactor !== 1`. Edge case: a 1-month lease that starts and ends within the abatement period.

### I.4 Abatement Edge Cases

- Abatement percentage of 0 (configured but no-op) — should not trigger abatement sections in Word doc
- Abatement end date on the last day of the lease — all rows are abated
- Abatement percentage of 50 — partial abatement; Word doc should explain the proration

### I.5 One-Time Charges

- One-time items with no date → assigned to first row. Word doc must note this.
- Multiple one-time items on the same date → both appear as separate OT columns in Excel.
- One-time item with amount $0 → filtered out by `formToCalculatorParams`. Should not appear in Word doc.

### I.6 NNN Aggregate vs. Individual

When `nnnMode === 'aggregate'`, the CAMS column carries the full aggregate amount while Insurance and Taxes columns are zero. The Word doc must explain this clearly. The Excel Total NNN formula (`G+H+I`) still works because Insurance and Taxes are zero.

### I.7 Null Values Breaking Export

`exportToXLSX` uses `row.fieldName ?? 0` throughout, which guards against undefined. However, if a row object is entirely malformed (e.g., missing `oneTimeItemAmounts`), the OT label scan loop (`Object.entries(row.oneTimeItemAmounts ?? {})`) is safe. **Risk: Low.**

### I.8 Word Doc Depending on Parser-Specific Warnings

The extraction warnings and OCR notices are only populated on the scan path. The manual-input path sets these to empty arrays. The Word doc generator must not crash or produce misleading content when these are empty. It should instead include a section stating: "This schedule was entered manually. No automated extraction or confidence scoring was performed."

### I.9 Blank Template Staleness

If the export column layout changes in the future, the static blank template file will become stale. Consider either: (a) generating it at build time from the export pipeline, or (b) documenting the regeneration procedure.

### I.10 `docx` Package Bundle Size

The `docx` npm package adds approx. 200–300KB to the client bundle. Since this is a professional internal tool (not a consumer app), this is acceptable. If bundle size becomes a concern, the Word doc generation could be lazy-loaded.

---

## J. Claude Code Execution Prompt

```
You are implementing a planned set of changes to the DEODATE Lease Schedule Engine.
The full plan is in IMPLEMENTATION_PLAN.md at the project root. Read it first.

CRITICAL CONSTRAINTS:
- Do NOT change src/engine/calculator.js unless strictly required
- Do NOT change the calculation pipeline (expander, validator, parser, periodParser)
- Do NOT redesign unrelated UI
- Do NOT alter parser assumptions
- Preserve all existing useful output

IMPLEMENTATION ORDER:

1. FIX EXCEL EXPORT (src/utils/exportUtils.js):
   a. In buildAssumptionsBlock (line ~437), define `const assumpBorder` by extracting the border
      object from labelStyle. Reference commit 513f384 on claude/intelligent-blackburn.
   b. In buildAnnualSummary (lines 754-758), fix undefined variable references:
      - Replace `${Ar}` with `A${r}` (string literal cell reference)
      - Replace `${totE}` with `E${totRow}` where totRow = years.length + 2
   c. Fix Annual Summary column layout to match SUMMARY_HEADERS:
      - Col 0: Period Start (from yearDateMap[year].start)
      - Col 1: Period End (from yearDateMap[year].end)
      - Col 2: Lease Year
      - Col 3: Months (COUNTIF)
      - Col 4: Base Rent Applied (SUMIF)
      - Col 5: Total NNN (SUMIF)
      - Col 6: Total Monthly Obligation (SUMIF)
      - Col 7: % of Grand Total
      Update gsum and totals row accordingly.
   d. Verify the fix by running `npm run build` — no errors should occur.

2. ADD DOCX DEPENDENCY:
   Run `npm install docx --save`

3. CREATE WORD DOC GENERATOR (src/utils/leaseDocGenerator.js):
   New file. Pure function: generateLeaseDoc(rows, params, metadata) → Promise<Blob>.
   Follow the section structure in IMPLEMENTATION_PLAN.md Section E.
   Use the docx npm package (Document, Packer, Paragraph, TextRun, Table, etc.).
   Reference the helper patterns from claude/vibrant-shannon:src/utils/reviewDocGenerator.js
   but implement the full section structure from the plan, not the limited review memo.
   All OCR-specific sections must be conditional on metadata.inputPath === 'scan'.

4. SIMPLIFY START PAGE (src/components/UploadRouter.jsx):
   Replace the 3-column A/B/C layout with exactly 3 options:
   a. "Scan Lease" — keeps onPDFUpload behavior, keeps OCR limitation notice
   b. "Input Schedule" — calls onManualEntry (routes to ScheduleEditor)
   c. "Download Blank Excel Template" — static <a> download link to /deodate-lease-template.xlsx
   Remove the structured file upload zone from UploadRouter.

5. VERIFY SCHEDULE EDITOR SUPPORTS FILE UPLOAD:
   Check if ScheduleEditor already has file import capability.
   If not, add a file upload zone at the top that calls parseFile() and populates rows.
   This replaces the old "Structured File Upload" path from UploadRouter.

6. UPDATE App.jsx:
   a. Assemble leaseMetadata object from existing state at RESULTS step entry.
   b. Pass leaseMetadata to ExportButton.
   c. Verify routing: "Input Schedule" → ScheduleEditor → InputForm → Results.

7. UPDATE ExportButton.jsx:
   a. Import generateLeaseDoc from leaseDocGenerator.js.
   b. Accept leaseMetadata prop.
   c. Add "Review Doc" download button alongside Excel and CSV.

8. CREATE BLANK TEMPLATE (public/deodate-lease-template.xlsx):
   Generate by calling exportToXLSX with empty rows and default params,
   or build a minimal template programmatically. Place in public/.

9. VERIFY:
   a. Run `npm run build` — must succeed with zero errors.
   b. Run `npm run dev` and manually test all 3 start page paths.
   c. Verify Excel export works (no ReferenceError).
   d. Verify Word doc downloads and opens correctly.
   e. Verify blank template downloads.
   f. Verify "Start Over" returns to simplified start page.
```

---

*End of plan. No code changes have been made.*
