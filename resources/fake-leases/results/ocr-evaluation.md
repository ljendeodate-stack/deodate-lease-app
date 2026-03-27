# OCR Evaluation

Evaluation date: March 26, 2026
Updated after semantic repair: March 27, 2026

Method:
- Generated four synthetic lease PDFs from the `source/` texts in this folder.
- Ran the live OCR extraction prompt currently used by `src/ocr/extractor.js` against each PDF.
- Saved each returned payload as `*.ocr.json` in this folder.
- Checked the returned `rentSchedule` and `recurringCharges` fields against the app's prepopulation path in `src/App.jsx` and `src/ocr/chargeNormalizer.js`.

Conclusion:
- Regular recurring charge escalations can be auto-populated today when the lease language is explicit and clean.
- Base rent escalation can also be auto-populated when OCR can either read an explicit rent schedule or confidently synthesize yearly tiers from clear narrative language.
- The prior `$ / SF / year` semantic gap has now been repaired in code: the extractor performs a deterministic post-OCR check against the PDF text and forces `sfRequired = true` when rent is clearly expressed on a square-footage basis, even if the model forgets that flag.

Fixture results:

1. `annual-explicit-schedule-and-nnn.pdf`
- Result: strong success.
- OCR returned a 3-row `rentSchedule`.
- OCR returned `recurringCharges` for Operating Expenses, Insurance, and Real Estate Taxes with `year1`, `escPct`, `chargeStart`, and `escStart`.
- Auto-population expectation: high confidence. The current app will populate the schedule and the recurring charge escalation fields cleanly.

2. `annual-narrative-rent-and-operating-expenses.pdf`
- Result: success, with one semantic caveat.
- OCR synthesized a 3-row annual `rentSchedule` from narrative annual escalation language even though no explicit rent table was provided.
- OCR returned `Estimated Operating Expenses` with `escPct = 3` and `Administrative Fee` with `escPct = 2`.
- Auto-population expectation: likely good for clean narrative annual leases.
- Caveat: this depends on model reasoning rather than table extraction, so it is inherently less deterministic than an explicit schedule.

3. `irregular-five-year-step-with-annual-charges.pdf`
- Result: strong success.
- OCR returned a 2-row irregular `rentSchedule` matching the five-year base rent steps.
- OCR also returned annual recurring charge escalations for Common Area Maintenance, Insurance, and Management Charge.
- Auto-population expectation: high confidence. This is the clearest indication that the current OCR path can support your preferred split:
  irregular base rent schedule rows plus regular annual recurring charge escalations.

4. `sf-based-annual-rent.pdf`
- Raw provider result: partial success.
- OCR returned a 3-row `rentSchedule` with monthly dollar rent derived from the stated `$ / SF / year` rates and the extracted square footage.
- OCR correctly returned recurring escalations for Property Taxes and Property Insurance.
- Raw limitation observed on March 26, 2026: `sfRequired` came back `false`, even though the prompt instructs the model to mark it `true` for rent expressed as `$ / SF`.
- Current app behavior after the March 27, 2026 repair: the extractor corrects that semantic miss and preserves square-footage dependency by forcing `sfRequired = true` when the PDF text clearly states base rent on a `$ / SF` basis.

Practical assessment:
- For explicit annual escalations and explicit recurring charge language, OCR auto-population is presently viable.
- For clean narrative annual escalations, OCR can work, but the result should still be treated as review-required rather than deterministic.
- For `$ / SF` rent semantics, the raw provider can still miss the semantic flag, but the app now repairs that specific miss before prepopulation.
- These fixtures do not test scan degradation, handwritten edits, poor image quality, or dense legal tables exported from image-based PDFs.

Recommended next hardening step:
- Add a regression harness that replays these PDFs through OCR and asserts:
  - `rentSchedule` row counts and period boundaries,
  - recurring charge `escPct` and `escStart`,
  - repaired `sfRequired` behavior for `$ / SF` leases,
  - and preservation of irregular base-rent tiers.
