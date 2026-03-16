/**
 * @fileoverview Robust expense-label classifier for commercial lease documents.
 *
 * Pipeline: normalize → OCR correct → exact lookup → alias lookup →
 *           token scoring → fuzzy match → OCR salvage → fallback
 *
 * Every classification produces a full trace object so the UI can display
 * how a raw label was interpreted. No classification is silent.
 *
 * Downstream calculator compatibility is preserved: every result has a
 * `bucketCategory` that is one of the five canonical bucket keys.
 */

// ---------------------------------------------------------------------------
// Canonical bucket keys and display definitions
// ---------------------------------------------------------------------------

/**
 * Ordered list of valid downstream calculator bucket keys.
 * @type {string[]}
 */
export const NNN_BUCKET_KEYS = ['cams', 'insurance', 'taxes', 'security', 'otherItems'];

/**
 * Canonical category definitions — single source of truth for display labels.
 * Import this anywhere a hardcoded { prefix, label } array currently exists.
 *
 * @type {Record<string, { bucketCategory: string, displayLabel: string }>}
 */
export const EXPENSE_CATEGORY_DEFS = {
  cams:       { bucketCategory: 'cams',       displayLabel: 'CAMS'        },
  insurance:  { bucketCategory: 'insurance',  displayLabel: 'Insurance'   },
  taxes:      { bucketCategory: 'taxes',      displayLabel: 'Taxes'       },
  security:   { bucketCategory: 'security',   displayLabel: 'Security'    },
  otherItems: { bucketCategory: 'otherItems', displayLabel: 'Other Items' },
};

// ---------------------------------------------------------------------------
// Thresholds (exposed as constants for auditability)
// ---------------------------------------------------------------------------

/** Minimum Dice-coefficient score to accept a fuzzy match. */
export const FUZZY_THRESHOLD = 0.72;

/** Minimum token-scoring sum to accept a token-based classification. */
const TOKEN_SCORE_THRESHOLD = 1.5;

// ---------------------------------------------------------------------------
// A) Abbreviation expansion (applied during normalization)
// ---------------------------------------------------------------------------

const ABBREV_PATTERNS = [
  // Dotted abbreviations first (more specific)
  [/c\.a\.m\.s?/g,              'cams'],
  [/n\.n\.n\./g,                'nnn'],
  [/r\.e\.(\s*tax(es)?)/g,      'real estate tax$1'],
  [/r\.e\.\s*$/g,               'real estate'],
  // Slash-based composite (normalize before further processing)
  [/water\s*\/\s*sewer/gi,      'water sewer'],
  [/\//g,                       ' '],
  // Hyphen between words → space (keep hyphens as part of compound words only if no spaces)
  [/-+/g,                       ' '],
  // Common short-form expansions
  [/\bop\s*ex\b/gi,             'operating expenses'],
  [/\bop\s*expenses\b/gi,       'operating expenses'],
  [/\bcam\s+charges?\b/gi,      'cam'],
  [/\bnnn\s+charges?\b/gi,      'nnn'],
  [/\btriple\s+net\s+charges?\b/gi, 'nnn'],
  [/\btriple\s+net\b/gi,        'nnn'],
  [/\bnet\s+net\s+net\b/gi,     'nnn'],
];

// ---------------------------------------------------------------------------
// B) Targeted OCR correction (conservative word-level substitutions)
// ---------------------------------------------------------------------------

/**
 * Word-level targeted OCR corrections.
 * Only apply to clearly mis-OCR'd words. Do not overcorrect.
 */
const OCR_WORD_CORRECTIONS = {
  'operatlng':    'operating',
  'malntenance':  'maintenance',
  'maintenancee': 'maintenance',
  'maintenence':  'maintenance',
  'maintenonce':  'maintenance',
  'insuranee':    'insurance',
  'lnsurance':    'insurance',
  'insur ance':   'insurance',
  'insuronce':    'insurance',
  'trlple':       'triple',
  'tripe':        'triple',
  'securlty':     'security',
  'securi ty':    'security',
  'securtiy':     'security',
  'utllities':    'utilities',
  'utiltties':    'utilities',
  'utilitiees':   'utilities',
  'utiltiies':    'utilities',
  'utillties':    'utilities',
  'adm1n':        'admin',
  'administratlve': 'administrative',
  'asses5ments':  'assessments',
  'asses5ment':   'assessment',
  'assessements': 'assessments',
  'taxe5':        'taxes',
  'cammon':       'common',
  'comman':       'common',
  'expens5':      'expenses',
  'expenes':      'expenses',
  'expence':      'expense',
  'expences':     'expenses',
  'propert y':    'property',
  'reat':         'real',
  'rea1':         'real',
  'esta te':      'estate',
  'estote':       'estate',
  'hazord':       'hazard',
  'lancscaping':  'landscaping',
  'landcsaping':  'landscaping',
  'elevato r':    'elevator',
  'hvoc':         'hvac',
  'janitoral':    'janitorial',
  'janitorial ':  'janitorial',
  'manogement':   'management',
  'managment':    'management',
  'managemen t':  'management',
  'servlce':      'service',
};

// ---------------------------------------------------------------------------
// C) OCR salvage — known-vocabulary set and digit-to-letter map
// ---------------------------------------------------------------------------

/** Vocabulary set for token rescue in heavily damaged labels. */
const KNOWN_VOCAB = new Set([
  'common','area','maintenance','operating','expense','expenses','cost','costs',
  'real','estate','taxes','tax','insurance','property','cam','cams',
  'security','service','guard','patrol','admin','administrative','general',
  'management','fee','utilities','utility','trash','removal','refuse',
  'janitorial','landscaping','grounds','hvac','water','sewer','elevator',
  'triple','net','nnn','charges','additional','rent','casualty',
  'hazard','fire','premium','ad','valorem','assessment','assessments',
  'building','project','recovery','reimbursement','special','patrol',
  'services','maintenance','coverage','liability','casualty',
]);

/**
 * Ordered digit-to-letter substitutions to try during OCR salvage.
 * Earlier entries are tried first (more common OCR errors).
 */
const DIGIT_LETTER_SUBS = [
  ['0', 'o'],
  ['1', 'l'],
  ['1', 'i'],
  ['3', 'e'],
  ['5', 's'],
  ['5', 'e'],
  ['4', 'a'],
  ['6', 'g'],
  ['8', 'b'],
  ['2', 'z'],
];

// ---------------------------------------------------------------------------
// D) Canonical lookup table — phrase → { bucket, subtype }
// ---------------------------------------------------------------------------

/**
 * Flat canonical map. Keys are fully normalized phrases (already lowercase,
 * trimmed, abbreviations expanded).
 *
 * Organized by bucket for readability; all entries go into one Map at init.
 */
const CANONICAL_ENTRIES = [
  // ── CAMS ──────────────────────────────────────────────────────────────────
  ['cam',                           { bucket: 'cams', subtype: 'cam' }],
  ['cams',                          { bucket: 'cams', subtype: 'cam' }],
  ['cam charges',                   { bucket: 'cams', subtype: 'cam' }],
  ['cam fee',                       { bucket: 'cams', subtype: 'cam' }],
  ['common area maintenance',       { bucket: 'cams', subtype: 'common_area_maintenance' }],
  ['common area maintenance charges',{ bucket: 'cams', subtype: 'common_area_maintenance' }],
  ['common area costs',             { bucket: 'cams', subtype: 'common_area_maintenance' }],
  ['common area expenses',          { bucket: 'cams', subtype: 'common_area_maintenance' }],
  ['common area fees',              { bucket: 'cams', subtype: 'common_area_maintenance' }],
  ['operating expenses',            { bucket: 'cams', subtype: 'operating_expenses' }],
  ['operating expense',             { bucket: 'cams', subtype: 'operating_expenses' }],
  ['operating costs',               { bucket: 'cams', subtype: 'operating_expenses' }],
  ['operating cost',                { bucket: 'cams', subtype: 'operating_expenses' }],
  ['operating cost recovery',       { bucket: 'cams', subtype: 'operating_cost_recovery' }],
  ['operating cost reimbursement',  { bucket: 'cams', subtype: 'operating_cost_recovery' }],
  ['operating expense recovery',    { bucket: 'cams', subtype: 'operating_cost_recovery' }],
  ['building expenses',             { bucket: 'cams', subtype: 'operating_expenses' }],
  ['building expense',              { bucket: 'cams', subtype: 'operating_expenses' }],
  ['project expenses',              { bucket: 'cams', subtype: 'operating_expenses' }],
  ['maintenance charges',           { bucket: 'cams', subtype: 'common_area_maintenance' }],
  ['maintenance fees',              { bucket: 'cams', subtype: 'common_area_maintenance' }],
  // Composite NNN → cams bucket with nnn_composite subtype + warning
  ['nnn',                           { bucket: 'cams', subtype: 'nnn_composite', composite: true }],
  ['nnn rent',                      { bucket: 'cams', subtype: 'nnn_composite', composite: true }],
  ['triple net',                    { bucket: 'cams', subtype: 'nnn_composite', composite: true }],
  ['net charges',                   { bucket: 'cams', subtype: 'nnn_composite', composite: true }],
  ['net operating charges',         { bucket: 'cams', subtype: 'nnn_composite', composite: true }],
  ['additional rent',               { bucket: 'cams', subtype: 'nnn_composite', composite: true }],
  ['base year costs',               { bucket: 'cams', subtype: 'nnn_composite', composite: true }],

  // ── INSURANCE ─────────────────────────────────────────────────────────────
  ['insurance',                     { bucket: 'insurance', subtype: 'property_insurance' }],
  ['property insurance',            { bucket: 'insurance', subtype: 'property_insurance' }],
  ['hazard insurance',              { bucket: 'insurance', subtype: 'hazard_insurance' }],
  ['casualty insurance',            { bucket: 'insurance', subtype: 'casualty_insurance' }],
  ['fire insurance',                { bucket: 'insurance', subtype: 'property_insurance' }],
  ['property and casualty',         { bucket: 'insurance', subtype: 'casualty_insurance' }],
  ['insurance premium',             { bucket: 'insurance', subtype: 'property_insurance' }],
  ['insurance premiums',            { bucket: 'insurance', subtype: 'property_insurance' }],
  ['liability insurance',           { bucket: 'insurance', subtype: 'property_insurance' }],
  ['building insurance',            { bucket: 'insurance', subtype: 'property_insurance' }],

  // ── TAXES ─────────────────────────────────────────────────────────────────
  ['taxes',                         { bucket: 'taxes', subtype: 'real_estate_taxes' }],
  ['tax',                           { bucket: 'taxes', subtype: 'real_estate_taxes' }],
  ['real estate taxes',             { bucket: 'taxes', subtype: 'real_estate_taxes' }],
  ['real estate tax',               { bucket: 'taxes', subtype: 'real_estate_taxes' }],
  ['property taxes',                { bucket: 'taxes', subtype: 'real_estate_taxes' }],
  ['property tax',                  { bucket: 'taxes', subtype: 'real_estate_taxes' }],
  ['ad valorem taxes',              { bucket: 'taxes', subtype: 'ad_valorem_taxes' }],
  ['ad valorem tax',                { bucket: 'taxes', subtype: 'ad_valorem_taxes' }],
  ['ad valorem',                    { bucket: 'taxes', subtype: 'ad_valorem_taxes' }],
  ['assessments',                   { bucket: 'taxes', subtype: 'assessments' }],
  ['assessment',                    { bucket: 'taxes', subtype: 'assessments' }],
  ['special assessments',           { bucket: 'taxes', subtype: 'assessments' }],
  ['special assessment',            { bucket: 'taxes', subtype: 'assessments' }],
  ['tax assessment',                { bucket: 'taxes', subtype: 'assessments' }],

  // ── SECURITY ──────────────────────────────────────────────────────────────
  ['security',                      { bucket: 'security', subtype: 'security_service' }],
  ['security service',              { bucket: 'security', subtype: 'security_service' }],
  ['security services',             { bucket: 'security', subtype: 'security_service' }],
  ['security charges',              { bucket: 'security', subtype: 'security_service' }],
  ['patrol',                        { bucket: 'security', subtype: 'guard_patrol' }],
  ['guard service',                 { bucket: 'security', subtype: 'guard_patrol' }],
  ['guard services',                { bucket: 'security', subtype: 'guard_patrol' }],
  ['guard patrol',                  { bucket: 'security', subtype: 'guard_patrol' }],
  ['security patrol',               { bucket: 'security', subtype: 'guard_patrol' }],
  ['security guard',                { bucket: 'security', subtype: 'guard_patrol' }],

  // ── OTHER ITEMS ───────────────────────────────────────────────────────────
  ['general admin fee',             { bucket: 'otherItems', subtype: 'general_admin_fee' }],
  ['general admin fees',            { bucket: 'otherItems', subtype: 'general_admin_fee' }],
  ['general admin',                 { bucket: 'otherItems', subtype: 'general_admin_fee' }],
  ['general administrative fee',    { bucket: 'otherItems', subtype: 'general_admin_fee' }],
  ['general administrative fees',   { bucket: 'otherItems', subtype: 'general_admin_fee' }],
  ['administrative fee',            { bucket: 'otherItems', subtype: 'administrative_fee' }],
  ['administrative fees',           { bucket: 'otherItems', subtype: 'administrative_fee' }],
  ['admin fee',                     { bucket: 'otherItems', subtype: 'administrative_fee' }],
  ['admin fees',                    { bucket: 'otherItems', subtype: 'administrative_fee' }],
  ['administration fee',            { bucket: 'otherItems', subtype: 'administrative_fee' }],
  ['management fee',                { bucket: 'otherItems', subtype: 'management_fee' }],
  ['management fees',               { bucket: 'otherItems', subtype: 'management_fee' }],
  ['property management fee',       { bucket: 'otherItems', subtype: 'management_fee' }],
  ['property management fees',      { bucket: 'otherItems', subtype: 'management_fee' }],
  ['service fee',                   { bucket: 'otherItems', subtype: 'service_fee' }],
  ['service fees',                  { bucket: 'otherItems', subtype: 'service_fee' }],
  ['utilities',                     { bucket: 'otherItems', subtype: 'utilities' }],
  ['utility',                       { bucket: 'otherItems', subtype: 'utilities' }],
  ['utility charges',               { bucket: 'otherItems', subtype: 'utilities' }],
  ['trash',                         { bucket: 'otherItems', subtype: 'trash' }],
  ['trash removal',                 { bucket: 'otherItems', subtype: 'trash' }],
  ['trash collection',              { bucket: 'otherItems', subtype: 'trash' }],
  ['refuse',                        { bucket: 'otherItems', subtype: 'trash' }],
  ['refuse removal',                { bucket: 'otherItems', subtype: 'trash' }],
  ['garbage',                       { bucket: 'otherItems', subtype: 'trash' }],
  ['janitorial',                    { bucket: 'otherItems', subtype: 'janitorial' }],
  ['janitorial services',           { bucket: 'otherItems', subtype: 'janitorial' }],
  ['janitorial service',            { bucket: 'otherItems', subtype: 'janitorial' }],
  ['cleaning',                      { bucket: 'otherItems', subtype: 'janitorial' }],
  ['cleaning services',             { bucket: 'otherItems', subtype: 'janitorial' }],
  ['landscaping',                   { bucket: 'otherItems', subtype: 'landscaping' }],
  ['grounds maintenance',           { bucket: 'otherItems', subtype: 'landscaping' }],
  ['grounds keeping',               { bucket: 'otherItems', subtype: 'landscaping' }],
  ['grounds care',                  { bucket: 'otherItems', subtype: 'landscaping' }],
  ['hvac maintenance',              { bucket: 'otherItems', subtype: 'hvac_maintenance' }],
  ['hvac',                          { bucket: 'otherItems', subtype: 'hvac_maintenance' }],
  ['heating ventilation',           { bucket: 'otherItems', subtype: 'hvac_maintenance' }],
  ['water',                         { bucket: 'otherItems', subtype: 'water' }],
  ['sewer',                         { bucket: 'otherItems', subtype: 'sewer' }],
  ['water sewer',                   { bucket: 'otherItems', subtype: 'water_sewer' }],
  ['water and sewer',               { bucket: 'otherItems', subtype: 'water_sewer' }],
  ['water sewer charges',           { bucket: 'otherItems', subtype: 'water_sewer' }],
  ['elevator maintenance',          { bucket: 'otherItems', subtype: 'elevator_maintenance' }],
  ['elevator',                      { bucket: 'otherItems', subtype: 'elevator_maintenance' }],
  ['elevator service',              { bucket: 'otherItems', subtype: 'elevator_maintenance' }],
];

/** Compiled canonical map — populated once at module load. */
const CANONICAL_MAP = new Map(CANONICAL_ENTRIES);

// ---------------------------------------------------------------------------
// E) Token scoring weights (per bucket)
// ---------------------------------------------------------------------------

const TOKEN_WEIGHTS = {
  cams: {
    'cam':               3.0,
    'cams':              3.0,
    'common area':       3.0,
    'common':            1.5,
    'operating':         1.5,
    'maintenance':       0.8,   // weak alone; "service maintenance" could be otherItems
    'building expense':  1.5,
    'project expense':   1.5,
    'recovery':          0.5,
    'reimbursement':     0.5,
    'charges':           0.2,   // very weak — don't trigger alone
  },
  insurance: {
    'insurance':         3.0,
    'premium':           2.5,
    'casualty':          2.5,
    'hazard':            2.5,
    'fire':              1.2,
    'coverage':          1.5,
    'liability':         1.5,
  },
  taxes: {
    'tax':               3.0,
    'taxes':             3.0,
    'ad valorem':        3.0,
    'assessment':        2.5,
    'assessments':       2.5,
    'levy':              2.0,
    'real estate':       2.0,
    'property':          0.5,   // weak — "property management" is otherItems
  },
  security: {
    'security':          3.0,
    'guard':             3.0,
    'patrol':            3.0,
    'surveillance':      2.0,
  },
  otherItems: {
    'admin':             2.0,
    'administrative':    2.0,
    'management fee':    2.5,
    'janitorial':        3.0,
    'landscaping':       3.0,
    'utilities':         3.0,
    'utility':           3.0,
    'hvac':              3.0,
    'trash':             3.0,
    'refuse':            2.5,
    'garbage':           2.5,
    'water':             2.0,
    'sewer':             2.0,
    'elevator':          2.5,
    'cleaning':          2.0,
    'grounds':           1.5,
    'service':           0.4,   // weak — "security service" could be security
    'fee':               0.4,   // weak alone
  },
};

// ---------------------------------------------------------------------------
// Helper: Bigram Dice coefficient (fuzzy similarity)
// ---------------------------------------------------------------------------

/**
 * Compute the Dice coefficient of bigram overlap between two strings.
 * Returns 0–1 where 1 is identical.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function dicoeff(a, b) {
  if (a === b) return 1.0;
  if (a.length < 2 || b.length < 2) {
    // Fallback to exact character match ratio for very short strings
    if (a === b) return 1.0;
    return a.includes(b) || b.includes(a) ? 0.6 : 0.0;
  }

  const buildBigrams = (s) => {
    const bg = [];
    for (let i = 0; i < s.length - 1; i++) bg.push(s.slice(i, i + 2));
    return bg;
  };

  const bgA = buildBigrams(a);
  const bgB = buildBigrams(b);
  const setA = new Map();
  for (const bg of bgA) setA.set(bg, (setA.get(bg) ?? 0) + 1);

  let matches = 0;
  for (const bg of bgB) {
    const cnt = setA.get(bg) ?? 0;
    if (cnt > 0) {
      matches++;
      setA.set(bg, cnt - 1);
    }
  }

  return (2 * matches) / (bgA.length + bgB.length);
}

// ---------------------------------------------------------------------------
// A) Normalization
// ---------------------------------------------------------------------------

/**
 * Apply abbreviation expansions to a (lowercase, trimmed) string.
 * Runs patterns in order; later patterns see the result of earlier ones.
 *
 * @param {string} s - Already lowercase + trimmed.
 * @returns {string}
 */
function abbrevExpand(s) {
  let result = s;
  for (const [pattern, replacement] of ABBREV_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Normalize a raw expense label into a canonical form for lookup.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalizeExpenseLabel(raw) {
  if (!raw || typeof raw !== 'string') return '';

  // Step 1: lowercase + trim (abbreviation patterns require lowercase)
  let s = raw.toLowerCase().trim();

  // Step 2: run abbreviation expansion BEFORE any period stripping so that
  //         dotted abbreviations like C.A.M. and R.E. are expanded while the
  //         dots are still present.
  s = abbrevExpand(s);

  // Step 3: clean up remaining punctuation
  s = s
    // Normalize ellipsis, em-dash, en-dash, etc. to spaces
    .replace(/[—–…]+/g, ' ')
    // Normalize parentheses content
    .replace(/\(.*?\)/g, ' ')
    // Normalize commas, semicolons, colons → spaces
    .replace(/[,;:]+/g, ' ')
    // Strip any remaining isolated dots (abbrevs already expanded above)
    .replace(/\.+/g, ' ')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();

  return s;
}

// ---------------------------------------------------------------------------
// B) Conservative OCR cleanup
// ---------------------------------------------------------------------------

/**
 * Apply targeted word-level OCR corrections to a normalized string.
 * This layer is compact and explicit — only known OCR noise patterns.
 *
 * @param {string} s - Normalized string.
 * @returns {string}
 */
export function applyOcrCorrections(s) {
  let result = s;
  for (const [bad, good] of Object.entries(OCR_WORD_CORRECTIONS)) {
    // Word-boundary-aware replacement where possible
    const escaped = bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`\\b${escaped}\\b`, 'g'), good);
  }
  return result.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// C) OCR salvage
// ---------------------------------------------------------------------------

/**
 * Attempt to rescue a single OCR-damaged token by trying digit-to-letter
 * substitutions until the result appears in the known vocabulary.
 *
 * @param {string} token - Single lowercase token to rescue.
 * @returns {{ rescued: string, changed: boolean }}
 */
function rescueToken(token) {
  if (KNOWN_VOCAB.has(token)) return { rescued: token, changed: false };
  if (!/[0-9]/.test(token)) return { rescued: token, changed: false };
  if (token.length > 20) return { rescued: token, changed: false }; // safety

  // Try single-digit substitutions first (most common OCR errors)
  for (const [digit, letter] of DIGIT_LETTER_SUBS) {
    if (!token.includes(digit)) continue;
    const candidate = token.replaceAll(digit, letter);
    if (KNOWN_VOCAB.has(candidate)) {
      return { rescued: candidate, changed: true };
    }
  }

  // Try all substitutions simultaneously (covers multi-digit corruption)
  let allSub = token;
  let anyChanged = false;
  for (const [digit, letter] of DIGIT_LETTER_SUBS) {
    if (allSub.includes(digit)) {
      allSub = allSub.replaceAll(digit, letter);
      anyChanged = true;
    }
  }
  if (anyChanged && KNOWN_VOCAB.has(allSub)) {
    return { rescued: allSub, changed: true };
  }

  // Fuzzy fallback: check if the token is close to any vocab word after all-subs
  if (anyChanged) {
    let best = { score: 0, word: null };
    for (const word of KNOWN_VOCAB) {
      const score = dicoeff(allSub, word);
      if (score > best.score) best = { score, word };
    }
    if (best.score >= 0.75 && best.word) {
      return { rescued: best.word, changed: true };
    }
  }

  return { rescued: token, changed: false };
}

/**
 * Salvage a heavily OCR-damaged label.
 *
 * Strategy:
 * 1. Strip repeated symbol noise (e.g. "***", "###")
 * 2. Strip non-alphanumeric characters that clearly are scanner artifacts
 * 3. Attempt token-level rescue via digit-to-letter substitution
 * 4. Re-run abbreviated expansion and canonical lookup
 *
 * @param {string} s - Already normalized + OCR-corrected string.
 * @returns {{ salvaged: string, changed: boolean, tokensChanged: string[] }}
 */
export function salvageOcrDamagedLabel(s) {
  // Step 1: remove runs of punctuation/symbols (keep hyphens between letters)
  let cleaned = s
    .replace(/[*#@!$%^&+=~`|\\<>?]{2,}/g, ' ')  // repeated symbol noise
    .replace(/[*#@!$%^&+=~`|\\<>?]/g, ' ')        // any remaining single noise chars
    .replace(/\s+/g, ' ')
    .trim();

  // Step 2: tokenize and attempt per-token rescue
  const tokens = cleaned.split(/\s+/);
  const rescuedTokens = [];
  const tokensChanged = [];

  for (const token of tokens) {
    if (!token) continue;
    const { rescued, changed } = rescueToken(token);
    rescuedTokens.push(rescued);
    if (changed) tokensChanged.push(`${token} → ${rescued}`);
  }

  const salvaged = abbrevExpand(rescuedTokens.join(' ').replace(/\s+/g, ' ').trim());
  const changed = salvaged !== s || tokensChanged.length > 0;

  return { salvaged, changed, tokensChanged };
}

// ---------------------------------------------------------------------------
// F) Fuzzy matching
// ---------------------------------------------------------------------------

/**
 * Find the best fuzzy match in the canonical map for a normalized string.
 *
 * @param {string} normalized
 * @returns {{ entry: {bucket, subtype, composite?}, score: number, phrase: string } | null}
 */
function fuzzyMatch(normalized) {
  let best = { score: 0, phrase: null, entry: null };

  for (const [phrase, entry] of CANONICAL_MAP) {
    const score = dicoeff(normalized, phrase);
    if (score > best.score) {
      best = { score, phrase, entry };
    }
  }

  if (best.score >= FUZZY_THRESHOLD) {
    return best;
  }
  return null;
}

// ---------------------------------------------------------------------------
// E) Token scoring
// ---------------------------------------------------------------------------

/**
 * Score a normalized string against all bucket token weights.
 * Returns the winning bucket and score, or null if below threshold.
 *
 * @param {string} normalized
 * @returns {{ bucket: string, score: number, matchedTokens: string[] } | null}
 */
function tokenScore(normalized) {
  const bucketScores = {};
  const matchedByBucket = {};

  for (const bucket of NNN_BUCKET_KEYS) {
    bucketScores[bucket] = 0;
    matchedByBucket[bucket] = [];
  }

  for (const bucket of NNN_BUCKET_KEYS) {
    const weights = TOKEN_WEIGHTS[bucket];
    for (const [token, weight] of Object.entries(weights)) {
      // Check if the token phrase appears in the normalized string
      if (normalized.includes(token)) {
        bucketScores[bucket] += weight;
        matchedByBucket[bucket].push(token);
      }
    }
  }

  // Find winner
  let winner = null;
  let winnerScore = 0;
  for (const bucket of NNN_BUCKET_KEYS) {
    if (bucketScores[bucket] > winnerScore) {
      winnerScore = bucketScores[bucket];
      winner = bucket;
    }
  }

  if (!winner || winnerScore < TOKEN_SCORE_THRESHOLD) return null;

  // Check for ambiguity: second place is within 60% of winner
  const scores = NNN_BUCKET_KEYS.map((b) => bucketScores[b]).sort((a, b) => b - a);
  const ambiguous = scores.length > 1 && scores[0] > 0 && scores[1] / scores[0] >= 0.6;

  return {
    bucket: winner,
    score: winnerScore,
    matchedTokens: matchedByBucket[winner],
    ambiguous,
  };
}

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ClassificationResult
 * @property {string}        rawLabel          - Original input string.
 * @property {string}        normalizedLabel   - After normalization pipeline.
 * @property {string}        bucketCategory    - One of the five calculator buckets.
 * @property {string|null}   semanticSubtype   - Finer semantic type when determinable.
 * @property {number}        confidence        - 0–1.
 * @property {string}        matchType         - 'exact' | 'alias' | 'token' | 'fuzzy' | 'ocr_rescue' | 'fallback'
 * @property {string|null}   matchedCanonical  - Best canonical phrase driving the result.
 * @property {string[]}      tokens            - Tokens extracted from normalized label.
 * @property {string[]}      warnings          - Non-blocking classification notes.
 */

/**
 * Classify a raw expense label through the full pipeline.
 *
 * Pipeline stages:
 *   1. Normalize
 *   2. Exact canonical lookup
 *   3. OCR word corrections → exact lookup
 *   4. Token scoring
 *   5. Fuzzy matching
 *   6. OCR salvage → exact lookup + fuzzy
 *   7. Fallback with warning
 *
 * @param {string} rawLabel
 * @param {{ forceOcrSalvage?: boolean }} [options]
 * @returns {ClassificationResult}
 */
export function classifyExpenseLabel(rawLabel, options = {}) {
  const warnings = [];
  const tokens = [];

  if (!rawLabel || typeof rawLabel !== 'string' || !rawLabel.trim()) {
    return {
      rawLabel: rawLabel ?? '',
      normalizedLabel: '',
      bucketCategory: 'otherItems',
      semanticSubtype: null,
      confidence: 0,
      matchType: 'fallback',
      matchedCanonical: null,
      tokens: [],
      warnings: ['Empty or null label received; defaulted to otherItems.'],
    };
  }

  // ── Stage 1: Normalize ────────────────────────────────────────────────────
  const normalizedLabel = normalizeExpenseLabel(rawLabel);
  const normalizedTokens = normalizedLabel.split(/\s+/).filter(Boolean);
  tokens.push(...normalizedTokens);

  // ── Stage 2: Exact canonical lookup ──────────────────────────────────────
  const exact = CANONICAL_MAP.get(normalizedLabel);
  if (exact) {
    if (exact.composite) {
      warnings.push(
        `Composite NNN label "${rawLabel}" detected and routed to CAMS because ` +
        `the lease did not provide a separate CAM/insurance/tax breakout.`
      );
    }
    return {
      rawLabel,
      normalizedLabel,
      bucketCategory: exact.bucket,
      semanticSubtype: exact.subtype,
      confidence: 1.0,
      matchType: 'exact',
      matchedCanonical: normalizedLabel,
      tokens,
      warnings,
    };
  }

  // ── Stage 3: OCR corrections → exact lookup ───────────────────────────────
  const ocrCorrected = applyOcrCorrections(normalizedLabel);
  if (ocrCorrected !== normalizedLabel) {
    const afterCorr = CANONICAL_MAP.get(ocrCorrected);
    if (afterCorr) {
      if (afterCorr.composite) {
        warnings.push(
          `Composite NNN label "${rawLabel}" detected after OCR correction and routed to CAMS.`
        );
      }
      return {
        rawLabel,
        normalizedLabel: ocrCorrected,
        bucketCategory: afterCorr.bucket,
        semanticSubtype: afterCorr.subtype,
        confidence: 0.95,
        matchType: 'exact',
        matchedCanonical: ocrCorrected,
        tokens,
        warnings,
      };
    }
  }

  const workingLabel = ocrCorrected || normalizedLabel;

  // ── Stage 4: Token scoring ────────────────────────────────────────────────
  const tokenResult = tokenScore(workingLabel);
  if (tokenResult && !tokenResult.ambiguous) {
    // Try to infer a subtype by finding the best-scoring canonical phrase in
    // the winning bucket via fuzzy search restricted to that bucket
    let bestSubtype = null;
    let bestCanonical = null;
    let bestFuzzy = 0;
    for (const [phrase, entry] of CANONICAL_MAP) {
      if (entry.bucket !== tokenResult.bucket) continue;
      const score = dicoeff(workingLabel, phrase);
      if (score > bestFuzzy) {
        bestFuzzy = score;
        bestSubtype = entry.subtype;
        bestCanonical = phrase;
      }
    }

    const confidence = Math.min(0.82, 0.55 + tokenResult.score * 0.05);

    if (bestFuzzy < 0.5) {
      warnings.push(
        `Label "${rawLabel}" classified as ${tokenResult.bucket} by token scoring ` +
        `(tokens: ${tokenResult.matchedTokens.join(', ')}) but subtype is unclear.`
      );
      bestSubtype = null;
    }

    return {
      rawLabel,
      normalizedLabel: workingLabel,
      bucketCategory: tokenResult.bucket,
      semanticSubtype: bestSubtype,
      confidence,
      matchType: 'token',
      matchedCanonical: bestCanonical,
      tokens,
      warnings,
    };
  }

  if (tokenResult && tokenResult.ambiguous) {
    warnings.push(
      `Label "${rawLabel}" produced ambiguous token scores; proceeding to fuzzy matching.`
    );
  }

  // ── Stage 5: Fuzzy matching ───────────────────────────────────────────────
  const fuzzy = fuzzyMatch(workingLabel);
  if (fuzzy) {
    if (fuzzy.entry.composite) {
      warnings.push(
        `Composite NNN label "${rawLabel}" matched via fuzzy search and routed to CAMS.`
      );
    }
    warnings.push(
      `Label "${rawLabel}" classified via fuzzy match to "${fuzzy.phrase}" ` +
      `(score: ${fuzzy.score.toFixed(2)}). Verify this is correct.`
    );
    return {
      rawLabel,
      normalizedLabel: workingLabel,
      bucketCategory: fuzzy.entry.bucket,
      semanticSubtype: fuzzy.entry.subtype,
      confidence: Math.min(0.78, fuzzy.score * 0.88),
      matchType: 'fuzzy',
      matchedCanonical: fuzzy.phrase,
      tokens,
      warnings,
    };
  }

  // ── Stage 6: OCR salvage → exact + fuzzy ─────────────────────────────────
  const { salvaged, changed: salvageChanged, tokensChanged } = salvageOcrDamagedLabel(workingLabel);

  if (salvageChanged && salvaged !== workingLabel) {
    if (tokensChanged.length) {
      warnings.push(
        `OCR salvage substitutions: ${tokensChanged.join('; ')}. ` +
        `Rescued label: "${salvaged}". Verify accuracy.`
      );
    }

    const salvageExact = CANONICAL_MAP.get(salvaged);
    if (salvageExact) {
      if (salvageExact.composite) {
        warnings.push(`Composite NNN detected after OCR salvage; routed to CAMS.`);
      }
      return {
        rawLabel,
        normalizedLabel: salvaged,
        bucketCategory: salvageExact.bucket,
        semanticSubtype: salvageExact.subtype,
        confidence: 0.72,
        matchType: 'ocr_rescue',
        matchedCanonical: salvaged,
        tokens,
        warnings,
      };
    }

    // Fuzzy on salvaged string
    const salvageFuzzy = fuzzyMatch(salvaged);
    if (salvageFuzzy) {
      if (salvageFuzzy.entry.composite) {
        warnings.push(`Composite NNN detected after OCR salvage + fuzzy; routed to CAMS.`);
      }
      warnings.push(
        `Post-salvage fuzzy match to "${salvageFuzzy.phrase}" ` +
        `(score: ${salvageFuzzy.score.toFixed(2)}). Low confidence — verify.`
      );
      return {
        rawLabel,
        normalizedLabel: salvaged,
        bucketCategory: salvageFuzzy.entry.bucket,
        semanticSubtype: salvageFuzzy.entry.subtype,
        confidence: Math.min(0.62, salvageFuzzy.score * 0.75),
        matchType: 'ocr_rescue',
        matchedCanonical: salvageFuzzy.phrase,
        tokens,
        warnings,
      };
    }

    // Token scoring on salvaged string
    const salvageToken = tokenScore(salvaged);
    if (salvageToken && !salvageToken.ambiguous) {
      warnings.push(
        `Post-salvage token classification as ${salvageToken.bucket}. ` +
        `Confidence is low — review raw label carefully.`
      );
      return {
        rawLabel,
        normalizedLabel: salvaged,
        bucketCategory: salvageToken.bucket,
        semanticSubtype: null,
        confidence: 0.52,
        matchType: 'ocr_rescue',
        matchedCanonical: null,
        tokens,
        warnings,
      };
    }
  }

  // ── Stage 7: Fallback ─────────────────────────────────────────────────────
  warnings.push(
    `Label "${rawLabel}" could not be reliably classified. ` +
    `Defaulted to otherItems. Manual review required.`
  );

  return {
    rawLabel,
    normalizedLabel: workingLabel,
    bucketCategory: 'otherItems',
    semanticSubtype: null,
    confidence: 0.25,
    matchType: 'fallback',
    matchedCanonical: null,
    tokens,
    warnings,
  };
}

/**
 * Convenience wrapper — returns only the calculator bucket category.
 * Use when you need to route a label to a form field without the full trace.
 *
 * @param {string} rawLabel
 * @returns {'cams'|'insurance'|'taxes'|'security'|'otherItems'}
 */
export function resolveCanonicalExpenseCategory(rawLabel) {
  return classifyExpenseLabel(rawLabel).bucketCategory;
}
