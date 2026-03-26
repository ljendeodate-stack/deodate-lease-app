/**
 * @fileoverview Unit tests for chargeNormalizer.js
 *
 * Tests cover:
 * - normalizeRecurringCharge: individual field validation
 * - dedupeRecurringCharges: bucket-key and label deduplication
 * - buildChargesFromOCR: end-to-end form-state construction
 * - hasDetectedNNNCharges: nnnMode gate helper
 * - Operating Expenses scenario (Anita's lease grounding)
 * - Management Charge, Administrative Expenses, Service Charge
 * - OCR-corrupted labels
 * - commission one-time default
 * - unknown label preservation
 * - missing-amount blank flagged row
 * - NNN vs Other Charges routing
 * - legacy path fallback
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeRecurringCharge,
  dedupeRecurringCharges,
  buildChargesFromOCR,
  buildChargeConfidenceFlags,
  hasDetectedNNNCharges,
  STANDARD_BUCKET_KEYS,
  LOW_CONFIDENCE_THRESHOLD,
} from './chargeNormalizer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRC(overrides = {}) {
  return {
    label:         'Operating Expenses',
    year1:         12500,
    amountBasis:   'annual',
    escPct:        3,
    chargeStart:   null,
    escStart:      null,
    canonicalType: 'nnn',
    bucketKey:     'cams',
    confidence:    0.85,
    evidenceText:  'Estimated First Year Operating Expenses of $150,000',
    sourceKind:    'combined_estimate',
    ...overrides,
  };
}

function makeOCRResult(overrides = {}) {
  return {
    cams:             { year1: null, escPct: null, chargeStart: null, escStart: null },
    insurance:        { year1: null, escPct: null, chargeStart: null, escStart: null },
    taxes:            { year1: null, escPct: null, chargeStart: null, escStart: null },
    security:         { year1: null, escPct: null, chargeStart: null, escStart: null },
    otherItems:       { year1: null, escPct: null, chargeStart: null, escStart: null },
    estimatedNNNMonthly: null,
    recurringCharges: [],
    confidenceFlags:  [],
    notices:          [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeRecurringCharge
// ---------------------------------------------------------------------------

describe('normalizeRecurringCharge', () => {
  it('returns null for null/non-object input', () => {
    expect(normalizeRecurringCharge(null)).toBeNull();
    expect(normalizeRecurringCharge(undefined)).toBeNull();
    expect(normalizeRecurringCharge('string')).toBeNull();
    expect(normalizeRecurringCharge(42)).toBeNull();
  });

  it('returns null when label is missing or empty', () => {
    expect(normalizeRecurringCharge({})).toBeNull();
    expect(normalizeRecurringCharge({ label: '' })).toBeNull();
    expect(normalizeRecurringCharge({ label: '   ' })).toBeNull();
  });

  it('normalizes a valid Operating Expenses entry', () => {
    const result = normalizeRecurringCharge(makeRC());
    expect(result).not.toBeNull();
    expect(result.label).toBe('Operating Expenses');
    expect(result.year1).toBe(12500);
    expect(result.escPct).toBe(3);
    expect(result.canonicalType).toBe('nnn');
    expect(result.bucketKey).toBe('cams');
    expect(result.confidence).toBe(0.85);
    expect(result.sourceKind).toBe('combined_estimate');
  });

  it('preserves null year1 when amount is missing', () => {
    const result = normalizeRecurringCharge(makeRC({ year1: null }));
    expect(result).not.toBeNull();
    expect(result.year1).toBeNull();
  });

  it('sets year1 to null for non-numeric year1', () => {
    const result = normalizeRecurringCharge(makeRC({ year1: 'bad' }));
    expect(result.year1).toBeNull();
  });

  it('sets year1 to null for implausibly large monthly amount', () => {
    // $600,000/month is beyond the sanity cap
    const result = normalizeRecurringCharge(makeRC({ year1: 600_001 }));
    expect(result.year1).toBeNull();
  });

  it('rejects invalid escPct values', () => {
    expect(normalizeRecurringCharge(makeRC({ escPct: -1 })).escPct).toBeNull();
    expect(normalizeRecurringCharge(makeRC({ escPct: 101 })).escPct).toBeNull();
    expect(normalizeRecurringCharge(makeRC({ escPct: 'bad' })).escPct).toBeNull();
  });

  it('defaults canonicalType to "other" when not "nnn"', () => {
    const result = normalizeRecurringCharge(makeRC({ canonicalType: 'unknown' }));
    expect(result.canonicalType).toBe('other');
  });

  it('rejects unknown bucketKey values (sets to null)', () => {
    const result = normalizeRecurringCharge(makeRC({ bucketKey: 'bogus' }));
    expect(result.bucketKey).toBeNull();
  });

  it('accepts all valid bucketKey values', () => {
    for (const key of STANDARD_BUCKET_KEYS) {
      const result = normalizeRecurringCharge(makeRC({ bucketKey: key }));
      expect(result.bucketKey).toBe(key);
    }
  });

  it('clamps confidence to [0, 1]', () => {
    expect(normalizeRecurringCharge(makeRC({ confidence: 1.5 })).confidence).toBe(1);
    expect(normalizeRecurringCharge(makeRC({ confidence: -0.1 })).confidence).toBe(0);
  });

  it('defaults confidence to 0.5 when missing', () => {
    const result = normalizeRecurringCharge(makeRC({ confidence: undefined }));
    expect(result.confidence).toBe(0.5);
  });

  it('trims label and chargeStart/escStart', () => {
    const result = normalizeRecurringCharge(makeRC({
      label: '  Operating Expenses  ',
      chargeStart: '  02/05/2018  ',
      escStart: '  02/05/2019  ',
    }));
    expect(result.label).toBe('Operating Expenses');
    expect(result.chargeStart).toBe('02/05/2018');
    expect(result.escStart).toBe('02/05/2019');
  });

  it('sets chargeStart/escStart to null when empty string', () => {
    const result = normalizeRecurringCharge(makeRC({ chargeStart: '', escStart: '' }));
    expect(result.chargeStart).toBeNull();
    expect(result.escStart).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// dedupeRecurringCharges
// ---------------------------------------------------------------------------

describe('dedupeRecurringCharges', () => {
  it('returns empty array for empty input', () => {
    expect(dedupeRecurringCharges([])).toEqual([]);
  });

  it('keeps a single entry unchanged', () => {
    const entry = normalizeRecurringCharge(makeRC());
    expect(dedupeRecurringCharges([entry])).toHaveLength(1);
  });

  it('keeps entries with different labels even when they share the same bucketKey', () => {
    // "Operating Expenses" and "CAMS" are distinct labels — both survive deduplication.
    // buildChargesFromOCR handles the routing: first claim gets the default slot,
    // second becomes a custom entry.
    const first = normalizeRecurringCharge(makeRC({ label: 'Operating Expenses', year1: 12500 }));
    const second = normalizeRecurringCharge(makeRC({ label: 'CAMS', year1: 999, bucketKey: 'cams' }));
    const result = dedupeRecurringCharges([first, second]);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe('Operating Expenses');
    expect(result[1].label).toBe('CAMS');
  });

  it('deduplicates entries with the same normalized label (regardless of bucketKey)', () => {
    // Same label = same obligation. Higher-confidence entry must be sorted first.
    const high = normalizeRecurringCharge(makeRC({ label: 'Operating Expenses', year1: 12500, confidence: 0.9 }));
    const low  = normalizeRecurringCharge(makeRC({ label: 'Operating Expenses', year1: 11000, confidence: 0.5 }));
    const result = dedupeRecurringCharges([high, low]);
    expect(result).toHaveLength(1);
    expect(result[0].year1).toBe(12500); // higher confidence entry wins
  });

  it('keeps entries with different bucketKeys', () => {
    const cams = normalizeRecurringCharge(makeRC({ bucketKey: 'cams' }));
    const ins  = normalizeRecurringCharge(makeRC({ label: 'Insurance', bucketKey: 'insurance', canonicalType: 'nnn' }));
    const tax  = normalizeRecurringCharge(makeRC({ label: 'Taxes', bucketKey: 'taxes', canonicalType: 'nnn' }));
    const result = dedupeRecurringCharges([cams, ins, tax]);
    expect(result).toHaveLength(3);
  });

  it('deduplicates custom charges by exact normalized label', () => {
    const a = normalizeRecurringCharge(makeRC({ label: 'Management Fee', bucketKey: null }));
    const b = normalizeRecurringCharge(makeRC({ label: 'Management Fee', bucketKey: null }));
    const result = dedupeRecurringCharges([a, b]);
    expect(result).toHaveLength(1);
  });

  it('keeps custom charges with different labels', () => {
    const a = normalizeRecurringCharge(makeRC({ label: 'Management Fee', bucketKey: null }));
    const b = normalizeRecurringCharge(makeRC({ label: 'Administrative Fee', bucketKey: null }));
    const result = dedupeRecurringCharges([a, b]);
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// buildChargesFromOCR — Operating Expenses / Anita's lease scenario
// ---------------------------------------------------------------------------

describe('buildChargesFromOCR — Operating Expenses (Anita\'s lease)', () => {
  it('surfaces Operating Expenses as a named NNN row labeled "Operating Expenses"', () => {
    const ocrResult = makeOCRResult({
      recurringCharges: [makeRC()],
    });
    const { charges } = buildChargesFromOCR(ocrResult);
    const camsRow = charges.find((c) => c.key === 'cams');
    expect(camsRow).toBeDefined();
    expect(camsRow.displayLabel).toBe('Operating Expenses');
    expect(camsRow.year1).toBe('12500');
    expect(camsRow.canonicalType).toBe('nnn');
  });

  it('does not collapse Operating Expenses to "CAMS" label', () => {
    const ocrResult = makeOCRResult({
      recurringCharges: [makeRC({ label: 'Estimated First Year Operating Expenses' })],
    });
    const { charges } = buildChargesFromOCR(ocrResult);
    const camsRow = charges.find((c) => c.key === 'cams');
    expect(camsRow.displayLabel).not.toBe('CAMS');
    expect(camsRow.displayLabel).toBe('Estimated First Year Operating Expenses');
  });

  it('keeps insurance and taxes rows present but empty when only a combined estimate is detected', () => {
    const ocrResult = makeOCRResult({
      recurringCharges: [makeRC()],  // Only cams/Operating Expenses detected
    });
    const { charges } = buildChargesFromOCR(ocrResult);
    const insRow = charges.find((c) => c.key === 'insurance');
    const taxRow = charges.find((c) => c.key === 'taxes');
    expect(insRow).toBeDefined();
    expect(taxRow).toBeDefined();
    expect(insRow.year1).toBe('');
    expect(taxRow.year1).toBe('');
  });

  it('produces a blank flagged row when Operating Expenses is detected with no amount', () => {
    const ocrResult = makeOCRResult({
      recurringCharges: [makeRC({ year1: null, confidence: 0.45 })],
    });
    const { charges, confidenceFlags, notices } = buildChargesFromOCR(ocrResult);
    const camsRow = charges.find((c) => c.key === 'cams');
    expect(camsRow.year1).toBe('');
    expect(confidenceFlags.some((f) => f.includes('year1'))).toBe(true);
    expect(notices.some((n) => n.includes('Operating Expenses'))).toBe(true);
  });

  it('preserves escPct from detected charge', () => {
    const ocrResult = makeOCRResult({
      recurringCharges: [makeRC({ escPct: 3 })],
    });
    const { charges } = buildChargesFromOCR(ocrResult);
    const camsRow = charges.find((c) => c.key === 'cams');
    expect(camsRow.escPct).toBe('3');
  });
});

// ---------------------------------------------------------------------------
// buildChargesFromOCR — Legacy fallback path
// ---------------------------------------------------------------------------

describe('buildChargesFromOCR — legacy fallback', () => {
  it('falls back to fixed OCR buckets when recurringCharges[] is absent', () => {
    const ocrResult = makeOCRResult({
      cams: { year1: 500, escPct: 3, chargeStart: null, escStart: null },
    });
    const { charges } = buildChargesFromOCR(ocrResult);
    const camsRow = charges.find((c) => c.key === 'cams');
    expect(camsRow.year1).toBe('500');
    expect(camsRow.displayLabel).toBe('CAMS'); // legacy label unchanged
  });

  it('falls back when recurringCharges[] is empty array', () => {
    const ocrResult = makeOCRResult({ recurringCharges: [] });
    const { charges } = buildChargesFromOCR(ocrResult);
    expect(charges).toHaveLength(5); // 5 defaults, all empty
    expect(charges[0].key).toBe('cams');
    expect(charges[0].year1).toBe('');
  });

  it('falls back when all recurringCharges[] entries are invalid', () => {
    const ocrResult = makeOCRResult({ recurringCharges: [null, { label: '' }, 42] });
    const { charges } = buildChargesFromOCR(ocrResult);
    expect(charges).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// buildChargesFromOCR — Management Charge, Administrative Expenses, Service Charge
// ---------------------------------------------------------------------------

describe('buildChargesFromOCR — management / admin / service fee labels', () => {
  it('preserves "Management Charge" as displayLabel in the otherItems row', () => {
    const ocrResult = makeOCRResult({
      recurringCharges: [makeRC({
        label: 'Management Charge',
        year1: 200,
        canonicalType: 'other',
        bucketKey: 'otherItems',
        confidence: 0.9,
      })],
    });
    const { charges } = buildChargesFromOCR(ocrResult);
    const row = charges.find((c) => c.key === 'otherItems');
    expect(row.displayLabel).toBe('Management Charge');
    expect(row.canonicalType).toBe('other');
    expect(row.year1).toBe('200');
  });

  it('preserves "Administrative Expenses" as displayLabel', () => {
    const ocrResult = makeOCRResult({
      recurringCharges: [makeRC({
        label: 'Administrative Expenses',
        year1: 150,
        canonicalType: 'other',
        bucketKey: 'otherItems',
      })],
    });
    const { charges } = buildChargesFromOCR(ocrResult);
    const row = charges.find((c) => c.key === 'otherItems');
    expect(row.displayLabel).toBe('Administrative Expenses');
  });

  it('preserves "Service Charge" as displayLabel', () => {
    const ocrResult = makeOCRResult({
      recurringCharges: [makeRC({
        label: 'Service Charge',
        year1: 100,
        canonicalType: 'other',
        bucketKey: 'otherItems',
      })],
    });
    const { charges } = buildChargesFromOCR(ocrResult);
    const row = charges.find((c) => c.key === 'otherItems');
    expect(row.displayLabel).toBe('Service Charge');
  });
});

// ---------------------------------------------------------------------------
// buildChargesFromOCR — Unknown / unfamiliar labels
// ---------------------------------------------------------------------------

describe('buildChargesFromOCR — unknown label preservation', () => {
  it('adds an unfamiliar label as a custom charge (not dropped)', () => {
    const ocrResult = makeOCRResult({
      recurringCharges: [makeRC({
        label: 'Stewardship Fee',
        year1: 300,
        canonicalType: 'other',
        bucketKey: null,  // not a standard bucket
      })],
    });
    const { charges } = buildChargesFromOCR(ocrResult);
    const custom = charges.find((c) => c.displayLabel === 'Stewardship Fee');
    expect(custom).toBeDefined();
    expect(custom.key).toMatch(/^custom_/);
    expect(custom.year1).toBe('300');
    expect(custom.canonicalType).toBe('other');
  });

  it('does not silently drop a charge with an unknown label', () => {
    const ocrResult = makeOCRResult({
      recurringCharges: [
        makeRC({ label: 'Unknown Special Assessment', bucketKey: null }),
      ],
    });
    const { charges } = buildChargesFromOCR(ocrResult);
    expect(charges.some((c) => c.displayLabel === 'Unknown Special Assessment')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildChargesFromOCR — Duplicate mention deduplication
// ---------------------------------------------------------------------------

describe('buildChargesFromOCR — duplicate deduplication', () => {
  it('keeps two distinct labels that share a bucketKey as separate rows', () => {
    // "Operating Expenses" and "Op Ex" are different labels — both survive dedupe.
    // First one claims the cams default slot; second becomes a custom entry.
    const ocrResult = makeOCRResult({
      recurringCharges: [
        makeRC({ label: 'Operating Expenses', year1: 12500, confidence: 0.9 }),
        makeRC({ label: 'Op Ex', year1: 11000, confidence: 0.6, bucketKey: 'cams' }),
      ],
    });
    const { charges } = buildChargesFromOCR(ocrResult);
    const camsRow   = charges.find((c) => c.key === 'cams');
    const customRow = charges.find((c) => c.displayLabel === 'Op Ex');
    // Higher-confidence entry ("Operating Expenses") claims the cams slot
    expect(camsRow.displayLabel).toBe('Operating Expenses');
    expect(camsRow.year1).toBe('12500');
    // "Op Ex" survives as a separate custom entry rather than being dropped
    expect(customRow).toBeDefined();
    expect(customRow.year1).toBe('11000');
  });

  it('deduplicates when the same normalized label appears twice (true exact duplicate)', () => {
    const ocrResult = makeOCRResult({
      recurringCharges: [
        makeRC({ label: 'Operating Expenses', year1: 12500, confidence: 0.9 }),
        makeRC({ label: 'Operating Expenses', year1: 12500, confidence: 0.5 }),
      ],
    });
    const { charges, notices } = buildChargesFromOCR(ocrResult);
    // Only one entry survives — the higher-confidence one
    const opExpRows = charges.filter((c) => c.displayLabel === 'Operating Expenses');
    expect(opExpRows).toHaveLength(1);
    expect(notices.some((n) => n.includes('duplicate') || n.includes('consolidated'))).toBe(true);
  });

  it('keeps separate entries for CAMS and Insurance even when both detected', () => {
    const ocrResult = makeOCRResult({
      recurringCharges: [
        makeRC({ label: 'Common Area Maintenance', bucketKey: 'cams', year1: 400 }),
        makeRC({ label: 'Property Insurance', bucketKey: 'insurance', canonicalType: 'nnn', year1: 150 }),
      ],
    });
    const { charges } = buildChargesFromOCR(ocrResult);
    const camsRow = charges.find((c) => c.key === 'cams');
    const insRow  = charges.find((c) => c.key === 'insurance');
    expect(camsRow.year1).toBe('400');
    expect(insRow.year1).toBe('150');
  });
});

// ---------------------------------------------------------------------------
// hasDetectedNNNCharges
// ---------------------------------------------------------------------------

describe('hasDetectedNNNCharges', () => {
  it('returns false when recurringCharges[] is absent', () => {
    expect(hasDetectedNNNCharges({})).toBe(false);
  });

  it('returns false when recurringCharges[] is empty', () => {
    expect(hasDetectedNNNCharges({ recurringCharges: [] })).toBe(false);
  });

  it('returns true when at least one NNN-type recurring charge exists', () => {
    expect(hasDetectedNNNCharges({
      recurringCharges: [makeRC({ canonicalType: 'nnn' })],
    })).toBe(true);
  });

  it('returns false when only "other" charges detected', () => {
    expect(hasDetectedNNNCharges({
      recurringCharges: [makeRC({ canonicalType: 'other' })],
    })).toBe(false);
  });

  it('ignores invalid entries', () => {
    expect(hasDetectedNNNCharges({
      recurringCharges: [null, { label: '' }, { canonicalType: 'nnn' }],
    })).toBe(false); // no label on the nnn one
  });
});

// ---------------------------------------------------------------------------
// NNN vs Other Charges routing correctness
// ---------------------------------------------------------------------------

describe('NNN vs Other Charges routing', () => {
  it('routes Operating Expenses to canonicalType nnn', () => {
    const ocrResult = makeOCRResult({
      recurringCharges: [makeRC({ canonicalType: 'nnn', bucketKey: 'cams' })],
    });
    const { charges } = buildChargesFromOCR(ocrResult);
    const row = charges.find((c) => c.key === 'cams');
    expect(row.canonicalType).toBe('nnn');
  });

  it('routes Management Fee to canonicalType other', () => {
    const ocrResult = makeOCRResult({
      recurringCharges: [makeRC({
        label: 'Management Fee',
        canonicalType: 'other',
        bucketKey: 'otherItems',
      })],
    });
    const { charges } = buildChargesFromOCR(ocrResult);
    const row = charges.find((c) => c.key === 'otherItems');
    expect(row.canonicalType).toBe('other');
  });

  it('routes unknown-bucket charge to other by default when canonicalType is other', () => {
    const ocrResult = makeOCRResult({
      recurringCharges: [makeRC({
        label: 'Handling Fee',
        canonicalType: 'other',
        bucketKey: null,
      })],
    });
    const { charges } = buildChargesFromOCR(ocrResult);
    const custom = charges.find((c) => c.displayLabel === 'Handling Fee');
    expect(custom).toBeDefined();
    expect(custom.canonicalType).toBe('other');
  });
});

// ---------------------------------------------------------------------------
// buildChargeConfidenceFlags
// ---------------------------------------------------------------------------

describe('buildChargeConfidenceFlags', () => {
  it('flags charges with null year1', () => {
    const deduped = [normalizeRecurringCharge(makeRC({ year1: null, confidence: 0.8 }))];
    const chargesArr = [{ key: 'cams', displayLabel: 'Operating Expenses' }];
    const flags = buildChargeConfidenceFlags(deduped, chargesArr);
    expect(flags).toContain('charges.0.year1');
  });

  it('flags charges with confidence below threshold', () => {
    const deduped = [normalizeRecurringCharge(makeRC({ year1: 5000, confidence: LOW_CONFIDENCE_THRESHOLD - 0.01 }))];
    const chargesArr = [{ key: 'cams', displayLabel: 'Operating Expenses' }];
    const flags = buildChargeConfidenceFlags(deduped, chargesArr);
    expect(flags).toContain('charges.0.year1');
  });

  it('does not flag high-confidence charges with a valid year1', () => {
    const deduped = [normalizeRecurringCharge(makeRC({ year1: 5000, confidence: 0.9 }))];
    const chargesArr = [{ key: 'cams', displayLabel: 'Operating Expenses' }];
    const flags = buildChargeConfidenceFlags(deduped, chargesArr);
    expect(flags).not.toContain('charges.0.year1');
  });

  it('handles empty deduped array', () => {
    expect(buildChargeConfidenceFlags([], [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// OCR-corrupted text variant
// ---------------------------------------------------------------------------

describe('normalizeRecurringCharge — OCR-corrupted labels', () => {
  it('preserves OCR-corrupted label (chargeNormalizer does not correct — LLM handles it)', () => {
    // The LLM is responsible for OCR correction upstream; chargeNormalizer
    // preserves whatever label string arrives. This ensures we never silently drop
    // a charge because the label text is corrupted.
    const result = normalizeRecurringCharge(makeRC({ label: 'Operatlng Expens5s' }));
    expect(result).not.toBeNull();
    expect(result.label).toBe('Operatlng Expens5s');
  });

  it('still builds a form row from an OCR-corrupted label', () => {
    const ocrResult = makeOCRResult({
      recurringCharges: [makeRC({ label: 'Operatlng Expens5s', bucketKey: 'cams' })],
    });
    const { charges } = buildChargesFromOCR(ocrResult);
    const camsRow = charges.find((c) => c.key === 'cams');
    expect(camsRow.displayLabel).toBe('Operatlng Expens5s');
    expect(camsRow.year1).toBe('12500');
  });
});

// ---------------------------------------------------------------------------
// Commission default: one-time, not recurring
// ---------------------------------------------------------------------------

describe('commission handling', () => {
  it('does not add a recurring row for commissions if classified as other/null bucket', () => {
    // The LLM should put commissions in oneTimeCharges. If they somehow appear in
    // recurringCharges[], the normalizer routes them as-is to a custom row.
    // This test confirms the normalizer does NOT auto-exclude them — that decision
    // belongs to the LLM. The charge will still appear so the user can review it.
    const ocrResult = makeOCRResult({
      recurringCharges: [makeRC({
        label: 'Lease Commission',
        year1: 5000,
        canonicalType: 'other',
        bucketKey: null,
      })],
    });
    const { charges } = buildChargesFromOCR(ocrResult);
    const row = charges.find((c) => c.displayLabel === 'Lease Commission');
    // The charge appears but as a custom/other row — user can review and remove if one-time
    expect(row).toBeDefined();
    expect(row.canonicalType).toBe('other');
  });
});

// ---------------------------------------------------------------------------
// Full pipeline: multiple charges including custom
// ---------------------------------------------------------------------------

describe('buildChargesFromOCR — multiple charges including custom', () => {
  it('produces all 5 defaults + custom charges, with correct labels and amounts', () => {
    const ocrResult = makeOCRResult({
      recurringCharges: [
        makeRC({ label: 'Operating Expenses', bucketKey: 'cams', year1: 12500, canonicalType: 'nnn' }),
        makeRC({ label: 'Supervisory Fee', bucketKey: null, year1: 200, canonicalType: 'other' }),
      ],
    });
    const { charges } = buildChargesFromOCR(ocrResult);

    // 5 defaults + 1 custom = 6
    expect(charges).toHaveLength(6);

    const camsRow   = charges.find((c) => c.key === 'cams');
    const customRow = charges.find((c) => c.displayLabel === 'Supervisory Fee');

    expect(camsRow.displayLabel).toBe('Operating Expenses');
    expect(camsRow.year1).toBe('12500');
    expect(customRow).toBeDefined();
    expect(customRow.key).toMatch(/^custom_/);
    expect(customRow.year1).toBe('200');
  });
});

// ---------------------------------------------------------------------------
// Case A: multiple distinct same-bucket charges survive as separate rows
// (the core end-to-end semantic invariant)
// ---------------------------------------------------------------------------

describe('buildChargesFromOCR — Case A: multiple distinct same-bucket charges', () => {
  it('keeps Management Charge, Administrative Expenses, and Service Charge as separate rows', () => {
    // All three route to the same conceptual bucket (otherItems), but they are
    // distinct obligations with distinct labels and must not collapse.
    const ocrResult = makeOCRResult({
      recurringCharges: [
        makeRC({ label: 'Management Charge',       year1: 650, canonicalType: 'other', bucketKey: 'otherItems', confidence: 0.9 }),
        makeRC({ label: 'Administrative Expenses', year1: 275, canonicalType: 'other', bucketKey: 'otherItems', confidence: 0.85 }),
        makeRC({ label: 'Service Charge',          year1: 180, canonicalType: 'other', bucketKey: 'otherItems', confidence: 0.8 }),
      ],
    });
    const { charges } = buildChargesFromOCR(ocrResult);

    const mgmt  = charges.find((c) => c.displayLabel === 'Management Charge');
    const admin = charges.find((c) => c.displayLabel === 'Administrative Expenses');
    const svc   = charges.find((c) => c.displayLabel === 'Service Charge');

    // All three must exist
    expect(mgmt).toBeDefined();
    expect(admin).toBeDefined();
    expect(svc).toBeDefined();

    // Amounts preserved
    expect(mgmt.year1).toBe('650');
    expect(admin.year1).toBe('275');
    expect(svc.year1).toBe('180');

    // All are canonicalType other
    expect(mgmt.canonicalType).toBe('other');
    expect(admin.canonicalType).toBe('other');
    expect(svc.canonicalType).toBe('other');

    // First claim gets the default slot; subsequent ones become custom entries
    const otherItemsRow = charges.find((c) => c.key === 'otherItems');
    expect(otherItemsRow).toBeDefined();
    expect(otherItemsRow.displayLabel).toBe('Management Charge'); // highest-confidence claims slot
    expect(admin.key).toMatch(/^custom_/);
    expect(svc.key).toMatch(/^custom_/);
  });

  it('deduplicates only when labels are identical, not when they share a bucket', () => {
    const ocrResult = makeOCRResult({
      recurringCharges: [
        makeRC({ label: 'Management Charge', year1: 650, canonicalType: 'other', bucketKey: 'otherItems' }),
        makeRC({ label: 'Management Charge', year1: 650, canonicalType: 'other', bucketKey: 'otherItems' }),  // exact dup
        makeRC({ label: 'Admin Fee',         year1: 200, canonicalType: 'other', bucketKey: 'otherItems' }),  // different label
      ],
    });
    const { charges } = buildChargesFromOCR(ocrResult);

    const mgmtRows = charges.filter((c) => c.displayLabel === 'Management Charge');
    const adminRow = charges.find((c) => c.displayLabel === 'Admin Fee');

    // Exact duplicate collapsed to one row
    expect(mgmtRows).toHaveLength(1);
    // Different label survives as a separate row
    expect(adminRow).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Case B: Operating Expenses (NNN) + Administrative Fee (Other) — separate rows
// ---------------------------------------------------------------------------

describe('buildChargesFromOCR — Case B: NNN and Other charges coexist', () => {
  it('keeps Operating Expenses (NNN) and Administrative Fee (Other) as separate rows', () => {
    const ocrResult = makeOCRResult({
      recurringCharges: [
        makeRC({ label: 'Operating Expenses', year1: 2300, canonicalType: 'nnn',   bucketKey: 'cams',       confidence: 0.9 }),
        makeRC({ label: 'Administrative Fee', year1: 275,  canonicalType: 'other', bucketKey: 'otherItems', confidence: 0.85 }),
      ],
    });
    const { charges } = buildChargesFromOCR(ocrResult);

    const oeRow   = charges.find((c) => c.displayLabel === 'Operating Expenses');
    const adminRow = charges.find((c) => c.displayLabel === 'Administrative Fee');

    expect(oeRow).toBeDefined();
    expect(adminRow).toBeDefined();
    expect(oeRow.canonicalType).toBe('nnn');
    expect(adminRow.canonicalType).toBe('other');
    expect(oeRow.year1).toBe('2300');
    expect(adminRow.year1).toBe('275');

    // Operating Expenses claims the cams slot; Administrative Fee claims otherItems slot
    expect(oeRow.key).toBe('cams');
    expect(adminRow.key).toBe('otherItems');
  });
});
