---
name: spreadsheet-template-audit
description: >
  Full diagnostic audit of complex Excel spreadsheet models — lease schedules, financial models,
  obligation trackers, scenario comparison workbooks, or any multi-section structured workbook.
  Use this skill whenever the user asks to audit, diagnose, QC, validate, populate, fix, or rebuild
  the DEODATE Lease Obligation Analysis workbook (any version); when scenario FV or NPV outputs
  are $0 or wrong; when helper columns T–W appear empty; when the Annual Summary returns zeros;
  when abatement logic, Free Rent, or NRC charges are not flowing correctly; or when any general
  spreadsheet model has broken formulas, wrong values, or inconsistent scenario outputs.
  Also trigger when the user pastes range-read output, cell values, or formula inventory and asks
  what is broken, why numbers are wrong, or how to fix the model. Do NOT trigger for simple
  data-cleaning, format-only tasks, or single-cell formula lookups where no systemic audit is needed.
---

# Spreadsheet Template Audit Skill

## Purpose

This skill produces a structured diagnostic audit of a complex spreadsheet model. The output is a
decision-grade report that: identifies every broken or missing formula, classifies issues by
severity, maps inputs against computed outputs, tests model dynamicity, surfaces logic ambiguities,
and delivers a phased repair plan — all without modifying the workbook unless the user explicitly
authorizes a repair pass.

This is a **read-only diagnostic first** discipline. Audit before touching anything.

---

## DEODATE Lease Obligation Analysis — Template Context

When working with the DEODATE Lease Obligation Analysis workbook, read
`references/workbook-specification.md` immediately. It contains the complete:
- 4-sheet architecture and purpose of each sheet
- Full input register with exact cell addresses, labels, and canonical values
- Column-by-column schedule layout (A–W) with formula patterns
- Scenario table design for both Renegotiation and Exit comparison tables
- Known failure modes specific to this template (see below for quick reference)
- Cross-sheet dependency map (Annual Summary → Lease Schedule)
- Audit Trail interpretation guide
- Escalation logic and abatement convention

### Quick Reference: This Template's Most Common Failures

**Before starting any audit of the lease obligation workbook, check these five things first:**

1. **Are columns T–W populated?** Read cells T75 and T76 (in `Lease Schedule (2)`) or T38
   and T39 (in `Lease Schedule`). If both are empty or None, the entire scenario comparison
   is broken — this is the single most impactful failure mode. All non-base-case FV and NPV
   return $0 when T–W are empty.

2. **Does the Annual Summary reference the correct sheet?** The Annual Summary hardcodes
   `'Lease Schedule'` references. If the working data is in `Lease Schedule (2)`, all Annual
   Summary values are zero. Verify that SUMIF source matches where the data actually lives.

3. **Are NRC dates entered as date serials?** Check `D57` (Moving Allowance) and `D65`
   (Letter of Credit) in `Lease Schedule (2)`. D57 contains a text string; D65 is blank.
   Both are excluded from OTC Remaining calculations.

4. **Is the Free Rent section (rows 44–50) connected to the schedule?** It is not by default.
   The schedule formulas reference `$C$37` (Abatement), not the Free Rent cells. Any values
   entered into the Free Rent section are silently ignored unless the formulas are updated.

5. **Are F18 and F19 intact as inputs?** These cells serve dual purpose — Free Rent months
   and TI psf inputs — while also appearing as display cells in the renegotiation Base Case
   column. They must not be overwritten with scenario-output values.

---

## Workflow

### Step 0: Establish context

Before reading ranges, confirm:
- What is the workbook's purpose? (Lease schedule, LBO model, DCF, obligation tracker, etc.)
- What symptom prompted the audit? (Wrong numbers, zero outputs, broken scenarios, recent edits, etc.)
- What does the user want back? (Full diagnostic report, targeted fix, repair plan, or all three?)

If the workbook is already open or ranges have been read into the conversation, extract answers
from what is already present rather than re-asking.

---

### Step 1: Sheet-level inventory

For each worksheet in scope:
- Name and stated purpose
- Row/column boundaries of data
- Approximate section count
- Whether it references other sheets (cross-sheet dependencies)

---

### Step 2: Section-by-section functional map

Read every named section and document:

| Section | Rows | Purpose | Inputs | Formulas | Empty cells that should not be empty |
|---------|------|---------|--------|----------|--------------------------------------|

Flag any section that is entirely blank when it should contain data or formulas.

---

### Step 3: Inputs vs. formulas inventory

Classify every materially important cell as one of:

- **True input** (blue / hardcoded / user-editable) — value should never be a formula
- **Dynamic formula** (recalculates from inputs) — should reference inputs, never hardcode
- **Static value that should be a formula** — a number typed in where a formula belongs
- **Orphan formula** — a formula that references cells outside the current data structure, produces stale output, or has no label/purpose

For financial models, specifically check:
- Are all scenario outputs driven by input assumptions, or are some hardcoded?
- Are one-time charges and dates entered as values, not formulas? (Correct — flag if formula.)
- Are all escalation and proration calculations formula-driven? (Should be — flag if hardcoded.)

---

### Step 4: Issue identification and severity classification

Classify every identified issue using this framework:

**CRITICAL** — Output is wrong, zero, or non-functional. Scenario metrics are non-operative.
Examples: helper columns entirely empty; SUMPRODUCT references empty range; broken circular
reference; key formula returning $0 when it should return a material value.

**HIGH** — Output is misleading or internally inconsistent. Design ambiguity that produces
conflicting results. Ghost formulas with orphaned references. Dual-purpose cells that create
fragility.

**MEDIUM** — Disconnected input sections with no formula linkage; sections that exist in the
layout but are not wired into the calculation pipeline.

**LOW** — Cosmetic issues; missing dates on one-time items that exclude them from summation;
text strings where date values are expected; label inconsistencies.

For each issue, document:
- Cell reference(s)
- Description of the problem
- Impact: what downstream outputs are affected
- Root cause (if determinable from the read data)

---

### Step 5: Dynamicity testing

For models with a key driver cell (e.g., an effective date of analysis, a discount rate, a scenario
selector), confirm that downstream outputs respond:

| Metric | Key input cell | Formula present? | Returns correct type? | Cascades correctly? |
|--------|---------------|-----------------|----------------------|---------------------|

Any metric that does not cascade from its driver input is a dynamicity failure — classify as
CRITICAL if it is a primary output, HIGH if secondary.

Specifically test for the pattern: **formula exists but references an empty helper range** — this
is the most common cause of "model shows $0 for all scenarios" issues.

---

### Step 6: Logic ambiguities

Identify design choices where two different calculation approaches coexist and may conflict.
Common patterns in financial/lease models:

- Two formula rows that both claim to be the FV or NPV output (one uses SUMPRODUCT from a helper
  column, the other uses a proportional discount from the base case)
- Input cells that double as scenario-output display cells
- Multiple abatement or free-rent sections with overlapping purpose but no formula linkage between them
- Hardcoded percentages inside a formula that should reference a named assumption cell

For each ambiguity, document: the two competing approaches, which one is currently producing
output, and what clarification is needed from the user before repair.

---

### Step 7: Diagnostic report

Produce the report using this structure:

```
1. Sheet Purpose
2. Section-by-Section Intended Function  (table)
3. Inputs vs. Formulas Map               (table: cell, label, value/formula, type, status)
4. Full Issue List                        (severity-ranked table)
5. Critical Issues Summary                (top N issues, ranked)
6. Dynamicity Failures                    (table)
7. Logic Ambiguities                      (numbered list)
8. Repair Plan                            (phased, see below)
9. Template / Parameter Specification     (key model parameters for documentation)
```

---

### Step 8: Repair plan structure

Phase every repair in dependency order. A well-structured plan follows this sequence:

**Phase 1 — Restore broken helper columns / formula infrastructure**
Rebuild any range that is entirely empty but is referenced by scenario outputs. This is always
the first phase because all downstream scenario metrics depend on it.

**Phase 2 — Fix cascading output formulas**
Once the helper range is populated, fix any formula that references it (SUMPRODUCT, INDEX/MATCH
over restored ranges). Also fix blank formula cells (e.g., J32 blank when it should reference
the W column).

**Phase 3 — Resolve design ambiguities**
Eliminate dual-calculation-path conflicts. Choose the canonical output row for each metric.
Remove or hide orphan formula rows that produce stale outputs.

**Phase 4 — Wire disconnected input sections**
Connect any section that has labels and user inputs but is not referenced by the schedule or
calculation engine.

**Phase 5 — Validation**
- Change the key driver cell to 3 different values (beginning, middle, end of range)
- Confirm all scenario metrics respond dynamically
- Verify no #REF!, #VALUE!, #DIV/0!, #N/A errors anywhere in scope
- Confirm totals tie: row sums, column sums, cross-section cross-checks

---

## Output format

Deliver the diagnostic report as a structured markdown document (or inline in chat for shorter
audits). Section headers should be bold. Tables for the issues list, inputs map, and dynamicity
test. Severity badges (CRITICAL / HIGH / MEDIUM / LOW) should appear in the issue table.

Include an explicit statement at the top of every audit report:

> **Audit Scope:** [Sheet name(s)], as-of [date of audit]. No modifications made. This report
> is diagnostic only.

---

## Key patterns to watch for in lease schedule models

These patterns appear frequently in commercial lease obligation workbooks and should be checked
proactively:

- **Helper columns cleared by formatting operations.** A common failure mode: a user applies a
  format change across a wide range, which silently clears formula content in adjacent helper columns.
  Check columns to the right of the visible schedule for empty ranges that should contain formulas.

- **SUMPRODUCT over empty helper range returns $0 for all scenarios.** If base-case FV is correct
  but all scenario FVs are $0, the helper columns (which apply the scenario discount to the
  monthly obligation) are almost certainly empty.

- **Effective date of analysis not flowing through to scenario metrics.** The base case FV
  correctly filters by effective month; scenario FVs should use the same MATCH offset. If they don't,
  scenarios overcount obligation.

- **One-time charge dates stored as text strings.** If an NRC date cell contains "Within 30 days
  of occupancy" instead of a date serial, SUMPRODUCT date-comparison formulas will silently exclude
  that charge from remaining-obligation calculations.

- **Dual abatement sections.** If the workbook has both an original "Abatement" input block and a
  newer "Free Rent" block, confirm which one the schedule formulas reference. The newer section is
  likely disconnected.

- **Exit scenario FV double-counted or conflicting.** Watch for two rows that both appear to
  represent exit FV — one using SUMPRODUCT from helper columns, one using `=BaseFV*(1-buyout%)`.
  They are not equivalent and will diverge once helper columns are repaired.

---

## DEODATE Lease Obligation Analysis — Targeted Audit Procedure

When auditing this specific workbook, execute this sequence in addition to the general Steps 1–8.

### Lease-Specific Step A: Identify which sheet is active

Determine whether the working data is in `Lease Schedule` (blank template, rows 38–161) or
`Lease Schedule (2)` (populated, rows 75–198). Key distinguishing features:
- `Lease Schedule (2)` has actual values in C21–C26 and C29–C34
- `Lease Schedule` has escalation rates in F5–F10; `Lease Schedule (2)` has them in C29–C34
- The schedule row range and all SUMPRODUCT references differ between the two sheets
- The NRC table is in rows 14–26 (LS) vs. rows 53–65 (LS2)

### Lease-Specific Step B: T–W helper column status

Read cells T{first_row} and T{first_row+1} (e.g., T38/T39 in LS, T75/T76 in LS2).
If empty: classify as CRITICAL and initiate Phase 1 of the repair plan before anything else.
If present: verify the formula structure matches the pattern in `repair-formula-patterns.md`.

The correct T-column formula (Modest scenario, Lease Schedule (2), row 75) is:
```
=IF($C$37=0,E75*(1-$G$10),IF(C75<=$C$37,0,IF(C75=$C$37+1,E75*(1-$G$10)*$C$40,E75*(1-$G$10))))+M75
```

U, V, W follow the same pattern using `$H$10`, `$I$10`, and the exit buyout `$J$29` respectively.

### Lease-Specific Step C: Scenario output validation

Check J16 (Renegotiation) and I35 or J35 (Exit) for non-zero values if T–W are populated.
If values are zero despite T–W containing formulas, check whether the SUMPRODUCT range
filter matches the sheet's actual row bounds (`C75:C198` in LS2 vs. `C38:C161` in LS).

Confirm that C12 (Effective Date of Analysis) produces a valid C13 (Effective Month #) via
MATCH. If C13 evaluates to 0 or 1 when an analysis date mid-lease is entered, the MATCH
range is likely pointing to the wrong column or wrong row range.

### Lease-Specific Step D: Annual Summary cross-sheet linkage

Confirm that Annual Summary SUMIF formulas reference the same sheet where data lives.
The formula `=SUMIF('Lease Schedule'!$D$38:$D$161, year, 'Lease Schedule'!$F$38:$F$161)`
returns zero if data is in `Lease Schedule (2)`. This is a silent error — no formula error
flag appears, just zero values.

### Lease-Specific Step E: NRC table audit

Scan all 13 NRC date cells (D53:D65 in LS2, G14:G26 in LS) for:
- Text strings (type check — should be date serial, not string)
- Blank cells
- Dates that appear to be wrong (e.g., a date before lease commencement or after expiration)

Flag any non-date NRC date cell as LOW severity and document the dollar amount that is
excluded from OTC Remaining as a result.

### Lease-Specific Step F: Abatement vs. Free Rent section

Confirm which section the schedule formulas reference:
- In LS2: schedule uses `$C$37` (abatement duration) and `$C$40` (abatement %)
- The Free Rent section (rows 44–50 in LS2) is disconnected unless formulas are updated

If the user has entered values in the Free Rent section and expects them to affect the schedule,
this is a MEDIUM issue — the inputs exist but are not wired.

### Repair Authorization Protocol

Before writing any formula to the workbook:
1. Present the full diagnostic report
2. Confirm the repair scope with the user (which phases, which sheets)
3. Execute phases in dependency order: T–W first, then output formulas, then design cleanup
4. Validate after each phase using `scripts/validate_model.py`

---

## Repair Execution Workflow

When the user authorizes repair of a diagnosed workbook, execute with scripts rather than
manually writing formulas. This eliminates the most common repair error: incorrect absolute
cell references when the sheet is LS vs. LS2.

### T–W Helper Column Rebuild

Use `scripts/rebuild_helper_columns.py`. The script:
1. Auto-detects the active sheet (LS vs. LS2) by checking C21 for a non-zero value
2. Reads the correct cell addresses for abatement, discount, and NNN references
3. Generates T–W formulas for all 124 schedule rows
4. Writes via openpyxl and optionally triggers LibreOffice recalc

```bash
# Dry run first — review formulas without writing
python scripts/rebuild_helper_columns.py workbook.xlsx --dry-run

# Execute
python scripts/rebuild_helper_columns.py workbook.xlsx --recalc
```

After rebuild, run validation:
```bash
python scripts/validate_model.py workbook.xlsx
```

Confirm assertion #17 (T–W populated) passes and assertion #18 (correct abatement reference)
passes. Then check scenario FV outputs (assertion: non-base-case FV should be non-zero).

### Abatement Edge Cases

Before rebuilding T–W, confirm the abatement type. Read `references/abatement-edge-cases.md`
if any of the following apply:
- Abatement is partial (less than 100%)
- Multiple abatement periods exist
- NNN charges are also abated
- The Free Rent section needs to be connected
- Graduated (step-down) abatement schedule

These cases require modified formula patterns before the rebuild script is run. The script's
`SHEET_CONFIGS` and `build_helper_formula()` function can be extended for non-standard patterns.

---

## Population Workflow

When the user provides a blank template and lease terms to populate, use the structured intake
and population scripts rather than manually writing cell values.

### Step P1: Collect inputs using the intake guide

Read `references/population-intake-guide.md`. Collect fields in the specified order:
1. Group 1 (Required): SF, commencement date, term, base rent, escalation rate
2. Group 2–3: NNN rates and escalation rates (default to 0 if not provided)
3. Group 4: Abatement parameters (default to no abatement)
4. Group 5: Discount rate and analysis date
5. Group 6: NRC items (collect as a list)
6. Group 7: Scenario parameters (accept defaults unless user specifies)

If inputs are ambiguous or incomplete, use the Assumption Register approach: list missing
inputs, propose defaults, and flag materiality before proceeding.

### Step P2: Validate inputs before writing

Run pre-write validation (built into `populate_template.py`):
- All required fields present
- Term is plausible (1–600 months)
- Escalation rates are 0–20%
- NRC dates are parseable

### Step P3: Populate the workbook

```bash
# Create inputs JSON from collected data
# Then populate:
python scripts/populate_template.py workbook.xlsx inputs.json --rebuild-tw --recalc
```

The script writes all input values to correct cells, generates the 124-row date grid
(Period Start, Period End, Month #, Year #), optionally rebuilds T–W, and optionally recalcs.

### Step P4: Post-population validation

```bash
python scripts/validate_model.py workbook.xlsx
```

All 25 assertions should pass. Pay particular attention to:
- Assertion #3: Commencement + term ≈ expiration
- Assertion #9: Abatement amount ties to base rent × abatement %
- Assertion #13: Schedule row count matches term
- Assertion #14: TOTAL row N ties to SUM(schedule N)
- Assertion #17: T–W helper columns populated
- Assertion #24: Annual Summary grand total ties to schedule TOTAL

---

## Assumption register (for audit reports)

When materially important inputs are missing or ambiguous, do not guess — surface them explicitly:

| Missing Input | Why It Matters | Proposed Default | Assumption Flag |
|---------------|---------------|-----------------|----------------|
| [Input] | [Impact on output] | [Reasonable default] | [High / Medium / Low materiality] |

---

## Reference files

`references/workbook-specification.md` — **Read this first for any work on the DEODATE Lease
Obligation Analysis workbook.** Contains the full 4-sheet architecture, complete input register
with exact cell addresses and canonical values, A–W column layout with formula patterns, complete
scenario table design, NRC table data, known failure modes, escalation logic, abatement convention,
Annual Summary cross-sheet linkage, and Audit Trail interpretation guide.

`references/population-intake-guide.md` — Structured field collection sequence for populating
a blank template. Defines required vs. optional fields, default values, NNN allocation heuristics,
pre-write validation checklist, and the JSON input schema for `populate_template.py`.

`references/issue-severity-examples.md` — Annotated examples of Critical vs. High vs. Medium
issues drawn from real lease schedule audits. Use to calibrate severity classification.

`references/repair-formula-patterns.md` — Common Excel formula patterns for lease schedule
helper columns (T–W), scenario SUMPRODUCT construction (FV and NPV), remaining-obligation
tail-sum logic, OTC date-comparison, effective-month MATCH, and abatement proration.

`references/abatement-edge-cases.md` — Handling non-standard abatement patterns: partial
abatement (50%), multiple abatement periods, NNN-inclusive abatement, graduated (step-down)
abatement, and wiring the disconnected Free Rent section.

---

## Scripts

`scripts/rebuild_helper_columns.py` — Programmatic T–W helper column rebuild. Auto-detects
sheet configuration, generates correct formula strings for all schedule rows, writes via
openpyxl. Supports `--dry-run` for preview and `--recalc` for LibreOffice recalculation.

`scripts/populate_template.py` — Populates a blank template from a structured input dict or
JSON file. Writes all scalar inputs, generates the schedule date grid, optionally triggers
T–W rebuild and recalc. Validates inputs before writing.

`scripts/validate_model.py` — Runs 25 business logic assertions against a populated workbook.
Checks date math, dollar tie-outs, formula integrity, NRC dates, escalation plausibility,
T–W presence, and cross-sheet linkage. Returns structured pass/fail JSON.
