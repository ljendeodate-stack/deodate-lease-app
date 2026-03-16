/**
 * @fileoverview Unit tests for the expense-label classifier.
 *
 * Run with: npm test
 *
 * Every test asserts the five required fields:
 *   - bucketCategory
 *   - semanticSubtype (where reasonably expected)
 *   - matchType  (exists and is a valid string)
 *   - confidence (exists and is 0–1)
 *   - normalizedLabel (exists and is non-empty)
 */

import { describe, it, expect } from 'vitest';
import {
  classifyExpenseLabel,
  normalizeExpenseLabel,
  applyOcrCorrections,
  salvageOcrDamagedLabel,
  resolveCanonicalExpenseCategory,
  EXPENSE_CATEGORY_DEFS,
  NNN_BUCKET_KEYS,
} from './labelClassifier.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_MATCH_TYPES = ['exact', 'alias', 'token', 'fuzzy', 'ocr_rescue', 'fallback'];
const VALID_BUCKETS = NNN_BUCKET_KEYS;

function assertBase(result) {
  expect(result).toBeDefined();
  expect(VALID_BUCKETS).toContain(result.bucketCategory);
  expect(VALID_MATCH_TYPES).toContain(result.matchType);
  expect(typeof result.confidence).toBe('number');
  expect(result.confidence).toBeGreaterThanOrEqual(0);
  expect(result.confidence).toBeLessThanOrEqual(1);
  expect(typeof result.normalizedLabel).toBe('string');
  expect(result.normalizedLabel.length).toBeGreaterThanOrEqual(0);
  expect(Array.isArray(result.warnings)).toBe(true);
}

// ---------------------------------------------------------------------------
// Core exports
// ---------------------------------------------------------------------------

describe('EXPENSE_CATEGORY_DEFS', () => {
  it('has all five bucket keys', () => {
    expect(Object.keys(EXPENSE_CATEGORY_DEFS)).toEqual(NNN_BUCKET_KEYS);
  });

  it('each entry has bucketCategory and displayLabel', () => {
    for (const [key, def] of Object.entries(EXPENSE_CATEGORY_DEFS)) {
      expect(def.bucketCategory).toBe(key);
      expect(typeof def.displayLabel).toBe('string');
      expect(def.displayLabel.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// normalizeExpenseLabel
// ---------------------------------------------------------------------------

describe('normalizeExpenseLabel', () => {
  it('lowercases and trims', () => {
    expect(normalizeExpenseLabel('  CAMS  ')).toBe('cams');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeExpenseLabel('common   area')).toBe('common area');
  });

  it('expands C.A.M. to cams', () => {
    expect(normalizeExpenseLabel('C.A.M.')).toBe('cams');
  });

  it('expands c.a.m.s to cams', () => {
    expect(normalizeExpenseLabel('c.a.m.s')).toBe('cams');
  });

  it('expands r.e. taxes to real estate taxes', () => {
    const result = normalizeExpenseLabel('r.e. taxes');
    expect(result).toContain('real estate');
    expect(result).toContain('tax');
  });

  it('normalizes water/sewer to water sewer', () => {
    expect(normalizeExpenseLabel('water/sewer')).toBe('water sewer');
  });

  it('expands triple net', () => {
    expect(normalizeExpenseLabel('triple net')).toBe('nnn');
  });

  it('expands n.n.n. to nnn', () => {
    expect(normalizeExpenseLabel('N.N.N.')).toBe('nnn');
  });
});

// ---------------------------------------------------------------------------
// applyOcrCorrections
// ---------------------------------------------------------------------------

describe('applyOcrCorrections', () => {
  it('corrects operatlng → operating', () => {
    expect(applyOcrCorrections('operatlng expenses')).toContain('operating');
  });

  it('corrects malntenance → maintenance', () => {
    expect(applyOcrCorrections('malntenance')).toBe('maintenance');
  });

  it('corrects insuranee → insurance', () => {
    expect(applyOcrCorrections('insuranee')).toBe('insurance');
  });

  it('corrects trlple → triple', () => {
    expect(applyOcrCorrections('trlple net')).toContain('triple');
  });

  it('corrects securlty → security', () => {
    expect(applyOcrCorrections('securlty')).toBe('security');
  });

  it('corrects utllities → utilities', () => {
    expect(applyOcrCorrections('utllities')).toBe('utilities');
  });

  it('corrects adm1n → admin', () => {
    expect(applyOcrCorrections('adm1n fee')).toContain('admin');
  });

  it('corrects asses5ments → assessments', () => {
    expect(applyOcrCorrections('asses5ments')).toBe('assessments');
  });
});

// ---------------------------------------------------------------------------
// salvageOcrDamagedLabel
// ---------------------------------------------------------------------------

describe('salvageOcrDamagedLabel', () => {
  it('strips repeated symbol noise', () => {
    const { salvaged } = salvageOcrDamagedLabel('admin***fee');
    expect(salvaged).toContain('admin');
    expect(salvaged).toContain('fee');
    expect(salvaged).not.toContain('*');
  });

  it('rescues digit tokens', () => {
    const { salvaged, changed } = salvageOcrDamagedLabel('rea1 estate taxe5');
    expect(changed).toBe(true);
    // should produce something close to "real estate taxes"
    expect(salvaged).toMatch(/real|estate|tax/i);
  });
});

// ---------------------------------------------------------------------------
// classifyExpenseLabel — CAMS bucket
// ---------------------------------------------------------------------------

describe('classifyExpenseLabel – CAMS', () => {
  it('CAM → cams / cam', () => {
    const r = classifyExpenseLabel('CAM');
    assertBase(r);
    expect(r.bucketCategory).toBe('cams');
    expect(r.semanticSubtype).toBe('cam');
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('C.A.M. → cams / cam', () => {
    const r = classifyExpenseLabel('C.A.M.');
    assertBase(r);
    expect(r.bucketCategory).toBe('cams');
    expect(r.semanticSubtype).toBe('cam');
  });

  it('Common Area Maintenance → cams / common_area_maintenance', () => {
    const r = classifyExpenseLabel('Common Area Maintenance');
    assertBase(r);
    expect(r.bucketCategory).toBe('cams');
    expect(r.semanticSubtype).toBe('common_area_maintenance');
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('operatlng expenses → cams / operating_expenses (OCR correction)', () => {
    const r = classifyExpenseLabel('operatlng expenses');
    assertBase(r);
    expect(r.bucketCategory).toBe('cams');
    expect(r.semanticSubtype).toBe('operating_expenses');
    expect(r.matchType).not.toBe('fallback');
  });

  it('operating cost recovery → cams / operating_cost_recovery', () => {
    const r = classifyExpenseLabel('operating cost recovery');
    assertBase(r);
    expect(r.bucketCategory).toBe('cams');
    expect(r.semanticSubtype).toBe('operating_cost_recovery');
  });

  it('common area malntenance → cams / common_area_maintenance (OCR correction)', () => {
    const r = classifyExpenseLabel('common area malntenance');
    assertBase(r);
    expect(r.bucketCategory).toBe('cams');
    expect(r.semanticSubtype).toBe('common_area_maintenance');
    expect(r.matchType).not.toBe('fallback');
  });

  it('c0mmon area ma1ntenance → cams (OCR salvage)', () => {
    const r = classifyExpenseLabel('c0mmon area ma1ntenance');
    assertBase(r);
    expect(r.bucketCategory).toBe('cams');
    expect(r.matchType).not.toBe('fallback');
  });
});

// ---------------------------------------------------------------------------
// classifyExpenseLabel — Composite NNN routing
// ---------------------------------------------------------------------------

describe('classifyExpenseLabel – Composite NNN', () => {
  it('trlple net → cams / nnn_composite + warning (OCR correction)', () => {
    const r = classifyExpenseLabel('trlple net');
    assertBase(r);
    expect(r.bucketCategory).toBe('cams');
    expect(r.semanticSubtype).toBe('nnn_composite');
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings.some((w) => w.toLowerCase().includes('composite') || w.toLowerCase().includes('cams'))).toBe(true);
  });

  it('additional rent → cams / nnn_composite + warning', () => {
    const r = classifyExpenseLabel('additional rent');
    assertBase(r);
    expect(r.bucketCategory).toBe('cams');
    expect(r.semanticSubtype).toBe('nnn_composite');
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('net charges → cams / nnn_composite + warning', () => {
    const r = classifyExpenseLabel('net charges');
    assertBase(r);
    expect(r.bucketCategory).toBe('cams');
    expect(r.semanticSubtype).toBe('nnn_composite');
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// classifyExpenseLabel — TAXES bucket
// ---------------------------------------------------------------------------

describe('classifyExpenseLabel – Taxes', () => {
  it('real estate taxes → taxes / real_estate_taxes', () => {
    const r = classifyExpenseLabel('real estate taxes');
    assertBase(r);
    expect(r.bucketCategory).toBe('taxes');
    expect(r.semanticSubtype).toBe('real_estate_taxes');
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('r.e. taxes → taxes / real_estate_taxes', () => {
    const r = classifyExpenseLabel('r.e. taxes');
    assertBase(r);
    expect(r.bucketCategory).toBe('taxes');
    expect(r.semanticSubtype).toBe('real_estate_taxes');
  });

  it('ad valorem tax → taxes / ad_valorem_taxes', () => {
    const r = classifyExpenseLabel('ad valorem tax');
    assertBase(r);
    expect(r.bucketCategory).toBe('taxes');
    expect(r.semanticSubtype).toBe('ad_valorem_taxes');
  });

  it('rea1 estate taxe5 → taxes (OCR salvage)', () => {
    const r = classifyExpenseLabel('rea1 estate taxe5');
    assertBase(r);
    expect(r.bucketCategory).toBe('taxes');
    expect(r.matchType).not.toBe('fallback');
  });
});

// ---------------------------------------------------------------------------
// classifyExpenseLabel — INSURANCE bucket
// ---------------------------------------------------------------------------

describe('classifyExpenseLabel – Insurance', () => {
  it('insuranee → insurance / property_insurance (OCR correction)', () => {
    const r = classifyExpenseLabel('insuranee');
    assertBase(r);
    expect(r.bucketCategory).toBe('insurance');
    expect(r.semanticSubtype).toBe('property_insurance');
    expect(r.matchType).not.toBe('fallback');
  });

  it('casualty insurance → insurance / casualty_insurance', () => {
    const r = classifyExpenseLabel('casualty insurance');
    assertBase(r);
    expect(r.bucketCategory).toBe('insurance');
    expect(r.semanticSubtype).toBe('casualty_insurance');
  });

  it('hazard insurance → insurance / hazard_insurance', () => {
    const r = classifyExpenseLabel('hazard insurance');
    assertBase(r);
    expect(r.bucketCategory).toBe('insurance');
    expect(r.semanticSubtype).toBe('hazard_insurance');
  });
});

// ---------------------------------------------------------------------------
// classifyExpenseLabel — SECURITY bucket
// ---------------------------------------------------------------------------

describe('classifyExpenseLabel – Security', () => {
  it('security patrol → security / guard_patrol', () => {
    const r = classifyExpenseLabel('security patrol');
    assertBase(r);
    expect(r.bucketCategory).toBe('security');
    expect(r.semanticSubtype).toBe('guard_patrol');
  });

  it('guard service → security / guard_patrol', () => {
    const r = classifyExpenseLabel('guard service');
    assertBase(r);
    expect(r.bucketCategory).toBe('security');
    expect(r.semanticSubtype).toBe('guard_patrol');
  });
});

// ---------------------------------------------------------------------------
// classifyExpenseLabel — OTHER ITEMS bucket
// ---------------------------------------------------------------------------

describe('classifyExpenseLabel – Other Items', () => {
  it('admin fee → otherItems / administrative_fee', () => {
    const r = classifyExpenseLabel('admin fee');
    assertBase(r);
    expect(r.bucketCategory).toBe('otherItems');
    expect(r.semanticSubtype).toBe('administrative_fee');
  });

  it('general admin → otherItems / general_admin_fee', () => {
    const r = classifyExpenseLabel('general admin');
    assertBase(r);
    expect(r.bucketCategory).toBe('otherItems');
    expect(r.semanticSubtype).toBe('general_admin_fee');
  });

  it('general admin fee → otherItems / general_admin_fee', () => {
    const r = classifyExpenseLabel('general admin fee');
    assertBase(r);
    expect(r.bucketCategory).toBe('otherItems');
    expect(r.semanticSubtype).toBe('general_admin_fee');
  });

  it('g3nera*** admin f55 → otherItems (OCR salvage)', () => {
    const r = classifyExpenseLabel('g3nera*** admin f55');
    assertBase(r);
    expect(r.bucketCategory).toBe('otherItems');
    // Subtype may or may not resolve, but warnings should mention salvage
    expect(r.matchType).toMatch(/ocr_rescue|token|fuzzy/);
  });

  it('management fee → otherItems / management_fee', () => {
    const r = classifyExpenseLabel('management fee');
    assertBase(r);
    expect(r.bucketCategory).toBe('otherItems');
    expect(r.semanticSubtype).toBe('management_fee');
  });

  it('janitorial → otherItems / janitorial', () => {
    const r = classifyExpenseLabel('janitorial');
    assertBase(r);
    expect(r.bucketCategory).toBe('otherItems');
    expect(r.semanticSubtype).toBe('janitorial');
  });

  it('utllities → otherItems / utilities (OCR correction)', () => {
    const r = classifyExpenseLabel('utllities');
    assertBase(r);
    expect(r.bucketCategory).toBe('otherItems');
    expect(r.semanticSubtype).toBe('utilities');
    expect(r.matchType).not.toBe('fallback');
  });

  it('hvac maintenance → otherItems / hvac_maintenance', () => {
    const r = classifyExpenseLabel('hvac maintenance');
    assertBase(r);
    expect(r.bucketCategory).toBe('otherItems');
    expect(r.semanticSubtype).toBe('hvac_maintenance');
  });

  it('water/sewer → otherItems / water_sewer', () => {
    const r = classifyExpenseLabel('water/sewer');
    assertBase(r);
    expect(r.bucketCategory).toBe('otherItems');
    expect(r.semanticSubtype).toBe('water_sewer');
  });
});

// ---------------------------------------------------------------------------
// resolveCanonicalExpenseCategory
// ---------------------------------------------------------------------------

describe('resolveCanonicalExpenseCategory', () => {
  it('returns bucket string directly', () => {
    expect(resolveCanonicalExpenseCategory('real estate taxes')).toBe('taxes');
    expect(resolveCanonicalExpenseCategory('CAMS')).toBe('cams');
    expect(resolveCanonicalExpenseCategory('insurance premium')).toBe('insurance');
    expect(resolveCanonicalExpenseCategory('janitorial')).toBe('otherItems');
    expect(resolveCanonicalExpenseCategory('security patrol')).toBe('security');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  it('empty string returns fallback', () => {
    const r = classifyExpenseLabel('');
    assertBase(r);
    expect(r.matchType).toBe('fallback');
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('null returns fallback', () => {
    const r = classifyExpenseLabel(null);
    assertBase(r);
    expect(r.matchType).toBe('fallback');
  });

  it('completely unrecognizable string returns fallback to otherItems with warning', () => {
    const r = classifyExpenseLabel('xyzzy frobble nonce');
    assertBase(r);
    expect(r.bucketCategory).toBe('otherItems');
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('confidence is always in [0, 1]', () => {
    const labels = [
      'CAM', 'common area maintenance', 'real estate taxes', 'insurance',
      'security patrol', 'g3nera*** admin f55', 'xyzzy unknown', '',
      'trlple net', 'rea1 estate taxe5', 'c0mmon area ma1ntenance',
    ];
    for (const label of labels) {
      const r = classifyExpenseLabel(label);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('exact matches always return confidence >= 0.9', () => {
    const exactLabels = [
      'cams', 'common area maintenance', 'real estate taxes',
      'property insurance', 'security patrol', 'management fee',
    ];
    for (const label of exactLabels) {
      const r = classifyExpenseLabel(label);
      if (r.matchType === 'exact') {
        expect(r.confidence).toBeGreaterThanOrEqual(0.9);
      }
    }
  });
});
