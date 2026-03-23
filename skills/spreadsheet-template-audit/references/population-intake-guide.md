# Population Intake Guide — DEODATE Lease Obligation Analysis

Use this guide when populating a blank lease schedule template from source data.
Collect fields in the order listed. Required fields must be present before
population proceeds. Optional fields use the defaults shown if omitted.

---

## Collection Order and Field Definitions

### Group 1 — Space and Term (Required)

These must be known before any calculation can proceed.

| # | Field | Format | Example | Notes |
|---|-------|--------|---------|-------|
| 1 | Rentable SF | Integer | 12,500 | Total rentable square footage. Verify unit (SF vs. units). |
| 2 | Lease Commencement Date | MM/DD/YYYY | 03/01/2018 | First day of lease term. |
| 3 | Total Lease Term (Months) | Integer | 124 | Full term including abatement months. |
| 4 | Base Rent Year 1 Monthly ($) | Currency | $28,645.83 | Monthly scheduled base rent before escalation. |
| 5 | Base Rent Annual Escalation (%) | Decimal | 0.03 (3%) | Annual compound escalation rate. |

**Derived from Group 1:**
- Rent Commencement Date → defaults to Lease Commencement Date
- Lease Expiration Date → commencement + (term - 1) months, last day of that month
- Effective Date of Analysis → defaults to first of current month

### Group 2 — NNN Charges (Optional, default = $0)

| # | Field | Format | Example |
|---|-------|--------|---------|
| 6 | CAMS Year 1 Monthly ($) | Currency | $3,125.00 |
| 7 | Insurance Year 1 Monthly ($) | Currency | $1,562.50 |
| 8 | Taxes Year 1 Monthly ($) | Currency | $2,604.17 |
| 9 | Security Year 1 Monthly ($) | Currency | $520.83 |
| 10 | Other Items Year 1 Monthly ($) | Currency | $260.42 |

If provided as annual amounts, divide by 12. If provided as $/SF amounts,
multiply by Rentable SF then divide by 12.

### Group 3 — Escalation Rates (Optional, default = Base Rent rate for CAMS/Ins/Tax, 2% for Sec/Other)

| # | Field | Format | Default |
|---|-------|--------|---------|
| 11 | CAMS Escalation (%) | Decimal | Same as base rent |
| 12 | Insurance Escalation (%) | Decimal | Same as base rent |
| 13 | Taxes Escalation (%) | Decimal | Same as base rent |
| 14 | Security Escalation (%) | Decimal | 0.02 (2%) |
| 15 | Other Items Escalation (%) | Decimal | 0.02 (2%) |

### Group 4 — Abatement (Optional, default = no abatement)

| # | Field | Format | Default | Notes |
|---|-------|--------|---------|-------|
| 16 | Abatement Duration (months) | Integer | 0 | 0 = no abatement period |
| 17 | Abatement Start Date | MM/DD/YYYY | Lease Commencement | Usually equals commencement |
| 18 | Abatement End Date | MM/DD/YYYY | Derived | Start + duration - 1 month, last day |
| 19 | Abatement % of Full Rent | Decimal 0–1 | 1.0 (100%) | 1.0 = full abatement, 0.5 = half |
| 20 | Abatement Amount ($) | Currency | Base Rent Year 1 | Monthly rent forgiven during abatement |
| 21 | Additional Abatement? | yes/no | no | Flags a second abatement period later in lease |

**Validation checks for abatement:**
- Duration must be < Total Lease Term
- Start date must be >= Lease Commencement
- End date must be <= Lease Expiration
- Abatement amount should equal Base Rent Year 1 × Abatement % (flag if it doesn't)

### Group 5 — Discount Rate and Analysis Date (Optional)

| # | Field | Format | Default |
|---|-------|--------|---------|
| 22 | Discount Rate (%) | Decimal | 0.07 (7%) |
| 23 | Effective Date of Analysis | MM/DD/YYYY | First of current month |

### Group 6 — Non-Recurring Charges (Optional)

Collect as a list. Each item has three fields:

| Field | Format | Required? |
|-------|--------|-----------|
| Label | Text | Yes |
| Amount (USD) | Currency (negative = landlord concession) | Yes |
| Date Incurred/Due | MM/DD/YYYY | Recommended — text dates are silently excluded from OTC calculations |

**Common NRC items (check lease for these):**
- Security Deposit (positive — tenant outflow)
- TIA — Tenant Improvement Allowance (negative — landlord concession)
- Landlord Work Contribution (negative)
- Moving Allowance (negative)
- Base Rent Abatement total (negative — should equal abatement months × monthly rent)
- Lease Commission — Tenant's Broker (positive)
- Lease Commission — Landlord's Broker (positive)
- Parking Stall Deposit (positive)
- Letter of Credit (positive)
- Any change-order or build-out charges (positive)

**NRC sign convention:** Positive = tenant cost / outflow. Negative = landlord concession / credit to tenant.

### Group 7 — Scenario Parameters (Optional)

| Field | Format | Default |
|-------|--------|---------|
| Renegotiation Discounts | List of 4 decimals | [0, 0.1, 0.2, 0.3] |
| Exit Buyout Percentages | List of 5 decimals | [0, 0.2, 0.3, 0.4, 0.5] |
| Free Rent Months | Integer | 0 |
| TI per SF ($) | Currency | $0 |

---

## Intake Sequence

When collecting inputs from a user or lease document:

1. Ask for Group 1 first. Do not proceed without all 5 required fields.
2. Ask for Group 2 and Group 3 together (NNN rates and escalation rates).
   If the user provides a single "NNN rate" or "additional rent" figure,
   ask how to split it across the 5 categories. If unknown, allocate:
   - CAMS: 40% of total NNN
   - Insurance: 20%
   - Taxes: 30%
   - Security: 5%
   - Other: 5%
   Flag this allocation as an assumption.
3. Ask about abatement. Leases with abatement almost always mention it
   prominently ("free rent period," "rent abatement," "rent concession").
4. NRC items can be collected last — they don't affect the monthly schedule.
5. Scenario parameters rarely need customization; accept defaults unless
   the user specifies different comparison levels.

---

## Pre-Write Validation Checklist

Run these checks after collecting inputs and before writing to the workbook:

| # | Check | Pass Condition |
|---|-------|---------------|
| 1 | Term ≤ 600 months | Prevents template overflow |
| 2 | Term ≤ (schedule_last_row - schedule_first_row + 1) | Schedule can hold all months |
| 3 | Commencement + Term ≈ Expiration | Dates are internally consistent |
| 4 | Abatement Duration < Term | Abatement doesn't exceed lease |
| 5 | Abatement Amt ≈ Base Rent × Abatement % | Dollar amount ties to percentage |
| 6 | All escalation rates 0–20% | No implausible escalation |
| 7 | All NNN rates ≥ 0 | No negative NNN charges |
| 8 | All NRC dates are parseable date serials | Text dates will be silently excluded from OTC |
| 9 | NRC Abatement total ≈ Abatement months × Base Rent | NRC and schedule abatement are consistent |
| 10 | Rentable SF > 0 | Prevents division by zero in $/SF columns |

---

## JSON Input Format

When passing inputs programmatically to `populate_template.py`:

```json
{
  "rentable_sf": 12500,
  "lease_commencement_date": "2018-03-01",
  "total_lease_term_months": 124,
  "base_rent_year1": 28645.83,
  "base_rent_escalation_rate": 0.03,
  "cams_year1": 3125.00,
  "insurance_year1": 1562.50,
  "taxes_year1": 2604.17,
  "security_year1": 520.83,
  "other_items_year1": 260.42,
  "cams_escalation_rate": 0.03,
  "insurance_escalation_rate": 0.03,
  "taxes_escalation_rate": 0.03,
  "security_escalation_rate": 0.02,
  "other_items_escalation_rate": 0.02,
  "abatement_duration_months": 4,
  "abatement_pct": 1.0,
  "discount_rate": 0.07,
  "effective_date_of_analysis": "2026-06-01",
  "free_rent_months": 3,
  "ti_psf": 10,
  "nrc_items": [
    {"label": "Security Deposit", "amount": 37500, "date": "2018-03-01"},
    {"label": "TIA — Initial Funding", "amount": -125000, "date": "2018-07-15"}
  ]
}
```
