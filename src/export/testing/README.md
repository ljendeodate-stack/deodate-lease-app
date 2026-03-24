# Semantic Export Harness

## Purpose

This harness protects workbook meaning outside the runtime UI path. It generates representative `.xlsx` exports from fixture inputs, reads the generated workbook programmatically, and runs high-signal semantic checks against the `Scenario Analysis` sheet.

The goal is early detection of semantic workbook drift before manual Excel review.

## Run

```bash
npm run semantic-export:check
```

Optional automated test entry:

```bash
npm run test:semantic-export
```

Generated workbook samples are written to:

`scripts/semantic-export/output/`

## What It Checks Today

- No explicit formula-error cells in `Scenario Analysis`
- Effective Date of Analysis defaults to the first valid schedule date
- `Additional Rent` labels are correct in renegotiation and exit panels
- Non-zero leases use effective-row routing semantics instead of exact-date false zeroing
- Scenario values remain internally plausible enough to catch obvious routing drift
- One-time charges remain separate from `Additional Rent`
- Basic style/state signal: analysis-date input cell retains blue input styling

## Current Fixture Set

- Standard lease with non-zero base rent and NNN
- Lease with abatement
- Lease with one-time charges
- Lease with a non-anchor analysis date

## What It Does Not Yet Check

- Full legacy parity versus every semantic in `output_template.xlsx`
- Lease Schedule and Annual Summary semantic parity
- Rich visual parity beyond a few style/state signals
- Excel-calculated values after a live recalc in desktop Excel
- Exhaustive scenario math validation across every scenario column

## Design Notes

- The harness reuses the existing JS engine and workbook export path.
- `src/utils/exportUtils.js` now exposes a workbook-building entry point so Node-side tooling can generate workbooks without DOM-driven download behavior.
- Assertions prefer semantic extraction helpers and formula-intent checks over brittle coordinate snapshots.
