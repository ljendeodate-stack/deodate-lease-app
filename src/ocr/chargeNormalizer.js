/**
 * @fileoverview Pure functions for normalizing LLM-detected recurring charges
 * into the charges[] form-state array expected by InputForm and calculator.js.
 *
 * No UI, React, or API dependencies. All functions are pure.
 *
 * Pipeline:
 *   LLM result.recurringCharges[]
 *     → normalizeRecurringCharge()    (validates/coerces each entry)
 *     → dedupeRecurringCharges()       (removes same-label duplicates; preserves distinct labels even when they share a bucketKey)
 *     → buildChargesFromOCR()          (merges with 5 default slots → charges[])
 */

import { defaultChargesForm } from '../engine/chargeTypes.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Standard bucket keys recognized by calculator.js and InputForm. */
export const STANDARD_BUCKET_KEYS = ['cams', 'insurance', 'taxes', 'security', 'otherItems'];

/** Canonical type values. */
export const CANONICAL_TYPES = { NNN: 'nnn', OTHER: 'other' };

/** Confidence threshold below which a year1 field is flagged for user review. */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// normalizeRecurringCharge
// ---------------------------------------------------------------------------

/**
 * Normalize and validate a single recurring-charge entry from the LLM.
 * Returns null for entries that are structurally unusable (no label).
 *
 * The LLM is instructed to return year1 as monthly already.
 * This function does NOT apply a ÷12 conversion — that would double-convert.
 *
 * @param {*} rc - Raw entry from result.recurringCharges[]
 * @returns {Object|null} Normalized charge or null
 */
export function normalizeRecurringCharge(rc) {
  if (!rc || typeof rc !== 'object') return null;

  const label = typeof rc.label === 'string' ? rc.label.trim() : '';
  if (!label) return null;

  const bucketKey = STANDARD_BUCKET_KEYS.includes(rc.bucketKey) ? rc.bucketKey : null;

  let year1 = rc.year1 != null ? Number(rc.year1) : null;
  if (year1 !== null && (isNaN(year1) || !isFinite(year1))) year1 = null;
  // Sanity guard: a monthly charge > $500 000 is implausible — likely mis-scaled
  if (year1 !== null && year1 > 500_000) year1 = null;

  let escPct = rc.escPct != null ? Number(rc.escPct) : null;
  if (escPct !== null && (isNaN(escPct) || escPct < 0 || escPct > 100)) escPct = null;

  const canonicalType = rc.canonicalType === 'nnn' ? 'nnn' : 'other';

  const confidence =
    typeof rc.confidence === 'number'
      ? Math.min(1, Math.max(0, rc.confidence))
      : 0.5;

  return {
    label,
    year1,
    amountBasis:   typeof rc.amountBasis === 'string' ? rc.amountBasis : 'unknown',
    escPct,
    chargeStart:   typeof rc.chargeStart === 'string' && rc.chargeStart.trim() ? rc.chargeStart.trim() : null,
    escStart:      typeof rc.escStart    === 'string' && rc.escStart.trim()    ? rc.escStart.trim()    : null,
    canonicalType,
    bucketKey,
    confidence,
    evidenceText:  typeof rc.evidenceText === 'string' ? rc.evidenceText.slice(0, 500) : null,
    sourceKind:    typeof rc.sourceKind   === 'string' ? rc.sourceKind : 'narrative_obligation',
  };
}

// ---------------------------------------------------------------------------
// dedupeRecurringCharges
// ---------------------------------------------------------------------------

/**
 * Deduplicate recurring charges detected by the LLM.
 *
 * Identity rule: two entries represent the same obligation only when their
 * normalized labels match (case-insensitive, whitespace-collapsed).
 * bucketKey is a routing hint — charges with different labels are always
 * kept as distinct entries even when they share the same bucketKey.
 *
 * Sort by confidence descending before calling so the highest-confidence
 * entry wins when labels are identical.
 *
 * @param {Object[]} charges - Array of normalized recurring charges
 * @returns {Object[]} Deduplicated array (order preserved for first-seen entries)
 */
export function dedupeRecurringCharges(charges) {
  const usedLabelsNorm = new Set();
  const result = [];

  for (const charge of charges) {
    const normLabel = charge.label.toLowerCase().replace(/\s+/g, ' ').trim();
    if (usedLabelsNorm.has(normLabel)) continue;
    usedLabelsNorm.add(normLabel);
    result.push(charge);
  }

  return result;
}

// ---------------------------------------------------------------------------
// buildChargesFromOCR
// ---------------------------------------------------------------------------

/**
 * Build the charges[] array for InputForm state from an OCR extraction result.
 *
 * Priority:
 * 1. If result.recurringCharges[] is present and non-empty after normalization,
 *    use it as the primary source.
 *    - Charges that map to a standard bucketKey override the corresponding default slot
 *      (e.g. "Operating Expenses" with bucketKey "cams" replaces the empty "CAMS" row).
 *    - Lease-native labels are preserved in displayLabel.
 *    - Detected charges with no bucketKey are appended as custom_N entries.
 * 2. Fall back to the legacy fixed-bucket fields (result.cams, result.insurance, etc.)
 *    when recurringCharges[] is absent, empty, or all entries are invalid.
 *
 * Also returns:
 * - confidenceFlags: additional flag paths (e.g. "charges.0.year1") for low-confidence
 *   or missing-amount entries, to be merged into ocrConfidenceFlags in App.jsx.
 * - notices: non-blocking informational strings about detection quality.
 *
 * @param {Object} ocrResult - Full OCR extraction result from extractor.js
 * @returns {{ charges: Object[], confidenceFlags: string[], notices: string[] }}
 */
export function buildChargesFromOCR(ocrResult) {
  const defaults = defaultChargesForm();

  // --- Try the new recurringCharges[] path ---
  const raw = Array.isArray(ocrResult.recurringCharges) ? ocrResult.recurringCharges : [];
  const normalized = raw.map(normalizeRecurringCharge).filter(Boolean);

  // Sort by confidence descending so higher-confidence entries win deduplication.
  normalized.sort((a, b) => b.confidence - a.confidence);
  const deduped = dedupeRecurringCharges(normalized);

  if (deduped.length === 0) {
    // ── Legacy path ────────────────────────────────────────────────────────
    const charges = defaults.map((charge) => {
      const src = ocrResult[charge.key];
      if (!src) return charge;
      return {
        ...charge,
        year1:       src.year1  != null ? String(src.year1)  : '',
        escPct:      src.escPct != null ? String(src.escPct) : '',
        chargeStart: src.chargeStart ?? '',
        escStart:    src.escStart    ?? '',
      };
    });
    return { charges, confidenceFlags: [], notices: [] };
  }

  // ── recurringCharges[] path ─────────────────────────────────────────────
  // Build a mutable copy of defaults, keyed by bucket key.
  const defaultsByKey = {};
  for (const d of defaults) defaultsByKey[d.key] = { ...d };

  // Track which default slots have been claimed.
  // First charge to claim a bucketKey overrides that default slot.
  // Subsequent charges sharing the same bucketKey become custom entries,
  // preserving their distinct labels rather than collapsing into one row.
  const claimedDefaultKeys = new Set();

  const customCharges = [];
  const notices = [];

  for (const rc of deduped) {
    const entry = {
      canonicalType: rc.canonicalType,
      displayLabel:  rc.label,
      year1:         rc.year1 != null ? String(rc.year1) : '',
      escPct:        rc.escPct != null ? String(rc.escPct) : '',
      chargeStart:   rc.chargeStart ?? '',
      escStart:      rc.escStart    ?? '',
    };

    if (rc.bucketKey && defaultsByKey[rc.bucketKey] && !claimedDefaultKeys.has(rc.bucketKey)) {
      // First charge to claim this default slot: override with lease-native label.
      claimedDefaultKeys.add(rc.bucketKey);
      Object.assign(defaultsByKey[rc.bucketKey], { ...entry, key: rc.bucketKey });

      if (rc.year1 === null) {
        notices.push(
          `"${rc.label}" was detected as a recurring charge but the amount could not be extracted. ` +
          'A blank row has been created — enter the Year 1 monthly amount before confirming.'
        );
      }
    } else {
      // Default slot already claimed by a different charge, no bucketKey, or unknown bucket.
      // Append as a separate custom entry so the label is not lost.
      const customKey = `custom_${customCharges.length + 1}`;
      customCharges.push({ ...entry, key: customKey });

      if (rc.year1 === null) {
        notices.push(
          `"${rc.label}" was detected as a recurring charge but the amount could not be extracted. ` +
          'A blank row has been created — enter the Year 1 monthly amount before confirming.'
        );
      }
    }
  }

  if (deduped.length < normalized.length) {
    notices.push(
      `${normalized.length - deduped.length} duplicate recurring charge mention(s) were consolidated. ` +
      'Review the charges below and add any that were incorrectly removed.'
    );
  }

  // Assemble final array: 5 defaults (with overrides applied) + custom charges.
  const charges = [...defaults.map((d) => defaultsByKey[d.key]), ...customCharges];

  // Build confidence flags for low-confidence or null-amount entries.
  const confidenceFlags = buildChargeConfidenceFlags(deduped, charges);

  return { charges, confidenceFlags, notices };
}

// ---------------------------------------------------------------------------
// buildChargeConfidenceFlags
// ---------------------------------------------------------------------------

/**
 * Generate confidence flag paths for charge entries that need user review.
 * Flags are emitted when:
 *   - year1 is null (amount not detected)
 *   - confidence < LOW_CONFIDENCE_THRESHOLD
 *
 * @param {Object[]} deduped      - Deduplicated normalized recurring charges
 * @param {Object[]} chargesArray - Final charges[] array (for index lookup)
 * @returns {string[]} Flag paths like "charges.0.year1"
 */
export function buildChargeConfidenceFlags(deduped, chargesArray) {
  const flags = [];

  for (const rc of deduped) {
    const idx = chargesArray.findIndex(
      (c) =>
        (rc.bucketKey && c.key === rc.bucketKey) ||
        c.displayLabel === rc.label
    );
    if (idx < 0) continue;

    if (rc.year1 === null || rc.confidence < LOW_CONFIDENCE_THRESHOLD) {
      flags.push(`charges.${idx}.year1`);
    }
    if (rc.escPct === null && rc.confidence < LOW_CONFIDENCE_THRESHOLD) {
      flags.push(`charges.${idx}.escPct`);
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------
// hasDetectedNNNCharges
// ---------------------------------------------------------------------------

/**
 * Returns true if the OCR result contains any reliably detected NNN-type
 * recurring charges in recurringCharges[].
 *
 * Used by prepopulateFormFromOCR to decide whether to stay in 'individual'
 * mode rather than falling back to 'aggregate' mode.
 *
 * @param {Object} ocrResult - OCR extraction result
 * @returns {boolean}
 */
export function hasDetectedNNNCharges(ocrResult) {
  const raw = Array.isArray(ocrResult.recurringCharges) ? ocrResult.recurringCharges : [];
  return raw.some(
    (rc) =>
      rc &&
      typeof rc.label === 'string' &&
      rc.label.trim() &&
      rc.canonicalType === 'nnn'
  );
}
