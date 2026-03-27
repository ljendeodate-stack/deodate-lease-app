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

Recommended use:
1. Upload the PDFs from `pdf/` through the scan/OCR path.
2. Confirm whether the schedule step and assumption form auto-populate as expected.
3. Compare actual OCR output against the notes in `results/ocr-evaluation.md`.

These fixtures are digitally generated PDFs, so they test extraction semantics rather than scan-quality degradation.
