# DEODATE Lease Obligation Analysis — Workbook Specification

This reference documents the canonical structure, input register, formula architecture, and
known failure modes of the DEODATE Lease Obligation Analysis workbook. Use it to understand
intent when auditing, repairing, or populating this template.

---

## Workbook Overview

**Purpose:** Commercial lease obligation analysis for a single tenant lease. Calculates the full
monthly charge ledger (base rent + 5 NNN categories + abatement), evaluates remaining obligation
from any analysis date, and produces renegotiation and early exit scenario comparisons.

**Sheets:** 4 sheets in a specific order:
1. `Lease Schedule` — Blank/template version. All input values at zero; formulas intact.
2. `Annual Summary` — Cross-sheet annual rollup by lease year (SUMIF from Lease Schedule).
3. `Audit Trail` — Per-month calculation debug log (Period Factor, Proration Factor, NNN escalation audit).
4. `Lease Schedule (2)` — Live/populated version. Same structure as Lease Schedule but with actual values and a restructured input layout.

---

## Sheet 1: Lease Schedule (Template / Blank)

### Row Layout

| Rows | Section | Purpose |
|------|---------|---------|
| 1–2 | Title | Lease obligation title + property name placeholders |
| 3–16 | Lease Drivers | Core inputs: SF, dates, term, effective date; derived metrics |
| 17–20 | Monthly Rent Breakdown | Date/month display + Year 1 base rent + NNN rate inputs |
| 21–27 | Non-Recurring Charges (NRC) | 13 one-time charge items with amounts and dates |
| 28–34 | Abatement | Abatement duration, dates, percentage, and additional abatement flag |
| 36 | Section label | "Existing Lease" |
| 37 | Column headers | Schedule column headers |
| 38–161 | Monthly Schedule | 124 rows of monthly charge data (Month 1 = Mar 2018, Month 124 = Jun 2028) |
| 162 | TOTAL | SUM row for schedule columns E–N |

### Lease Drivers Input Cells (Column C)

| Cell | Label | Type | Notes |
|------|-------|------|-------|
| C7 | Rentable SF | Number | 12,500 in the live version |
| C8 | Lease Commencement Date | Date | Mar 1, 2018 |
| C9 | Rent Commencement Date | Date | Same as commencement |
| C10 | Total Lease Term (Months) | Number | 124 |
| C11 | Lease Expiration Date | Date | Jun 1, 2028 |
| C12 | Effective Date of Analysis | Date | Driver cell — all scenario metrics filter from this date |
| C13 | Effective Month # | Formula | `=IFERROR(MATCH(C12,A{first}:A{last},1),1)` |
| C14 | Months Remaining | Formula | `=MAX(0,C10-C13+1)` |
| C15 | Month # of effective date | Formula | `=C13` |
| C16 | Months until next escalation | Formula | `=12-MOD(C13-1,12)` |

### Escalation Rate Inputs (Column F, rows 5–10 in Lease Schedule)

| Cell | Label |
|------|-------|
| F5 | Annual Base Rent Escalation Rate |
| F6 | CAMS Annual Escalation Rate |
| F7 | Insurance Annual Escalation Rate |
| F8 | Taxes Annual Escalation Rate |
| F9 | Security Annual Escalation Rate |
| F10 | Other Items Annual Escalation Rate |

**Important:** In `Lease Schedule (2)`, the escalation rates were moved to the C column (C29–C34),
directly below the NNN year-1 rates. This is the primary structural difference between the two sheets.

### Year 1 Monthly Rate Inputs (Column C, rows 21–26)

| Cell | Label |
|------|-------|
| C21 | Scheduled Base Rent |
| C22 | Insurance Year 1 Monthly Rate |
| C23 | Taxes Year 1 Monthly Rate |
| C24 | CAMS Year 1 Monthly Rate |
| C25 | Security Year 1 Monthly Rate |
| C26 | Other Items Year 1 Monthly Rate |

### NRC Inputs — Lease Schedule (rows 14–26 of NRC section)

| Columns | Content |
|---------|---------|
| Column F | One-time charge amount (USD) |
| Column G | Incurred / Due Date |

13 line items including: Security Deposit, TIA (Initial + Final Funding), Landlord Work Contribution,
Moving Allowance, Base Rent Abatement, Lease Commissions (Tenant + Landlord broker), Parking Stall
Deposit, HVAC Charge, After-Hours Access Control, Roof/Supplemental Mechanical, Letter of Credit.

### Abatement Inputs

| Cell (Lease Schedule) | Cell (LS2) | Label |
|----------------------|-----------|-------|
| C29 | C37 | Abatement duration (months) |
| C30 | C38 | Abatement start date |
| C31 | C39 | Abatement end date |
| C32 | C40 | Abatement % of full rent (1.0 = 100% abatement) |
| C33 | C41 | Abatement amount (dollars) |
| C34 | C42 | Additional abatement later in lease? (yes/no — informational only) |

**Convention:** `$C$29` (or `$C$37` in LS2) is the abatement duration in months.
The abatement end date is the **last day of abatement (inclusive)**. A row is in full abatement
when `Month# <= abatement_duration`. The boundary month (Month# = duration + 1) applies a proration
factor (`$C$32` or `$C$40`).

---

## Sheet 1 / Sheet 4: Monthly Schedule Column Layout (A–W)

| Col | Excel Col | Label | Type | Formula Pattern |
|-----|-----------|-------|------|-----------------|
| A | A | Period Start | Date input | Hard-coded monthly dates |
| B | B | Period End | Date input | Hard-coded monthly end dates |
| C | C | Month # | Number | Sequential 1–124 |
| D | D | Year # | Number | 1–11 (annual grouping for escalation) |
| E | E | Scheduled Base Rent | Formula | `=$C$21*(1+$F$5)^(D{r}-1)` (LS) or `=$C$21*(1+$C$29)^(D{r}-1)` (LS2) |
| F | F | Base Rent Applied | Formula | IF abatement logic — 0 during abatement, prorated at boundary, full otherwise |
| G | G | Abatement | Formula | Negative abatement amount; 0 outside abatement period |
| H | H | CAMS | Formula | `=$C$24*(1+$F$6)^(D{r}-1)` (LS) or `=$C$24*(1+$C$30)^(D{r}-1)` (LS2) |
| I | I | Insurance | Formula | `=$C$22*(1+$F$7)^(D{r}-1)` (LS) or `=$C$22*(1+$C$31)^(D{r}-1)` (LS2) |
| J | J | Taxes | Formula | `=$C$23*(1+$F$8)^(D{r}-1)` (LS) or `=$C$23*(1+$C$32)^(D{r}-1)` (LS2) |
| K | K | Security | Formula | `=$C$25*(1+$F$9)^(D{r}-1)` (LS) or `=$C$25*(1+$C$33)^(D{r}-1)` (LS2) |
| L | L | Other Items | Formula | `=$C$26*(1+$F$10)^(D{r}-1)` (LS) or `=$C$26*(1+$C$34)^(D{r}-1)` (LS2) |
| M | M | Total NNN ① | Formula | `=H{r}+I{r}+J{r}+K{r}+L{r}` (CAMS + Insurance + Taxes + Security + Other) |
| N | N | Total Monthly Obligation ② | Formula | `=F{r}+M{r}` (Base Rent Applied + Total NNN) |
| O | O | Effective $/SF | Formula | `=IF($C$7=0,0,N{r}/$C$7)` |
| P | P | Obligation Remaining | Formula | `=MAX(SUM(N{r}:N{last})+S{r},0)` — tail sum + OTC |
| Q | Q | Base Rent Remaining | Formula | `=SUM(F{r}:F{last})` — tail sum of Base Rent Applied |
| R | R | NNN Remaining | Formula | `=SUM(M{r}:M{last})` — tail sum of Total NNN |
| S | S | OTC Remaining | Formula | `=SUMPRODUCT((NRC_amounts)*(NRC_dates>=A{r}))` — NRCs due on/after row date |
| T | T | Scenario Helper: Modest (10% discount) | Formula | Should be present; **often cleared by formatting operations** |
| U | U | Scenario Helper: Material (20% discount) | Formula | Should be present; **often cleared by formatting operations** |
| V | V | Scenario Helper: Significant (30% discount) | Formula | Should be present; **often cleared by formatting operations** |
| W | W | Scenario Helper: Exit (50% buyout) | Formula | Should be present; **often cleared by formatting operations** |

### T–W Helper Column Formula Pattern

These columns compute the per-row obligation under each scenario discount. The renegotiation
helpers apply the discount to base rent only; NNN is preserved unchanged.

```
T{r} = IF($C$29=0, E{r}*(1-$K$6), IF(C{r}<=$C$29, 0, IF(C{r}=$C$29+1, E{r}*(1-$K$6)*$C$32, E{r}*(1-$K$6)))) + M{r}
```

Where:
- `$C$29` = abatement duration (cell reference differs between LS and LS2)
- `$K$6` = Modest 10% discount rate (from scenario header)
- `$C$32` = abatement proration factor
- `M{r}` = Total NNN (preserved unchanged in all renegotiation scenarios)

In `Lease Schedule (2)`, the abatement reference shifts to `$C$37` and the discount drivers
are in `$G$10`, `$H$10`, `$I$10` for renegotiation and `$G$29`, `$H$29`, `$I$29`, `$J$29`
for exit scenarios.

**CRITICAL:** In `Lease Schedule (2)`, columns T–W (rows 75–198) are entirely empty — no formulas.
This breaks all non-base-case FV, NPV, Gross Savings, and % Savings calculations.

---

## Sheet 4: Lease Schedule (2) — Restructured Input Layout

### Key Structural Differences vs. Lease Schedule

| Attribute | Lease Schedule | Lease Schedule (2) |
|-----------|---------------|-------------------|
| Escalation rates | Column F, rows 5–10 | Column C, rows 29–34 |
| Abatement block | Rows 29–34 (C column) | Rows 37–42 (C column) |
| NRC table | Rows 14–26 (F=amount, G=date) | Rows 53–65 (C=amount, D=date) |
| Schedule start row | Row 38 | Row 75 |
| Schedule end row | Row 161 | Row 198 |
| TOTAL row | Row 162 | Row 199 |
| Schedule range for SUMPRODUCT | `C38:C161`, `N38:N161` | `C75:C198`, `N75:N198` |
| Free Rent section | Not present | Rows 44–50 (labels only, no formula linkage) |
| Row numbering labels | Column A (sequential 1–14 for input rows) | Column A (1–15 for input rows) |

### Lease Schedule (2) — Complete Input Register

**Lease Drivers (rows 7–16, column C):**

| Cell | Label | Value | Type |
|------|-------|-------|------|
| C7 | Rentable SF | 12,500 | Input |
| C8 | Lease Commencement Date | 2018-03-01 | Input |
| C9 | Rent Commencement Date | 2018-03-01 | Input |
| C10 | Total Lease Term (Months) | 124 | Input |
| C11 | Lease Expiration Date | 2028-06-01 | Input |
| C12 | Effective Date of Analysis | 2026-06-01 (example) | Input — primary driver |
| C13 | Effective Month # | `=IFERROR(MATCH(C12,A75:A198,1),1)` | Formula |
| C14 | Months Remaining | `=MAX(0,C10-C13+1)` | Formula |
| C15 | Month # of effective date | `=C13` | Formula |
| C16 | Months until next escalation | `=12-MOD(C13-1,12)` | Formula |

**Year 1 Monthly Rates (rows 21–26, column C):**

| Cell | Label | Value |
|------|-------|-------|
| C21 | Scheduled Base Rent | $28,645.83 |
| C22 | Insurance Year 1 Monthly Rate | $1,562.50 |
| C23 | Taxes Year 1 Monthly Rate | $2,604.17 |
| C24 | CAMS Year 1 Monthly Rate | $3,125.00 |
| C25 | Security Year 1 Monthly Rate | $520.83 |
| C26 | Other Items Year 1 Monthly Rate | $260.42 |

**Escalation Rates (rows 29–34, column C) — unique to Lease Schedule (2):**

| Cell | Label | Value |
|------|-------|-------|
| C29 | Annual Base Rent Escalation Rate | 3.0% |
| C30 | CAMS Annual Escalation Rate | 3.0% |
| C31 | Insurance Annual Escalation Rate | 3.0% |
| C32 | Taxes Annual Escalation Rate | 3.0% |
| C33 | Security Annual Escalation Rate | 2.0% |
| C34 | Other Items Annual Escalation Rate | 2.0% |

**Abatement Inputs (rows 37–42, column C):**

| Cell | Label | Value |
|------|-------|-------|
| C37 | Abatement duration (months) | 4 |
| C38 | Abatement start | 2018-03-01 |
| C39 | Abatement end | 2018-06-30 |
| C40 | Abatement % of full rent | 1.0 (100%) |
| C41 | Abatement amount (dollars) | $28,645.83 |
| C42 | Additional abatement later in lease? | "no" (informational) |

**Discount Rate:**

| Cell | Label | Value |
|------|-------|-------|
| F7 | Discount Rate | 7.0% |

**NRC Table (rows 53–65, columns C and D):**

| Row | Description | Amount | Date |
|-----|-------------|--------|------|
| 53 | Security Deposit | $37,500 | 2018-03-01 |
| 54 | TIA — Initial Funding | -$125,000 | 2018-07-15 |
| 55 | TIA — Final Funding | -$62,500 | 2018-10-15 |
| 56 | Landlord Work Contribution | -$50,000 | 2019-02-01 |
| 57 | Moving Allowance | -$15,000 | **TEXT** "Within 30 days of Tenant occupancy" ⚠ |
| 58 | Base Rent Abatement (Months 1–4) | -$114,583.32 | 2018-03-01 |
| 59 | Lease Commission — Tenant's Broker (JLL) | $85,937.50 | 2018-03-01 |
| 60 | Lease Commission — Landlord's Broker | $42,968.75 | 2018-03-01 |
| 61 | Parking Stall Deposit (20 stalls) | $10,000 | 2018-03-01 |
| 62 | HVAC Change-Order Charge | $8,500 | 2018-09-01 |
| 63 | After-Hours Access Control Install | $4,200 | 2018-12-01 |
| 64 | Roof Curb / Supplemental Mechanical Work | $12,750 | 2019-04-01 |
| 65 | Letter of Credit (in lieu of cash deposit) | $25,000 | **BLANK** ⚠ |
| 66 | TOTAL | `=SUM(C53:C65)` | — |

⚠ Row 57: Date is a text string — SUMPRODUCT date comparison silently excludes this -$15,000.
⚠ Row 65: Date is blank — $25,000 Letter of Credit excluded from OTC Remaining calculations.

OTC Remaining formula: `=SUMPRODUCT(($C$53:$C$65)*($D$53:$D$65>=$A{row}))`

---

## Scenario Comparison Tables (Lease Schedule (2))

### Renegotiation Scenarios (rows 8–25, columns F–I)

Compares tenant's position under 4 scenarios: Base Case (0%), Modest (10% discount), Material
(20%), Significant (30% rent discount). Discount applies to **base rent only**; NNN is unchanged.

| Row | Label | F (Base) | G–I (Scenarios) | Status |
|-----|-------|----------|-----------------|--------|
| 8 | Effective Date | `=C12` | — | ✅ Dynamic |
| 10 | % Discount | 0 | 0.1 / 0.2 / 0.3 | Input hardcodes |
| 11 | Monthly Rent | `=INDEX(E...,MATCH(C13,...))` | `=F11*(1-G10)` | ✅ |
| 12 | Base/$PSF | `=F11/C7` | same pattern | ✅ |
| 13 | Additional Rent (NNN) | `=INDEX(M...,MATCH(C13,...))` | copies F13 | ✅ |
| 14 | Total Occupancy Cost | `=F11+F13` | same pattern | ✅ |
| 15 | Effective $/PSF | `=F14/C7` | same pattern | ✅ |
| 16 | Lease Obligation (FV) | `=SUMPRODUCT(>=C13 * N...)` | `=SUMPRODUCT(>=C13 * T/U/V...)` | ❌ T/U/V empty → $0 |
| 17 | Gross Savings vs Base | 0 (hardcode) | `=F16-G16` | ❌ Cascades from broken FV |
| 18 | (+)Free Rent months | 3 (INPUT) | `=G11*F18` | ⚠ F18 dual-purpose input/display |
| 19 | (+)TI psf | 10 (INPUT) | `=F19*C7` | ⚠ F19 dual-purpose input/display |
| 20 | Total Savings From Base | "-" | `=SUM(G17:G19)` | ❌ Cascades from broken FV |
| 21 | NPV | `=SUMPRODUCT(>=C13 * N.../discount)` | same with T/U/V | ❌ T/U/V empty → $0 |
| 22 | NPV Savings vs Base | "-" | `=F21-G21` | ❌ Cascades from broken NPV |
| 23 | % Savings vs Base | "-" | `=IFERROR((F21-G21)/F21,0)` | ❌ 0% or 100% depending on state |
| 24–25 | Orphan rows | Full-lease SUM and proportional discount calcs | Various | ⚠ Stale, no labels |

### Exit Scenarios (rows 27–44, columns F–J)

Compares 5 exit/buyout scenarios: Scot-free (0%), Mild (20%), Less Mild (30%), Moderately
Significant (40%), Significant (50% penalty).

| Row | Label | F (Base) | G–J (Scenarios) | Status |
|-----|-------|----------|-----------------|--------|
| 27 | Effective Date | `=C12` | — | ✅ |
| 29 | % Buyout | 0 | 0.2 / 0.3 / 0.4 / 0.5 | Inputs |
| 30–34 | Monthly Rent breakdown | All reference F14 (Total Occupancy Cost) | Same across all scenarios | ✅ (informational) |
| 35 | Lease Obligation (FV) | `=SUMPRODUCT(>=C13 * N...)` | `=SUMPRODUCT(>=C13 * T/U/V...)` | ❌ T/U/V empty → $0 |
| 36 | Gross Savings vs Base | 0 | `=F35-G35` | ❌ Broken |
| 37 | (+)Free Rent | 3 (INPUT) | `=G30*F18` | ⚠ References F18 input |
| 38 | (+)TI psf | 10 (INPUT) | `=F19*C7` | ⚠ References F19 input |
| 39 | Total Savings | `=F16` (renego FV) | `=F16*(1-G29)` | ✅ Proportional method — works independently of T-W |
| 40 | NPV | `=F21` (renego NPV) | `=F21*(1-G29)` | ✅ Proportional method — works independently of T-W |
| 41 | NPV Savings vs Base | "-" | `=F40-G40` | ✅ |
| 42 | % Savings vs Base | "-" | `=IFERROR((F40-G40)/F40,0)` | ✅ |
| 43 | Full-lease SUM check row | `=SUM(N75:N198)` | `=SUM(T/U/V/W...)` | ⚠ T-W empty → $0 |
| 44 | Orphan discount row | Various proportional discounts | — | ⚠ Stale |

**Design ambiguity:** The exit table has two FV/savings calculation approaches:
- Rows 35–36: SUMPRODUCT from helper columns (broken while T-W empty)
- Rows 39–40: Proportional discount from base FV/NPV (currently the only working outputs)

---

## Sheet 2: Annual Summary

Provides a full-lease annual rollup, cross-referencing the Lease Schedule via SUMIF on the
Year # column (column D, rows 38–161 in Lease Schedule / 75–198 in LS2).

| Column | Content | Formula Pattern |
|--------|---------|-----------------|
| A | Period Start | Hard-coded year start dates (Mar 1 annually) |
| B | Period End | Hard-coded year end dates (Feb 28/29 annually; Jun 30 for stub year 11) |
| C | Lease Year | 1–10 + "11 (Stub)" |
| D | Months | `=COUNTIF('Lease Schedule'!$D$38:$D$161, year)` |
| E | Base Rent Applied | `=SUMIF('Lease Schedule'!$D..., year, 'Lease Schedule'!$F...)` |
| F | Total NNN | `=SUMIF(... column M)` |
| G | Total Monthly Obligation | `=SUMIF(... column N)` |
| H | % of Grand Total | `=IF(G13=0,0,G{row}/G13)` |
| 13 | GRAND TOTAL | `=SUM(...)` rows for D–G; H13 = 100.0% hardcode |

**Cross-sheet reference dependency:** Annual Summary hardcodes references to `'Lease Schedule'`
(not `'Lease Schedule (2)'`). If the populated data lives in `Lease Schedule (2)`, the Annual
Summary must be re-pointed to the correct sheet or the schedule data must be on `Lease Schedule`.

---

## Sheet 3: Audit Trail

A per-month calculation audit log. 124 rows (matching the schedule). Not a user-input sheet —
populated by the calculation engine or manually during model QA.

| Column | Label | Content |
|--------|-------|---------|
| A | Period Start | Monthly dates |
| B | Month # | Sequential 1–124 |
| C | Period Factor | 1 for all full months; fractional for partial months |
| D | Proration Factor | 0 or 1 (or fraction for partial months) |
| E | Proration Basis | "full" / "partial" — text flag |
| F | CAMS Esc Year | Escalation year counter for CAMS |
| G | CAMS Active | "true" / "false" — whether charge is active this month |
| H–I | Insurance Esc Year / Active | Same pattern |
| J–K | Tax Esc Year / Active | Same pattern |
| L–M | Security Esc Year / Active | Same pattern |
| N–O | Other Esc Year / Active | Same pattern |

The Audit Trail is used to verify that escalation logic (annual vs. compound), proration, and
charge activation are behaving correctly for each month. It is a diagnostic aid, not a
calculation source — no schedule formulas reference it.

---

## Free Rent Section (Lease Schedule (2), rows 44–50)

This section was added after the original Abatement section. It contains labels but no
formula values, and is **not connected to the monthly schedule**.

| Row | Cell B | Status |
|-----|--------|--------|
| 44 | Free Rent (section label) | Label only |
| 45 | Free Rent duration (months) | Empty — no value entered |
| 46 | Free Rent Start | Empty |
| 47 | Free Rent End | Empty |
| 48 | Free Rent assumption = 100%, if not.. Edit | Label only |
| 49 | Additional abatement later in lease? | Label only |

The monthly schedule formulas reference `$C$37` (Abatement duration) and `$C$40` (Abatement %)
from the original Abatement block. The Free Rent section inputs (if entered) are not wired to
the schedule.

**To connect:** Either wire the schedule's abatement references to the Free Rent cells, or
treat Free Rent as a second abatement period requiring a separate conditional in the schedule
formulas for applicable months.

---

## Known Failure Modes (Template-Specific)

### 1. Helper Columns T–W Cleared by Formatting Operations

The most common failure. When a user applies a format change across columns T–W (e.g., changing
number format, fill color, or cell style via "Format Cells" applied to a column range), Excel
can silently clear formula content from those cells.

**Symptom:** Base Case FV (column F) is correct; all scenario FVs (G/H/I/J) show $0.
**Cascade:** Gross Savings = 100%, NPV Savings = 100%, % Savings = 100% for all scenarios.
**Repair:** Re-enter T–W formulas for all 124 schedule rows using the pattern in
`repair-formula-patterns.md`.

### 2. Annual Summary References Wrong Sheet

Annual Summary uses hardcoded `'Lease Schedule'` references. If working data is in
`Lease Schedule (2)`, the Annual Summary returns zeros.
**Fix:** Replace all `'Lease Schedule'` references in Annual Summary with `'Lease Schedule (2)'`
or ensure the working data is on the `Lease Schedule` tab.

### 3. NRC Date in Text Format (Row 57)

Moving Allowance date = "Within 30 days of Tenant occupancy". The OTC Remaining SUMPRODUCT
treats this as FALSE in a date comparison, silently excluding -$15,000 from the OTC Remaining
balance.
**Fix:** Replace with an estimated date serial. Flag as an assumption.

### 4. NRC Date Blank (Row 65)

Letter of Credit has no date entered. Same exclusion behavior as the text-date issue.
**Fix:** Enter a date.

### 5. Dual-Purpose Input Cells F18 and F19

- F18 = "Free Rent Months" (= 3) — also used as a display cell in the renegotiation Base Case column
- F19 = "TI psf" (= $10) — same dual-purpose issue

A reviewer assuming these are output cells may overwrite the inputs, silently changing the Free
Rent and TI assumptions for all scenario columns.
**Fix:** Move inputs to dedicated, clearly labeled input cells and reference them from the scenario table.

### 6. Exit Scenario FV Rows 35–36 vs. Rows 39–40

Two competing FV calculation methods coexist:
- Rows 35–36: SUMPRODUCT from T–W helper columns (broken while T-W empty; schedule-based)
- Rows 39–40: `=F16*(1-buyout%)` proportional discount (currently the only working outputs)

These produce different results. The SUMPRODUCT approach is more rigorous (accounts for
remaining term only); the proportional approach simply discounts the full forward obligation.
**Recommendation:** Once T-W are repaired, rows 35–36 become the authoritative exit FV.
Rows 39–40 should be relabeled as a simplified cross-check or hidden.

### 7. Row 44 Orphan Formulas (Renegotiation) and Row 43/44 (Exit)

These rows contain unlabeled proportional discount formulas that appear to be intermediate
calculation aids. They are not referenced by any labeled output and produce potentially
misleading values in the visible model.

---

## Escalation Logic

All 6 charge categories use **annual compound escalation** tied to the Lease Year (column D):

```
Charge_amount = Year1_Rate * (1 + escalation_rate)^(YearNumber - 1)
```

The Year # column (D) increments at Month 13 (the first month of Lease Year 2), not at a
calendar year boundary. This means escalation aligns to the lease anniversary, not January.

Example: Month 1–12 = Year 1 → no escalation applied. Month 13–24 = Year 2 → 1 year of
compound growth applied. Month 25–36 = Year 3 → 2 years of compound growth applied.

The abatement period (Months 1–4) affects only the Base Rent Applied column (F) and the
Abatement column (G). All NNN charges (H–L) escalate normally during the abatement period —
the tenant still owes NNN even while base rent is abated.

---

## Remaining Obligation Columns (P, Q, R, S)

These columns implement a "tail sum from current row" pattern — each row shows the total
remaining obligation from that row to the end of the lease.

| Column | Formula | Includes |
|--------|---------|---------|
| P | `=MAX(SUM(N{r}:N{last})+S{r},0)` | Base Rent + NNN + OTC due from this date |
| Q | `=SUM(F{r}:F{last})` | Base Rent Applied only |
| R | `=SUM(M{r}:M{last})` | Total NNN only |
| S | `=SUMPRODUCT((amounts)*(dates>=A{r}))` | NRC items due on/after this row's date |

The P column combines recurring rent obligations (tail-SUM of N) plus the NRC balance (S)
for that row's date. The MAX(…,0) prevents a negative value in the final rows.
