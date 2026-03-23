# Issue Severity Examples — Spreadsheet Template Audit

Reference examples drawn from commercial lease schedule and financial model audits.
Use these to calibrate severity classification in the audit report.

---

## CRITICAL

**Pattern: Helper columns entirely empty, scenario SUMPRODUCT returns $0**

> Cells T63:W186 contain no formulas. The scenario FV formulas in G13, H13, I13, G32, H32, I32
> all use `=SUMPRODUCT(...T$63:T$186)` etc. Because the range is empty, every non-base-case FV
> evaluates to $0. This cascades into: Gross Savings = Base FV - $0 = Base FV (100% savings for
> all scenarios), NPV Savings = Base NPV (same), % Savings = 100% across the board.
> Root cause: A formatting operation applied across T:W cleared the formula content.

Downstream impact: All scenario comparisons are non-functional. The model appears to work but
produces completely wrong outputs. A decision-maker reading the output would conclude every
renegotiation scenario saves 100% of the lease obligation — the opposite of a useful analysis.

---

**Pattern: Formula cell blank — no formula where one is required**

> J32 is blank. It should reference column W (the 50% exit scenario helper), consistent with
> G32 (→ T), H32 (→ U), I32 (→ V). The 50% exit FV row has no calculation at all.

Downstream impact: The most punitive exit scenario (50% buyout penalty) has no computed FV.
Users will not notice the blank; the row displays as zero, which is indistinguishable from
"the model calculated zero" vs. "no formula exists."

---

## HIGH

**Pattern: Orphan formulas in unlabeled helper rows**

> F21 = `=SUM(N63:N186)` returning $5,128,866. This sums the full lease obligation regardless
> of the effective date of analysis. F22 = `=F7*(1-0.1)` returning 0. G22 = `=F10*(1-0.3)`
> returning $7,107. These rows have no labels and appear to be intermediate calculation aids
> from an earlier model version. They are not referenced by any labeled output cell.

Impact: Produces misleading intermediate values that appear in the visible model. A reviewer
scanning the sheet may mistake these for current, intentional outputs.

---

**Pattern: Dual FV calculation approaches coexisting in the same scenario table**

> Exit scenario rows 32–35 compute FV via SUMPRODUCT from helper columns (currently broken).
> Exit scenario rows 36–39 compute FV via `=F13*(1-buyout%)` (currently working).
> These are not equivalent: SUMPRODUCT from helper columns can model remaining-term-only
> obligation; the proportional method discounts the full base case FV. Once helper columns
> are repaired, both rows will show non-zero values but different numbers. A reviewer will
> not know which row is the authoritative output.

---

**Pattern: Input cell doubles as scenario display cell**

> F15 serves as both: (a) the Free Rent Months input assumption (currently = 3), and (b) the
> base-case column display in the renegotiation scenario table. If a user thinks F15 is a
> read-only scenario output and overwrites it with "0" expecting to see what the model looks
> like without free rent, they have silently changed the assumption for all scenarios.

---

## MEDIUM

**Pattern: Input section exists with no formula linkage to the calculation engine**

> B44:C55 is labeled "Free Rent (New)" with rows for duration, start date, end date, and
> assumption percentage. All label cells are populated. All value cells are empty (user has
> not entered values yet). The schedule formulas in rows 63–186 reference `$C$37` (Abatement
> Duration) and `$C$40` (Abatement %), which are in the original Abatement section at B36:C41.
> The new Free Rent section has zero formula connections to the schedule.

Impact: If the user enters a second abatement period into the Free Rent section expecting it
to flow through to the schedule, nothing will change. The model will silently ignore the inputs.

---

## LOW

**Pattern: One-time charge date stored as text string**

> G50 = "Within 30 days of Tenant occupancy" (text). The OTC Remaining formula uses:
> `=SUMPRODUCT(($F$46:$F$58)*($G$46:$G$58>=$A{row}))`. A text string compared to a date
> serial evaluates to FALSE. The -$15,000 Moving Allowance is excluded from remaining
> obligation calculations for all analysis dates.

Impact: OTC Remaining is understated by $15,000 from any analysis date before the allowance
would otherwise be triggered. The error is silent — no formula error appears.

---

**Pattern: One-time charge with no date entered**

> G58 (Letter of Credit) = blank. Same SUMPRODUCT date-comparison logic as above: blank
> evaluates to 0, which is less than any current date serial (post-1900). Depending on
> comparison direction, this either always includes or always excludes the $25,000 charge.
> A date must be entered to produce a deterministic result.
