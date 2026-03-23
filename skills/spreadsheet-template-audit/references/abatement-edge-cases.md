# Abatement and Free Rent Edge Cases

Reference for handling non-standard abatement patterns in the DEODATE Lease
Obligation Analysis workbook. The standard template supports a single contiguous
abatement period at lease commencement with 100% base rent forgiveness. This
document covers the variants that require formula modifications.

---

## Case 1: Partial Abatement (e.g., 50% of Base Rent)

**When it occurs:** Lease specifies reduced rent (not $0) during a concession period.
Example: "Tenant pays 50% of scheduled base rent for months 1–6."

**Current model behavior:** The abatement percentage cell (`$C$40` in LS2, `$C$32` in LS)
controls the proration at the boundary month. Setting it to 0.50 does the right thing
for the boundary month proration, but the abatement-period formula branch returns 0
(full abatement) for months within the period regardless of the percentage.

**Required formula modification (column F — Base Rent Applied):**

Current:
```
=IF($C$37=0, E{r}, IF(C{r}<=$C$37, 0, IF(C{r}=$C$37+1, E{r}*$C$40, E{r})))
```

Modified for partial abatement:
```
=IF($C$37=0, E{r}, IF(C{r}<=$C$37, E{r}*(1-$C$40), IF(C{r}=$C$37+1, E{r}, E{r})))
```

**Convention change:** `$C$40` semantics flip — from "proration factor at boundary" to
"abatement percentage" where 1.0 = full abatement (pays $0) and 0.5 = half abatement
(pays 50%). Under the modified formula:
- During abatement months: tenant pays `E{r} * (1 - abatement_pct)`
- At boundary month: tenant pays full rent (no proration needed for partial)
- After abatement: normal

**Also modify column G (Abatement display):**
```
=IF($C$37=0, 0, IF(C{r}<=$C$37, -(E{r}*$C$40), IF(C{r}=$C$37+1, 0, 0)))
```

**Also modify helper columns T–W:** The helper column formula applies the scenario
discount to the base rent portion. During partial abatement months, the discounted
rent should be applied to the reduced (post-abatement) rent, not to zero:

```
T{r} = IF($C$37=0,
         E{r}*(1-$G$10),
         IF(C{r}<=$C$37,
            E{r}*(1-$C$40)*(1-$G$10),
            IF(C{r}=$C$37+1,
               E{r}*(1-$G$10),
               E{r}*(1-$G$10)
            )
         )
       ) + M{r}
```

---

## Case 2: Multiple Abatement Periods

**When it occurs:** Lease grants a second concession period later in the term.
Example: "Months 1–4 at $0 rent, and months 25–26 at $0 rent."

**Current model behavior:** Only one abatement period is supported. The schedule
formula checks `C{r} <= $C$37` (abatement duration from commencement). A second
period later in the lease is not captured.

**Approach A — Dedicated second abatement input block (recommended)**

Add a second set of abatement inputs:
- `C45`: Second abatement start month (Month # in schedule)
- `C46`: Second abatement end month (Month # in schedule)
- `C47`: Second abatement percentage (0–1)

Modify the schedule formulas:

Column F (Base Rent Applied):
```
=IF($C$37=0, E{r}, IF(C{r}<=$C$37, 0, IF(C{r}=$C$37+1, E{r}*$C$40, E{r})))
 * IF(OR($C$45="", $C$45=0), 1,
      IF(AND(C{r}>=$C$45, C{r}<=$C$46), 1-$C$47, 1))
```

This multiplies the first-abatement result by a second factor that is 1 (no effect)
outside the second abatement period, and `(1 - pct)` inside it.

Column G (Abatement display): show both abatement amounts.

Helper columns T–W: same multiplicative layer.

**Approach B — Free Rent column override (alternative)**

If the Free Rent section (rows 44–50 in LS2) is meant to handle the second period,
wire it by adding a conditional in column F that checks whether the current month
falls within the Free Rent date range.

**Which approach to use:** Ask the user. Approach A is more explicit and keeps both
abatement definitions in the same input area. Approach B uses the existing Free Rent
layout but requires connecting the currently-disconnected section.

---

## Case 3: Abatement Applies to NNN (Rare)

**When it occurs:** Some leases abate both base rent and NNN charges during the
concession period. Example: "Tenant pays $0 in total occupancy cost for months 1–3."

**Current model behavior:** NNN columns H–L are not affected by abatement. They
escalate normally from Month 1 and are always included in Total NNN (M) and
Total Monthly Obligation (N).

**Required formula modification:**

Apply the same IF-abatement logic to each NNN column:

Column H (CAMS):
```
=IF($C$37=0, $C$24*(1+$C$30)^(D{r}-1),
   IF(C{r}<=$C$37, 0,
      IF(C{r}=$C$37+1, $C$24*(1+$C$30)^(D{r}-1)*$C$40,
         $C$24*(1+$C$30)^(D{r}-1)
      )
   )
)
```

Repeat for columns I, J, K, L.

**Impact on helper columns T–W:** If NNN is also abated, the helper column formula
needs no additional change — it already adds `M{r}` which will be zero during
abatement. The discount percentage still applies only to base rent (renegotiation
scenario discounts only base rent, not NNN).

**Impact on Annual Summary:** No formula change needed if the SUMIF references
columns F and M correctly — the zero months are included in the SUMIF sum and
naturally produce lower annual totals.

---

## Case 4: Wiring the Free Rent Section (Rows 44–50 in LS2)

The Free Rent section exists with labels but no formula connections. If the user
intends this section to replace or supplement the Abatement section:

**Option 1 — Replace Abatement with Free Rent (rename only)**

1. Copy values from Free Rent inputs (C45–C49) to Abatement inputs (C37–C42)
2. Clear or hide the Free Rent section
3. No formula changes needed — schedule already references C37–C42

**Option 2 — Wire Free Rent as a second abatement period**

1. Populate Free Rent duration, start, end, and percentage in C45–C49
2. Add the second abatement conditional to columns F, G, and T–W (see Case 2 above)
3. Update the Audit Trail to log which months are in the second abatement period

**Option 3 — Wire Free Rent as the primary period, Abatement as secondary**

If the lease has free rent at commencement (handled by Free Rent) and a separate
abatement later (handled by Abatement):
1. Repoint schedule formulas from `$C$37` to the Free Rent cell addresses
2. Treat the Abatement section as the second period per Case 2

**Recommendation:** Before wiring, confirm with the user which option matches the
lease language. The most common pattern is that "Free Rent" and "Abatement" mean
the same thing (Case: Option 1). Two separate concession periods (Options 2–3) are
less common and should be confirmed explicitly.

---

## Case 5: Graduated Abatement (Escalating Free Rent)

**When it occurs:** Abatement percentage decreases over the concession period.
Example: "Month 1–2: 100% free rent, Month 3–4: 50% free rent, Month 5: 25% free rent."

**Current model behavior:** A single abatement percentage (`$C$40`) applies uniformly
to all abatement months.

**Approach:** Replace the single-percentage input with a per-month override column.
Add a new column (or repurpose column G for this purpose) that holds the abatement
percentage for each month. If the cell is blank or 0, no abatement. If it contains
0.5, 50% abatement for that month.

Column F becomes:
```
=E{r} * (1 - IF(G{r}="", 0, G{r}))
```

This is the most flexible approach but requires manually entering or computing the
abatement percentage for each month. For a graduated schedule with known step-downs,
a helper formula can derive the percentage from the month number.

**Note:** This approach changes the semantic meaning of column G from "abatement dollar
display" to "abatement percentage input." The abatement dollar amount can be derived
from `E{r} * G{r}` for display elsewhere. Confirm with the user before making this
structural change.

---

## Pre-Repair Checklist for Abatement Modifications

Before modifying abatement formulas:

1. Confirm the abatement type: single-period, multi-period, partial, NNN-inclusive, or graduated
2. Confirm the convention for `$C$40` / `$C$32`: does it mean "proration at boundary" or
   "abatement percentage for the period"?
3. Back up the workbook before making formula changes
4. After modifying columns F and G, rebuild T–W helper columns to match the new abatement logic
5. Run `validate_model.py` to verify:
   - Abatement column G total ties to expected
   - TOTAL row N ties to SUM(schedule N)
   - P{first_row} = SUM(N) + S{first_row}
6. Change C12 (effective date) to three test values and confirm scenario outputs respond correctly
