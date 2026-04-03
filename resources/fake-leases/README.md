# Fake Lease OCR Fixtures

These fixtures are synthetic lease excerpts created to test OCR semantics, preview fidelity, and Excel parity without using customer documents.

Contents:
- `pdf/` contains upload-ready PDF leases for the app's OCR path.
- `source/` contains the text source used to generate each PDF.
- `results/` is reserved for captured OCR outputs and evaluation notes.

Fixture intent:
- `annual-explicit-schedule-and-nnn` tests a clean annual rent schedule with explicit recurring NNN escalations.
- `annual-narrative-rent-and-operating-expenses` tests whether the OCR path can synthesize a regular annual schedule from narrative escalation language alone.
- `irregular-five-year-step-with-annual-charges` tests explicit non-annual base rent steps plus annual recurring charge escalations.
- `sf-based-annual-rent` tests the `$ / SF / year` path and whether square-footage-dependent rent semantics are preserved.
- `abatement-percent-by-month` tests explicit month-number percentage abatements such as Month 4 = 50%.
- `abatement-multi-percent-sequence` tests several different abatement percentages across separate lease months.
- `abatement-dated-percent-events` tests dated percentage abatements that should map onto resolved monthly rows.

Recommended use:
1. Upload the PDFs from `pdf/` through the scan/OCR path.
2. Confirm whether the schedule step and assumption form auto-populate as expected.
3. Compare actual OCR output against the notes in `results/ocr-evaluation.md`.

Additional upload-ready text fixtures:
- The `source/` folder now also includes `.txt` versions of the three percentage-abatement fixtures above.
- These `.txt` files can be uploaded directly through the current app intake flow when PDF generation tooling is unavailable in the local workspace.

These fixtures are digitally generated PDFs, so they test extraction semantics rather than scan-quality degradation.
