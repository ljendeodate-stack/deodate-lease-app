# Repair Formula Patterns — Lease Schedule and Financial Model Templates

Common Excel formula patterns used in lease schedule helper columns, scenario SUMPRODUCT
construction, remaining-obligation tail-sum logic, and scenario discount applications.
Use these as reference when rebuilding broken helper columns or fixing scenario formulas.

---

## 1. Scenario Helper Columns (Renegotiation Discount)

### Purpose
For each month in the schedule, compute what the tenant would owe under a renegotiated
rent scenario (e.g., 10% base rent discount). The helper column applies the discount to
base rent only and preserves NNN charges unchanged — because a rent renegotiation reduces
rent, not occupancy expenses.

### Pattern
```excel
= IF(abatement_row_condition,
     0,
     base_rent_this_row * (1 - discount_pct)
  ) + NNN_this_row
```

Where:
- `abatement_row_condition`: tests whether the row falls within the abatement period
  (e.g., `C{r}<=$C$37` where C is Month# and C37 is abatement duration)
- `base_rent_this_row`: the escalated base rent for the month (column E in a typical layout)
- `discount_pct`: the scenario discount percentage (e.g., $G$7 for the Modest 10% scenario)
- `NNN_this_row`: total NNN charges for the month (column M in a typical layout)

### Full example (row 63, Modest 10% discount scenario, helper column T)
```excel
=IF($C$13>C63, 0,
   IF(C63<=$C$37, 0,
      IF(C63=$C$37+1, E63*(1-$G$7)*$C$40, E63*(1-$G$7))
   ) + M63
)
```

Explanation of branches:
- `$C$13>C63`: row is before the effective date → exclude from remaining obligation (0)
- `C63<=$C$37`: row falls within abatement period → tenant owes nothing (0)
- `C63=$C$37+1`: first partial month after abatement → apply partial proration factor ($C$40)
- Otherwise: full discounted rent + NNN

---

## 2. Scenario FV via SUMPRODUCT

### Purpose
Sum the scenario helper column for all months at or after the effective date of analysis.
This is the forward obligation under the scenario from the analysis date onward.

### Pattern
```excel
=SUMPRODUCT(
   ($C$63:$C$186 >= $C$13) *
   (T$63:T$186)
)
```

Where:
- `$C$63:$C$186`: Month# column for the schedule range
- `$C$13`: effective month number (computed via MATCH from effective date cell)
- `T$63:T$186`: the scenario helper column

### Discounted (NPV) version
```excel
=SUMPRODUCT(
   ($C$63:$C$186 >= $C$13) *
   (T$63:T$186) /
   (1 + $F$4/12)^($C$63:$C$186 - $C$13 + 1)
)
```

Where `$F$4` is the annual discount rate.

---

## 3. Exit Scenario — Remaining Obligation with Buyout Penalty

### Proportional method (simpler, used when helper columns not available)
```excel
= base_FV * (1 + buyout_penalty_pct)
```

Example: `=F13*(1+G26)` where F13 = base case FV, G26 = 20% penalty.

Note: This approach is valid but treats the penalty as additive to the full remaining
obligation. The SUMPRODUCT approach via helper column allows more granular modeling
(e.g., applying the penalty only to the remaining base rent, not NNN).

### SUMPRODUCT method (preferred for full model fidelity)
Build a helper column W (or equivalent) that applies the exit penalty factor:

```excel
= IF($C$13 > C{r}, 0,
    (E{r} + M{r}) * (1 + $J$26)
  )
```

Then sum via SUMPRODUCT as in section 2. The exit FV row then uses:
```excel
=SUMPRODUCT(($C$63:$C$186>=$C$13)*(W$63:W$186))
```

---

## 4. Remaining Obligation Tail-Sum Pattern

### Purpose
For any given row in the schedule, compute the remaining obligation from that row to
the end of the lease. This creates the "Obligation Remaining" column in a lease ledger.

### Pattern (in the schedule, for column P = Obligation Remaining)
```excel
= SUMPRODUCT(
    ($A$63:$A$186 >= A{r}) *
    (N$63:N$186)
  )
```

Where A is the Period Start Date column and N is the Total Monthly Obligation column.

Or using row number comparison:
```excel
= SUM(N{r}:N$186)
```

The latter (SUM from current row to end) is simpler but requires the model to be on
a fixed last row. The SUMPRODUCT approach is more robust to variable-length schedules.

---

## 5. Effective Month Lookup

### Purpose
Given an analysis date (e.g., C12), find the corresponding month number in the schedule.
Month number is used as an offset for SUMPRODUCT filtering and INDEX/MATCH lookups.

### Pattern
```excel
=IFERROR(MATCH(C12, A63:A186, 1), 1)
```

Where:
- `C12`: the analysis date (date serial)
- `A63:A186`: the Period Start Date column of the schedule
- `1` (match type): find the largest value less than or equal to C12

IFERROR returns 1 (first month) if the date precedes all period start dates.

---

## 6. Dynamic Current Monthly Obligation Lookup

### Purpose
Pull the current escalated monthly rent or NNN amount as of the effective date.

### Pattern
```excel
=INDEX(E$63:E$186, MATCH($C$13, C$63:C$186, 0))
```

Where:
- `E$63:E$186`: the column to pull from (e.g., Scheduled Base Rent)
- `$C$13`: the effective month number
- `C$63:C$186`: the Month# column

The MATCH finds the row where Month# equals the effective month, and INDEX retrieves
the escalated value from that row.

---

## 7. OTC Remaining (Non-Recurring Charges from analysis date forward)

### Purpose
Sum all one-time charges (NRCs) with a due date at or after the effective analysis date.

### Pattern
```excel
=SUMPRODUCT(
   (NRC_amount_range) *
   (NRC_date_range >= analysis_date)
)
```

Example:
```excel
=SUMPRODUCT(($F$46:$F$58)*($G$46:$G$58>=C{r}))
```

### Common failure modes
- NRC date cell contains text (e.g., "Within 30 days") → comparison evaluates FALSE → charge excluded
- NRC date cell is blank → blank = 0 in numeric context → may always be included or always excluded
  depending on comparison direction

Fix: Enter actual date serials for all NRC items. For charges without firm dates,
enter a reasonable estimated date and flag the cell as an assumption.

---

## 8. Abatement Period Logic

### Standard approach: monthly obligation becomes $0 during abatement months

```excel
Abatement row condition:
  = (Month# <= abatement_duration_months)
    OR (Period_Start_Date <= abatement_end_date)

Monthly obligation with abatement:
  = IF(abatement_condition, 0, scheduled_obligation)
```

### Partial month at abatement boundary

The month where the abatement period ends may be a partial month. Apply a proration factor:

```excel
proration_factor = days_of_full_rent / days_in_month

= IF(is_boundary_month,
     scheduled_obligation * proration_factor,
     IF(is_abatement_month, 0, scheduled_obligation)
  )
```

### Key convention
The abatement end date is the **last day of abatement (inclusive)**. Full rent begins the
following calendar day. A row is an abatement row only when its entire period falls on or
before the abatement end date; boundary months are not full abatement rows.
