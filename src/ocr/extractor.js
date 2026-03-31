/**
 * @fileoverview OCR extractor for lease PDF documents.
 *
 * This is the ONLY file permitted to read import.meta.env.VITE_ANTHROPIC_API_KEY.
 * Access from any other file is a security boundary violation.
 *
 * Uses the Anthropic Messages API with document + vision blocks to extract
 * structured lease parameters from a raw PDF upload (Path A per spec Section 1).
 *
 * Returns an extraction result with confidence flags on unresolvable fields.
 * Does NOT bypass the human-in-the-loop confirmation step — the caller (App.jsx)
 * must gate processing on explicit user confirmation of all extracted fields.
 */

import { analyzeScheduleSemantics } from '../engine/scheduleSemantics.js';
import { extractDocumentTextFromFile } from './documentText.js';

const OCR_PROVIDER = (import.meta.env.VITE_OCR_PROVIDER || 'anthropic').toLowerCase();

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-opus-4-6';

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const OPENAI_MODEL = import.meta.env.VITE_OPENAI_OCR_MODEL || 'gpt-4o';

/**
 * @typedef {Object} NNNChargeExtraction
 * @property {number|null}  year1       - Year 1 monthly amount in dollars.
 * @property {number|null}  escPct      - Annual escalation percentage (whole number).
 * @property {string|null}  chargeStart - MM/DD/YYYY or null.
 * @property {string|null}  escStart    - MM/DD/YYYY or null.
 */

/**
 * @typedef {Object} RentTierExtraction
 * @property {string} periodStart - MM/DD/YYYY
 * @property {string} periodEnd   - MM/DD/YYYY
 * @property {number} monthlyRent - Monthly base rent in dollars.
 */

/**
 * @typedef {Object} ConcessionExtraction
 * @property {number|null} monthNumber
 * @property {number|null} value
 * @property {'percent'|'fixed_amount'|null} valueMode
 * @property {string|null} date
 * @property {string|null} label
 * @property {string|null} rawText
 * @property {string|null} assumptionNote
 */

/**
 * @typedef {Object} ExtractionResult
 * @property {RentTierExtraction[]} rentSchedule
 * @property {string|null}          leaseName          - Primary tenant or property name for display.
 * @property {number|null}          squareFootage
 * @property {ConcessionExtraction[]} freeRentEvents
 * @property {ConcessionExtraction[]} abatementEvents
 * @property {string|null}          abatementEndDate   - MM/DD/YYYY or null.
 * @property {number|null}          abatementPct       - 0–100.
 * @property {NNNChargeExtraction}  cams
 * @property {NNNChargeExtraction}  insurance
 * @property {NNNChargeExtraction}  taxes
 * @property {NNNChargeExtraction}  security
 * @property {NNNChargeExtraction}  otherItems
 * @property {number|null}          securityDeposit    - One-time security deposit amount.
 * @property {string|null}          securityDepositDate - MM/DD/YYYY date the deposit is due.
 * @property {number|null}          estimatedNNNMonthly - Monthly aggregate NNN estimate when individual breakdown unavailable.
 * @property {string[]}             confidenceFlags    - Field paths with low confidence.
 * @property {string[]}             notices            - Non-blocking extraction notices.
 * @property {boolean}              sfRequired         - True if rent is expressed as $/SF and SF is needed.
 * @property {'high'|'medium'|'low'} overallConfidence
 * @property {string|null}          rentCommencementDate - MM/DD/YYYY or null when directly resolved.
 * @property {Object|null}          scheduleNormalization - Semantic schedule analysis and materialization state.
 */

const EXTRACTION_PROMPT = `You are a commercial real estate lease analyst. Extract structured lease parameters from the document provided and return them as a single JSON object matching the schema below.

RULES:
1. If annual rent is provided, divide by 12 to derive monthly rent before returning.
2. If rent is expressed as $/SF/year or $/SF/month, set sfRequired = true and return the $/SF figure in the rentSchedule (the app will convert using square footage).
3. For any field you cannot resolve with reasonable confidence, return null for that field and add the field path to confidenceFlags.
4. All dates must be in MM/DD/YYYY format.
5. Percentages must be whole numbers (e.g. 3 for 3%).
6. Do not guess. If a value is ambiguous, return null and flag it.
7. Return ONLY the JSON object — no markdown, no prose.
9. abatementEndDate must be the LAST day of the abatement period (inclusive). E.g. "abatement through June 30" or "until June 30" → "06/30/YYYY". Do NOT return the first day of full rent.
10. ONE-TIME / NON-RECURRING ITEMS:
   a. Extract all one-time or non-recurring charges and credits, including but not limited to: security deposits, tenant improvement allowances (TIA), move-in allowances, landlord work contributions, lease commissions, parking deposits, HVAC or mechanical change-orders, and any other one-time charges or credits.
   b. For each item, return: a short label, the dollar amount (always positive), the due date (MM/DD/YYYY), and the sign (+1 for tenant obligation payable to landlord, -1 for landlord credit/payment to tenant).
   c. If a due date is not specified, return null for the date field (the app will assign it to lease commencement).
   d. Do NOT include recurring charges (rent, CAM, insurance, taxes) in this array.
   e. Security deposits go here as one-time items, NOT in the "security" NNN charge field.
   f. Rent abatement amounts should NOT be listed here — abatement is handled by the abatementEndDate and abatementPct fields.
8. NNN CHARGE FIELDS — STRICT RULES (cams, insurance, taxes, security, otherItems):
   a. Only populate year1 with a non-null value if the lease document explicitly states a SEPARATE, RECURRING line-item charge for that specific category. The category name or an unambiguous synonym must appear in the document alongside a dollar amount.
   b. Base rent values from the rent schedule must NEVER be placed in any NNN charge field. Rent schedule values belong only in the rentSchedule array.
   c. "security" must be null for all sub-fields unless the lease describes an ongoing, separately-billed security charge (NOT a one-time security deposit). One-time security deposits belong in oneTimeCharges.
   d. "otherItems" must be null for all sub-fields unless the lease explicitly names a recurring charge category not covered by CAMS, insurance, or taxes.
   e. An aggregate NNN estimate (e.g. "Estimated Annual Operating Expenses: $X" or "Estimated First Year NNN: $Y") is NOT a line-item charge. Populate "estimatedNNNMonthly" with the monthly aggregate amount (convert annual to monthly by dividing by 12). Keep individual NNN fields null. Still add a notice such as: "Estimated NNN total of $X found — individual breakdown unavailable, distributed evenly across CAMS/Insurance/Taxes."
   f. If the document lists NNN charges as a combined total without breaking them into CAMS, insurance, and taxes separately, leave all three fields null and add a notice.
9. abatementEndDate must be the LAST day of the abatement period (inclusive). E.g. "abatement through June 30" or "until June 30" → "06/30/YYYY". Do NOT return the first day of full rent.
10. leaseName: Extract the primary tenant business name or property name to use as the document title (e.g. "Anita's Mexican Foods", "123 Main Street — Suite 100"). Use the tenant name if clearly stated. If not identifiable, return null.
11. ONE-TIME CHARGES — Return ALL one-time fees, deposits, credits, and concessions in the "oneTimeCharges" array. Each element must have:
   { "label": string, "amount": number | null, "dueDate": string | null, "notes": string | null }
   - "amount": signed number — positive = tenant obligation/outflow, negative = landlord concession/credit (e.g. a moving allowance paid by landlord is negative).
   - "dueDate": MM/DD/YYYY string OR trigger-event text (e.g. "Lease Execution", "Within 30 days of occupancy", or null if not stated).
   - "notes": short description or status (e.g. "not elected", "multi-tranche", "per Section 4.2").
   - Multi-tranche items (e.g. TIA Initial Funding, TIA Final Funding) must be SEPARATE entries.
   - N/A / not-elected items (e.g. Letter of Credit not elected): set amount = 0, notes = "not elected".
   - Enumerate ALL of the following charge types found in the lease (omit only if truly absent and not mentioned):
     Security Deposit, TIA — Tenant Improvement Allowance (all tranches separately), Landlord Work Contribution,
     Moving Allowance, Base Rent Abatement (as lump-sum present-value credit if quantified), Lease Commissions
     (Tenant Broker and Landlord Broker as separate entries), Parking Deposits, HVAC or special equipment
     charge-orders, Letter of Credit, and any other one-time fee or credit explicitly named in the lease.
   - Do NOT include recurring monthly NNN charges here; those go in cams/insurance/taxes/security/otherItems.
   - "securityDeposit" / "securityDepositDate" are deprecated but still returned for backwards compatibility.

FREE RENT / ABATEMENT EXTRACTION:
- Prefer explicit month-number concessions whenever the lease states them.
- Example mappings:
  "month 1 free" -> freeRentEvents: [{ monthNumber: 1 }]
  "months 1 and 13 free" -> freeRentEvents: [{ monthNumber: 1 }, { monthNumber: 13 }]
  "50% abatement in month 4" -> abatementEvents: [{ monthNumber: 4, value: 50, valueMode: "percent" }]
- If only dated concession language is available, still populate freeRentEvents / abatementEvents with the best-supported date, label, rawText, and assumptionNote fields. The app will map those dated concessions onto resolved lease months before preview.
- Keep abatementEndDate / abatementPct only as backward-compatible fallbacks when a contiguous dated window is the only clear expression in the lease.

JSON SCHEMA:
{
  "rentSchedule": [
    { "periodStart": "MM/DD/YYYY", "periodEnd": "MM/DD/YYYY", "monthlyRent": number }
  ],
  "leaseName": "string" | null,
  "squareFootage": number | null,
  "rentCommencementDate": "MM/DD/YYYY" | null,
  "freeRentEvents": [
    { "monthNumber": number | null, "value": null, "valueMode": null, "date": "MM/DD/YYYY" | null, "label": "string" | null, "rawText": "string" | null, "assumptionNote": "string" | null }
  ],
  "abatementEvents": [
    { "monthNumber": number | null, "value": number | null, "valueMode": "percent" | "fixed_amount" | null, "date": "MM/DD/YYYY" | null, "label": "string" | null, "rawText": "string" | null, "assumptionNote": "string" | null }
  ],
  "abatementEndDate": "MM/DD/YYYY" | null,
  "abatementPct": number | null,
  "sfRequired": boolean,
  "cams":       { "year1": number | null, "escPct": number | null, "chargeStart": "MM/DD/YYYY" | null, "escStart": "MM/DD/YYYY" | null },
  "insurance":  { "year1": number | null, "escPct": number | null, "chargeStart": "MM/DD/YYYY" | null, "escStart": "MM/DD/YYYY" | null },
  "taxes":      { "year1": number | null, "escPct": number | null, "chargeStart": "MM/DD/YYYY" | null, "escStart": "MM/DD/YYYY" | null },
  "security":   { "year1": number | null, "escPct": number | null, "chargeStart": "MM/DD/YYYY" | null, "escStart": "MM/DD/YYYY" | null },
  "otherItems": { "year1": number | null, "escPct": number | null, "chargeStart": "MM/DD/YYYY" | null, "escStart": "MM/DD/YYYY" | null },
  "oneTimeItems": [
    { "label": "string", "amount": number, "dueDate": "MM/DD/YYYY" | null, "sign": 1 | -1 }
  ],
  "confidenceFlags": ["field.path", ...],
  "notices": ["string", ...],
  "recurringCharges": [
    {
      "label": "string",
      "year1": "number | null (MONTHLY — divide annual by 12 first)",
      "amountBasis": "monthly | annual | unknown",
      "escPct": "number | null (whole number, e.g. 3 for 3%)",
      "chargeStart": "MM/DD/YYYY | null",
      "escStart": "MM/DD/YYYY | null",
      "canonicalType": "nnn | other",
      "bucketKey": "cams | insurance | taxes | security | otherItems | null",
      "confidence": "number 0–1",
      "evidenceText": "string (short verbatim excerpt)",
      "sourceKind": "line_item | combined_estimate | narrative_obligation"
    }
  ]
}

12. securityDeposit (legacy) must only be set for the one-time security deposit if it also appears in oneTimeCharges. It must never include recurring charges.
13. RECURRING CHARGES ARRAY (recurringCharges — REQUIRED even if empty):
    Scan the ENTIRE lease for ALL recurring charge obligations beyond base rent and return them here.
    This array is the authoritative structured charge output. Include every recurring charge:
    Operating Expenses, Op Ex, OpEx, Common Area Maintenance, CAM, CAMS, Additional Rent,
    Triple Net, NNN, Insurance, Real Estate Taxes, Security services (ongoing recurring),
    Management Fees, Administrative Fees, Service Fees, Service Charges, and any other
    recurring obligation labeled as additional rent or operating charges.

    PRESERVE the exact lease-native label in "label" (e.g. if the lease says
    "Estimated Operating Expenses", use that — not "CAM" or "CAMS").

    For YEAR1: return the MONTHLY dollar amount. If the document gives an ANNUAL figure,
    divide by 12 before returning. Do NOT return the raw annual total as year1.
    Examples: "$150,000/year" → year1 = 12500; "$1,500/month" → year1 = 1500.

    ROUTING (canonicalType and bucketKey):
    - Operating Expenses / CAMS / Common Area / NNN composite / Triple Net → canonicalType: "nnn", bucketKey: "cams"
    - Insurance / Property Insurance / Hazard Insurance → canonicalType: "nnn", bucketKey: "insurance"
    - Real Estate Taxes / Property Taxes → canonicalType: "nnn", bucketKey: "taxes"
    - Security guard / patrol (recurring service) → canonicalType: "other", bucketKey: "security"
    - Management Fee / Administrative Fee / Service Fee / Service Charge → canonicalType: "other", bucketKey: "otherItems"
    - Unfamiliar but clearly recurring → canonicalType: "other", bucketKey: null

    RULES:
    a. COMBINED ESTIMATE (e.g. "Estimated First Year Operating Expenses: $150,000 annually"):
       → ONE entry: label = lease-native wording (e.g. "Operating Expenses"), year1 = 12500,
         amountBasis = "annual", canonicalType = "nnn", bucketKey = "cams",
         sourceKind = "combined_estimate".
       → Do NOT invent separate CAM / Insurance / Tax sub-entries from a combined amount.
    b. INDIVIDUALLY BROKEN OUT: if CAMS, Insurance, Taxes are separately listed with separate
       amounts, return them as separate entries with their respective bucketKeys.
    c. COMMISSION / COMMISSIONS: one-time by default → put in oneTimeCharges, NOT here.
       Exception: if the lease explicitly states commissions recur monthly, annually, or as
       ongoing additional rent, include them here.
    d. MISSING AMOUNT: if a recurring charge is mentioned by name but no dollar amount is given,
       include it here with year1 = null, confidence = 0.4–0.5, sourceKind = "narrative_obligation".
       Do NOT omit it.
    e. DEDUPLICATION: if the same charge appears in multiple sections, return ONE entry with the
       most specific evidence (prefer a section with an explicit dollar amount).
    f. UNFAMILIAR LABELS: preserve the lease-native label. Route to canonicalType = "other",
       bucketKey = null if uncertain. Do not drop it.
    g. OCR-CORRUPTED text: if a label looks like "Operatlng Expens5s", include it with the
       best-effort corrected label and note the uncertainty in evidenceText.`;

/**
 * Detect whether a PDF is likely scanned/image-based rather than digitally generated.
 * Uses a heuristic: if the first 2000 bytes of text content yield very few characters
 * relative to file size, it's likely scanned.
 *
 * @param {ArrayBuffer} buffer
 * @returns {boolean}
 */
function likelyScanned(buffer) {
  const bytes = new Uint8Array(buffer.slice(0, 4096));
  const text = String.fromCharCode(...bytes);
  // PDFs with embedded text have many printable ASCII chars; scanned ones don't.
  const printable = (text.match(/[\x20-\x7E]/g) || []).length;
  return printable / bytes.length < 0.15;
}

function hasUsableDocumentText(documentText) {
  const normalized = String(documentText ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length < 80) return false;
  const alphaCount = (normalized.match(/[a-z]/gi) || []).length;
  return alphaCount >= 40;
}

/**
 * Convert an ArrayBuffer to a base64 string.
 *
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function normalizeSearchText(value) {
  return String(value ?? '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .trim()
    .toLowerCase();
}

function pushUnique(list, value) {
  if (!Array.isArray(list) || !value) return;
  if (!list.includes(value)) list.push(value);
}

const MONTH_NAME_TO_NUMBER = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

const NAMED_DATE_CAPTURE = '(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(\\d{1,2}),\\s*(\\d{4})';
const DATE_LED_LINE = new RegExp(`^\\s*${NAMED_DATE_CAPTURE}\\s+through\\s+${NAMED_DATE_CAPTURE}\\s*[:,-]?\\s*\\$\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i');
const FROM_THROUGH_LINE = new RegExp(`\\$\\s*([\\d,]+(?:\\.\\d{1,2})?).*?\\bfrom\\s+${NAMED_DATE_CAPTURE}\\s+through\\s+${NAMED_DATE_CAPTURE}`, 'i');
const BEGINNING_AMOUNT_LINE = new RegExp(`\\bbeginning\\s+${NAMED_DATE_CAPTURE},?.*?\\$\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i');
const DATE_LED_START = new RegExp(`^\\s*${NAMED_DATE_CAPTURE}`, 'i');

function escapeRegex(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function moneyToNumber(value) {
  const amount = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

function toMDY(monthName, day, year) {
  const month = MONTH_NAME_TO_NUMBER[String(monthName ?? '').toLowerCase()];
  if (!month) return null;
  return `${month}/${String(day).padStart(2, '0')}/${year}`;
}

function formatParsedDate(date) {
  if (!date || Number.isNaN(date.getTime?.())) return null;
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
}

function parseExplicitScheduleDate(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year = year < 50 ? 2000 + year : 1900 + year;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function explicitScheduleWindowLooksLikeRate(windowText = '') {
  return /\bannual(?:ly)?\b|\bper year\b|\byearly\b|\bper\s+(?:rentable\s+|usable\s+|gross\s+|leasable\s+)?square\s+f(?:oo)?t\b|\b(?:rsf|usf|psf)\b|\/\s*sf\b|\/\s*rsf\b|\/\s*usf\b|\bpercent\b|%|\bescalat(?:e|ed|ion|es)\b|\bincrease(?:s|d)?\b/i.test(windowText);
}

function extractExplicitNumericRangeCandidate(primaryLine = '', continuationLine = '') {
  const prefixMatch = primaryLine.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:-|–|—|to|through)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  if (!prefixMatch) return null;

  const sameLineTail = primaryLine.slice(prefixMatch.index + prefixMatch[0].length);
  const continuationTail = continuationLine ? ` ${continuationLine.trim()}` : '';
  const candidateTail = `${sameLineTail}${continuationTail}`;
  if (explicitScheduleWindowLooksLikeRate(candidateTail)) return null;

  const amountMatch = candidateTail.match(/^[\s\t|:;-]{0,40}(?:monthly|per month)?[\s\t|:;-]{0,16}\$?\s*([\d,]+(?:\.\d{1,2})?)(?!\s*%)/i);
  if (!amountMatch) return null;

  const startDate = parseExplicitScheduleDate(prefixMatch[1]);
  const endDate = parseExplicitScheduleDate(prefixMatch[2]);
  const monthlyRent = moneyToNumber(amountMatch[1]);
  if (!startDate || !endDate || monthlyRent == null || monthlyRent < 100) return null;

  return {
    periodStart: formatParsedDate(startDate),
    periodEnd: formatParsedDate(endDate),
    monthlyRent,
  };
}

function detectExplicitDatedRentSchedule(documentText = '') {
  const lines = String(documentText ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows = [];
  const seen = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const row = extractExplicitNumericRangeCandidate(lines[index], lines[index + 1] ?? '');
    if (!row) continue;

    const key = `${row.periodStart}:${row.periodEnd}:${row.monthlyRent.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }

  return rows.sort((left, right) => {
    const leftTime = parseExplicitScheduleDate(left.periodStart)?.getTime() ?? 0;
    const rightTime = parseExplicitScheduleDate(right.periodStart)?.getTime() ?? 0;
    return leftTime - rightTime;
  });
}

function normalizeOCRScheduleRow(row = {}) {
  const normalized = { ...row };
  const combinedRange = String(row?.periodStart ?? '').trim().match(
    /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:-|–|—|to|through)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})$/i,
  );

  if (combinedRange) {
    const startDate = parseExplicitScheduleDate(combinedRange[1]);
    const endDate = parseExplicitScheduleDate(combinedRange[2]);
    if (startDate) normalized.periodStart = formatParsedDate(startDate);
    if (endDate) normalized.periodEnd = formatParsedDate(endDate);
    return normalized;
  }

  const startDate = parseExplicitScheduleDate(row?.periodStart);
  const endDate = parseExplicitScheduleDate(row?.periodEnd);
  if (startDate) normalized.periodStart = formatParsedDate(startDate);
  if (endDate) normalized.periodEnd = formatParsedDate(endDate);
  return normalized;
}

function mdyToTimestamp(value) {
  const match = String(value ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return Number.NaN;
  return new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2])).getTime();
}

function buildRecurringChargeSearchTerms(charge) {
  const terms = new Set();
  const label = normalizeSearchText(charge?.label);
  if (label) terms.add(label);

  switch (charge?.bucketKey) {
    case 'cams':
      terms.add('common area maintenance');
      terms.add('cams');
      terms.add('cam');
      terms.add('operating expenses');
      terms.add('operating expense');
      break;
    case 'insurance':
      terms.add('insurance');
      terms.add('property insurance');
      break;
    case 'taxes':
      terms.add('real estate taxes');
      terms.add('property taxes');
      terms.add('taxes');
      break;
    case 'security':
      terms.add('security');
      terms.add('security services');
      terms.add('security patrol');
      terms.add('security monitoring');
      break;
    default:
      break;
  }

  return Array.from(terms).filter(Boolean);
}

function lineMentionsRecurringCharge(line, searchTerms) {
  const normalizedLine = normalizeSearchText(line);
  return searchTerms.some((term) => normalizedLine.includes(term));
}

function parseRecurringChargeStepLine(line) {
  if (!line) return null;

  let match = line.match(DATE_LED_LINE);
  if (match) {
    return {
      startDate: toMDY(match[1], match[2], match[3]),
      amount: moneyToNumber(match[7]),
      evidenceText: line.trim(),
    };
  }

  match = line.match(FROM_THROUGH_LINE);
  if (match) {
    return {
      startDate: toMDY(match[2], match[3], match[4]),
      amount: moneyToNumber(match[1]),
      evidenceText: line.trim(),
    };
  }

  match = line.match(BEGINNING_AMOUNT_LINE);
  if (match) {
    return {
      startDate: toMDY(match[1], match[2], match[3]),
      amount: moneyToNumber(match[4]),
      evidenceText: line.trim(),
    };
  }

  return null;
}

function extractRecurringChargeSteps(documentText, charge) {
  const lines = String(documentText ?? '')
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const searchTerms = buildRecurringChargeSearchTerms(charge);
  const steps = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const mentionsCharge = lineMentionsRecurringCharge(line, searchTerms);
    if (!mentionsCharge) continue;

    const parsedInline = parseRecurringChargeStepLine(line);
    if (parsedInline?.startDate && parsedInline?.amount != null) {
      steps.push(parsedInline);
    }

    // Block-style schedules often use a charge heading followed by dated amount rows.
    if (/:\s*$/.test(line) || (!/\$\s*[\d,]/.test(line) && !parsedInline)) {
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j += 1) {
        const candidate = lines[j];
        const parsedCandidate = parseRecurringChargeStepLine(candidate);
        if (parsedCandidate?.startDate && parsedCandidate?.amount != null) {
          steps.push(parsedCandidate);
          continue;
        }

        if (/:\s*$/.test(candidate) || (!DATE_LED_START.test(candidate) && !lineMentionsRecurringCharge(candidate, searchTerms))) {
          break;
        }
      }
    }
  }

  const deduped = [];
  const seen = new Set();

  for (const step of steps) {
    if (!step?.startDate || step.amount == null) continue;
    const key = `${step.startDate}:${step.amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(step);
  }

  deduped.sort((a, b) => mdyToTimestamp(a.startDate) - mdyToTimestamp(b.startDate));

  const collapsed = [];
  for (const step of deduped) {
    if (collapsed.length === 0 || collapsed[collapsed.length - 1].amount !== step.amount) {
      collapsed.push(step);
    }
  }

  return collapsed;
}

export function detectRecurringChargeIrregularities(documentText, recurringCharges = []) {
  return (Array.isArray(recurringCharges) ? recurringCharges : [])
    .map((charge) => {
      const steps = extractRecurringChargeSteps(documentText, charge);
      if (steps.length < 2) return null;

      return {
        label: charge?.label ?? '',
        bucketKey: charge?.bucketKey ?? null,
        firstStep: steps[0],
        overrideHints: steps.slice(1).map((step, index) => ({
          id: `ocr_recurring_override_${normalizeSearchText(charge?.label || charge?.bucketKey || 'charge').replace(/[^a-z0-9]+/g, '_')}_${index + 1}`,
          bucketKey: charge?.bucketKey ?? null,
          label: charge?.label ?? '',
          date: step.startDate,
          amount: step.amount,
          source: 'ocr',
          confidence: Number(charge?.confidence) >= 0.8 ? 'high' : 'medium',
          assumptionNote: 'Generated from an OCR-detected non-annual recurring charge step. Review the date and amount before processing.',
          rawText: step.evidenceText,
        })),
      };
    })
    .filter(Boolean);
}

function parseCadenceMonths(rawValue, rawUnit) {
  const normalizedUnit = String(rawUnit ?? '').toLowerCase();
  const normalizedValue = String(rawValue ?? '').trim().toLowerCase();
  const wordToNumber = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };

  const numericValue = Number(normalizedValue);
  const value = Number.isFinite(numericValue) && numericValue > 0
    ? numericValue
    : (wordToNumber[normalizedValue] ?? 1);

  if (normalizedUnit.startsWith('year')) return value * 12;
  if (normalizedUnit.startsWith('month')) return value;
  return 12;
}

function inferRecurringChargeRoute(labelText) {
  const normalized = normalizeSearchText(labelText);
  if (/\b(insurance|hazard insurance|property insurance)\b/.test(normalized)) {
    return { canonicalType: 'nnn', bucketKey: 'insurance', label: 'Insurance' };
  }
  if (/\b(real estate tax|property tax|taxes)\b/.test(normalized)) {
    return { canonicalType: 'nnn', bucketKey: 'taxes', label: 'Taxes' };
  }
  if (/\b(cam|cams|common area maintenance|operating expense|operating expenses|triple net|nnn)\b/.test(normalized)) {
    return { canonicalType: 'nnn', bucketKey: 'cams', label: /\bnnn\b/.test(normalized) ? 'NNN' : 'Operating Expenses' };
  }
  return { canonicalType: 'other', bucketKey: null, label: labelText || 'Recurring Charge' };
}

export function detectNarrativeRecurringCharges(documentText = '') {
  const lines = String(documentText ?? '')
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const charges = [];
  const seen = new Set();
  const leadingEscPattern = /\b(?<label>nnn|cam(?:s)?|common area maintenance|operating expenses?|insurance|property insurance|real estate taxes?|taxes|additional rent)\b[\s,:-]*(?:escalat(?:e|ed|es)?[\s,:-]*)?(?:(?<esc>\d+(?:\.\d+)?)%\s*(?:every|per)\s*(?<cadenceValue>\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(?<cadenceUnit>year|years|month|months))?[\s,;-]*(?:amt|amount|monthly|per month|month|at)?[\s:$-]*(?<amount>\d[\d,]*(?:\.\d{1,2})?)/i;
  const trailingEscPattern = /\b(?<label>nnn|cam(?:s)?|common area maintenance|operating expenses?|insurance|property insurance|real estate taxes?|taxes|additional rent)\b[\s,:-]*(?:amount|amt)?[\s:$-]*(?<amount>\d[\d,]*(?:\.\d{1,2})?)[\s,;-]*(?:per|\/)?\s*(?:month|monthly)?[\s,;-]*(?:escalat(?:e|ed|es)?|increase(?:s|d)?)?[\s,:-]*(?<esc>\d+(?:\.\d+)?)%\s*(?:every|per)\s*(?<cadenceValue>\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(?<cadenceUnit>year|years|month|months)/i;

  for (const line of lines) {
    const match = line.match(leadingEscPattern) ?? line.match(trailingEscPattern);
    if (!match?.groups?.amount) continue;

    const route = inferRecurringChargeRoute(match.groups.label);
    const year1 = moneyToNumber(match.groups.amount);
    if (year1 == null) continue;

    const escPct = match.groups.esc ? Number(match.groups.esc) : null;
    const cadenceMonths = match.groups.esc
      ? parseCadenceMonths(match.groups.cadenceValue, match.groups.cadenceUnit)
      : null;
    const key = `${route.bucketKey ?? route.label}:${year1}:${escPct ?? ''}:${cadenceMonths ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    charges.push({
      label: route.label,
      bucketKey: route.bucketKey,
      canonicalType: route.canonicalType,
      year1,
      amountBasis: 'monthly',
      escPct,
      chargeStart: null,
      escStart: null,
      confidence: 0.72,
      evidenceText: line,
      sourceKind: 'narrative_obligation',
      cadenceMonths,
    });
  }

  return charges;
}

export function repairNarrativeRecurringChargeSemantics(result, documentText) {
  const repaired = {
    ...result,
    notices: Array.isArray(result?.notices) ? [...result.notices] : [],
    recurringCharges: Array.isArray(result?.recurringCharges)
      ? result.recurringCharges.map((charge) => ({ ...charge }))
      : [],
  };

  const narrativeCharges = detectNarrativeRecurringCharges(documentText);
  if (narrativeCharges.length === 0) return repaired;

  for (const narrativeCharge of narrativeCharges) {
    const existing = repaired.recurringCharges.find((charge) => {
      const sameBucket = charge?.bucketKey && narrativeCharge.bucketKey && charge.bucketKey === narrativeCharge.bucketKey;
      const sameLabel = normalizeSearchText(charge?.label) === normalizeSearchText(narrativeCharge.label);
      return sameBucket || sameLabel;
    });

    if (existing) {
      if (existing.year1 == null) existing.year1 = narrativeCharge.year1;
      if (existing.escPct == null && narrativeCharge.escPct != null) existing.escPct = narrativeCharge.escPct;
      if (!existing.evidenceText) existing.evidenceText = narrativeCharge.evidenceText;
      if (existing.confidence == null || existing.confidence < narrativeCharge.confidence) {
        existing.confidence = narrativeCharge.confidence;
      }
      continue;
    }

    repaired.recurringCharges.push(narrativeCharge);
  }

  pushUnique(
    repaired.notices,
    `${narrativeCharges.length} recurring charge narrative rule${narrativeCharges.length === 1 ? '' : 's'} were inferred from unstructured text. Review the extracted charge labels, amounts, and escalation cadence before processing.`,
  );

  return repaired;
}

export function documentIndicatesSfBasedRent(documentText) {
  const normalized = normalizeSearchText(documentText);
  if (!normalized) return false;

  const lines = normalized
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const windows = [];
  for (let i = 0; i < lines.length; i += 1) {
    windows.push(lines[i]);
    if (i < lines.length - 1) windows.push(`${lines[i]} ${lines[i + 1]}`);
    if (i < lines.length - 2) windows.push(`${lines[i]} ${lines[i + 1]} ${lines[i + 2]}`);
  }

  const baseRentPattern = /\b(base rent|minimum rent|annual base rent|monthly base rent)\b/;
  const sfUnitPattern = /\b(?:rentable|usable|gross|leasable)?\s*(?:square foot|square feet|sq\.?\s*ft\.?|sf|rsf|usf)\b/;
  const ratePattern = /\$\s*\d[\d,]*(?:\.\d+)?\s*(?:\/|\bper\b)\s*(?:rentable|usable|gross|leasable)?\s*(?:square foot|square feet|sq\.?\s*ft\.?|sf|rsf|usf)\b/;
  const timePattern = /\b(?:(?:per|\/)\s*(?:year|yr|annum|month|mo)|annual(?:ly)?|monthly)\b/;

  return windows.some((windowText) =>
    baseRentPattern.test(windowText) &&
    sfUnitPattern.test(windowText) &&
    (ratePattern.test(windowText) || timePattern.test(windowText)),
  );
}

export function repairSfBasedRentSemantics(result, documentText) {
  const repaired = {
    ...result,
    confidenceFlags: Array.isArray(result?.confidenceFlags) ? [...result.confidenceFlags] : [],
    notices: Array.isArray(result?.notices) ? [...result.notices] : [],
  };

  if (!documentIndicatesSfBasedRent(documentText)) {
    return repaired;
  }

  repaired.sfRequired = true;

  const squareFootage = Number(repaired.squareFootage);
  if (!Number.isFinite(squareFootage) || squareFootage <= 0) {
    pushUnique(repaired.confidenceFlags, 'squareFootage');
  }

  return repaired;
}

export function repairRecurringChargeOverrideSemantics(result, documentText) {
  const repaired = {
    ...result,
    notices: Array.isArray(result?.notices) ? [...result.notices] : [],
    recurringCharges: Array.isArray(result?.recurringCharges)
      ? result.recurringCharges.map((charge) => ({ ...charge }))
      : [],
    recurringOverrideHints: Array.isArray(result?.recurringOverrideHints)
      ? result.recurringOverrideHints.map((hint) => ({ ...hint }))
      : [],
  };

  const irregularities = detectRecurringChargeIrregularities(documentText, repaired.recurringCharges);
  if (irregularities.length === 0) {
    return repaired;
  }

  const overrideHints = irregularities.flatMap((entry) => entry.overrideHints);
  const irregularKeys = new Set(
    irregularities.map((entry) => `${entry.bucketKey ?? ''}::${normalizeSearchText(entry.label)}`),
  );

  repaired.recurringCharges = repaired.recurringCharges.map((charge) => {
    const irregularKey = `${charge?.bucketKey ?? ''}::${normalizeSearchText(charge?.label)}`;
    if (!irregularKeys.has(irregularKey)) return charge;

    const irregularity = irregularities.find((entry) =>
      entry.bucketKey === charge?.bucketKey && normalizeSearchText(entry.label) === normalizeSearchText(charge?.label),
    );
    if (!irregularity) return charge;

    return {
      ...charge,
      year1: irregularity.firstStep.amount,
      chargeStart: charge?.chargeStart ?? irregularity.firstStep.startDate,
      escPct: null,
      escStart: null,
    };
  });

  const seenOverrideKeys = new Set(
    repaired.recurringOverrideHints.map((hint) => `${hint.bucketKey ?? ''}:${hint.label ?? ''}:${hint.date}:${hint.amount}`),
  );
  for (const hint of overrideHints) {
    const key = `${hint.bucketKey ?? ''}:${hint.label ?? ''}:${hint.date}:${hint.amount}`;
    if (seenOverrideKeys.has(key)) continue;
    seenOverrideKeys.add(key);
    repaired.recurringOverrideHints.push(hint);
  }

  repaired.notices.push(
    `${overrideHints.length} irregular recurring charge step${overrideHints.length === 1 ? '' : 's'} were converted from OCR into dated recurring overrides for review.`,
  );

  return repaired;
}

export function repairExtractionSemantics(result, documentText) {
  return repairScheduleSemantics(
    repairRecurringChargeOverrideSemantics(
      repairNarrativeRecurringChargeSemantics(
        repairSfBasedRentSemantics(result, documentText),
        documentText,
      ),
      documentText,
    ),
    documentText,
  );
}

export function repairScheduleSemantics(result, documentText) {
  const repaired = {
    ...result,
    confidenceFlags: Array.isArray(result?.confidenceFlags) ? [...result.confidenceFlags] : [],
    notices: Array.isArray(result?.notices) ? [...result.notices] : [],
    rentSchedule: Array.isArray(result?.rentSchedule)
      ? result.rentSchedule.map((row) => normalizeOCRScheduleRow(row))
      : [],
  };

  if (repaired.rentSchedule.length === 0) {
    const recoveredExplicitSchedule = detectExplicitDatedRentSchedule(documentText);
    if (recoveredExplicitSchedule.length > 0) {
      repaired.rentSchedule = recoveredExplicitSchedule;
      pushUnique(
        repaired.notices,
        'Base-rent schedule was recovered directly from explicit dated rent rows in lease text after OCR omitted the structured schedule.',
      );
    }
  }

  if (repaired.rentSchedule.length > 0) {
    const parseableCount = repaired.rentSchedule.filter(
      (row) => parseExplicitScheduleDate(row.periodStart) || parseExplicitScheduleDate(row.periodEnd),
    ).length;
    if (parseableCount === 0) {
      const recoveredExplicitSchedule = detectExplicitDatedRentSchedule(documentText);
      if (recoveredExplicitSchedule.length > 0) {
        repaired.rentSchedule = recoveredExplicitSchedule;
        pushUnique(
          repaired.notices,
          'OCR rent schedule dates could not be parsed; base-rent schedule was recovered directly from explicit dated rent rows in lease text.',
        );
      }
    }
  }

  const scheduleNormalization = analyzeScheduleSemantics({
    documentText,
    existingRentSchedule: repaired.rentSchedule,
    extractedEventDates: {
      rent_commencement_date: repaired.rentCommencementDate,
    },
  });

  const usedSemanticSchedule = repaired.rentSchedule.length === 0 && scheduleNormalization.derivedRentSchedule.length > 0;
  repaired.scheduleNormalization = {
    ...scheduleNormalization,
    usedAsRentSchedule: usedSemanticSchedule,
  };
  repaired.scheduleStartRules = scheduleNormalization.startRules;
  repaired.scheduleCandidates = scheduleNormalization.candidates;

  const preferredAnchorDate = scheduleNormalization.preferredAnchorDate
    ?? scheduleNormalization.resolvedEventDates?.rent_commencement_date
    ?? null;
  if (!repaired.rentCommencementDate && preferredAnchorDate) {
    repaired.rentCommencementDate = preferredAnchorDate;
  }

  if (usedSemanticSchedule) {
    repaired.rentSchedule = scheduleNormalization.derivedRentSchedule;
    pushUnique(
      repaired.notices,
      'Base-rent schedule was materialized from detected semantic schedule language. Review the anchor date and derived periods before confirming.',
    );
  } else if (
    repaired.rentSchedule.length === 0 &&
    scheduleNormalization.materializationStatus === 'needs_anchor' &&
    scheduleNormalization.summaryLines.length > 0
  ) {
    pushUnique(
      repaired.notices,
      scheduleNormalization.userGuidance
        ?? 'A semantic rent schedule was detected, but an anchor date is still needed before dated periods can be derived.',
    );
  }

  return repaired;
}

export async function extractPdfPlainText(buffer) {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    const loadingTask = pdfjsLib.getDocument({ data: buffer });
    const pdf = await loadingTask.promise;
    const lines = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const itemsByY = new Map();

      for (const item of textContent.items) {
        const y = Math.round(item.transform[5]);
        if (!itemsByY.has(y)) itemsByY.set(y, []);
        itemsByY.get(y).push(item);
      }

      const sortedYs = Array.from(itemsByY.keys()).sort((a, b) => b - a);
      for (const y of sortedYs) {
        const lineItems = itemsByY.get(y).sort((a, b) => a.transform[4] - b.transform[4]);
        const lineText = lineItems.map((item) => item.str.trim()).filter(Boolean).join(' ');
        if (lineText) lines.push(lineText);
      }
    }

    return lines.join('\n');
  } catch {
    return '';
  }
}

/**
 * Extract lease parameters from a PDF using the configured OCR provider.
 * Implements Path A (Section 1) of the application spec.
 *
 * @param {ArrayBuffer} pdfBuffer    - Raw PDF bytes from the browser File API.
 * @returns {Promise<{ result: ExtractionResult, isLikelyScanned: boolean }>}
 * @throws {Error} On network failure or non-200 API response.
 */
/**
 * Empty extraction result used as fallback when OCR fails.
 * Ensures downstream code always receives a well-shaped object.
 */
function emptyExtractionResult(notices = []) {
  return {
    rentSchedule: [],
    leaseName: null,
    squareFootage: null,
    freeRentEvents: [],
    abatementEvents: [],
    abatementEndDate: null,
    abatementPct: null,
    cams: { year1: null, escPct: null, chargeStart: null, escStart: null },
    insurance: { year1: null, escPct: null, chargeStart: null, escStart: null },
    taxes: { year1: null, escPct: null, chargeStart: null, escStart: null },
    security: { year1: null, escPct: null, chargeStart: null, escStart: null },
    otherItems: { year1: null, escPct: null, chargeStart: null, escStart: null },
    securityDeposit: null,
    securityDepositDate: null,
    estimatedNNNMonthly: null,
    confidenceFlags: [],
    notices,
    sfRequired: false,
    overallConfidence: 'low',
    recurringCharges: [],
    rentCommencementDate: null,
    scheduleNormalization: null,
  };
}

function buildTextExtractionPrompt(documentText, sourceLabel = 'document text') {
  const normalizedText = String(documentText ?? '').trim().slice(0, 120000);
  return `${EXTRACTION_PROMPT}

SOURCE TYPE: ${sourceLabel}
DOCUMENT TEXT:
${normalizedText}`;
}

function normalizeOneTimeItem(item) {
  if (!item || typeof item !== 'object') return null;

  const label = String(item.label ?? item.name ?? '').trim();
  if (!label) return null;

  const amount = item.amount != null ? Number(item.amount) : null;
  const resolvedSign = item.sign === -1 ? -1 : item.sign === 1 ? 1 : (Number.isFinite(amount) && amount < 0 ? -1 : 1);
  return {
    label,
    amount: Number.isFinite(amount) ? amount : null,
    dueDate: item.dueDate ?? item.date ?? null,
    sign: resolvedSign,
    notes: item.notes ?? null,
  };
}

function normalizeOneTimeItems(result) {
  const canonical = Array.isArray(result?.oneTimeItems) ? result.oneTimeItems : [];
  if (canonical.length > 0) {
    return canonical.map(normalizeOneTimeItem).filter(Boolean);
  }

  const legacy = Array.isArray(result?.oneTimeCharges) ? result.oneTimeCharges : [];
  return legacy.map(normalizeOneTimeItem).filter(Boolean);
}

function normalizeExtractionResult(result, documentText, notices = []) {
  const normalized = {
    ...emptyExtractionResult(),
    ...(result ?? {}),
  };

  normalized.confidenceFlags = normalized.confidenceFlags ?? [];
  normalized.notices = [...notices, ...(normalized.notices ?? [])];
  normalized.rentSchedule = normalized.rentSchedule ?? [];
  normalized.rentCommencementDate = normalized.rentCommencementDate ?? null;
  normalized.freeRentEvents = Array.isArray(normalized.freeRentEvents) ? normalized.freeRentEvents : [];
  normalized.abatementEvents = Array.isArray(normalized.abatementEvents) ? normalized.abatementEvents : [];
  normalized.recurringCharges = Array.isArray(normalized.recurringCharges) ? normalized.recurringCharges : [];
  normalized.oneTimeItems = normalizeOneTimeItems(normalized);

  const repaired = repairExtractionSemantics(normalized, documentText);
  const flagCount = repaired.confidenceFlags.length;
  repaired.overallConfidence = flagCount === 0 ? 'high' : flagCount <= 3 ? 'medium' : 'low';
  return repaired;
}

function parseExtractionPayload(rawText, fallbackNotice, documentText, notices = []) {
  try {
    const cleaned = String(rawText ?? '')
      .replace(/^```json\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    return normalizeExtractionResult(parsed, documentText, notices);
  } catch {
    return normalizeExtractionResult(
      emptyExtractionResult([fallbackNotice]),
      documentText,
      notices,
    );
  }
}

function hasMeaningfulExtraction(result) {
  return Boolean(
    result?.rentSchedule?.length ||
    result?.scheduleNormalization?.candidates?.length ||
    result?.recurringCharges?.length ||
    result?.freeRentEvents?.length ||
    result?.abatementEvents?.length ||
    result?.leaseName ||
    result?.squareFootage != null,
  );
}

function hasUsableDatedRentSchedule(rentSchedule = []) {
  if (!Array.isArray(rentSchedule)) return false;

  return rentSchedule.some((row) => {
    const periodStart = parseExplicitScheduleDate(row?.periodStart);
    const periodEnd = parseExplicitScheduleDate(row?.periodEnd);
    const monthlyRent = Number(row?.monthlyRent);
    return Boolean(periodStart && periodEnd && Number.isFinite(monthlyRent) && monthlyRent >= 0);
  });
}

export function shouldUseTextFirstScheduleResult(result) {
  return Boolean(
    hasUsableDatedRentSchedule(result?.rentSchedule) ||
    result?.scheduleNormalization?.derivedRentSchedule?.length
  );
}

async function extractTextPayload(prompt) {
  if (OCR_PROVIDER === 'openai') {
    return { rawText: await extractPromptFromOpenAI(prompt), providerUsed: 'openai', fallbackReason: null };
  }

  try {
    return { rawText: await extractPromptFromAnthropic(prompt), providerUsed: 'anthropic', fallbackReason: null };
  } catch (anthropicError) {
    if (!hasConfiguredOpenAIKey()) {
      throw anthropicError;
    }

    return {
      rawText: await extractPromptFromOpenAI(prompt),
      providerUsed: 'openai',
      fallbackReason: 'Anthropic failed, so the app switched providers automatically.',
    };
  }
}

export async function extractFromDocumentText(documentText, sourceLabel = 'document text') {
  if (!hasUsableDocumentText(documentText)) {
    return {
      result: normalizeExtractionResult(
        emptyExtractionResult(['The uploaded file did not contain enough readable text to extract assumptions automatically.']),
        documentText,
      ),
      providerUsed: null,
    };
  }

  const prompt = buildTextExtractionPrompt(documentText, sourceLabel);
  const { rawText, providerUsed, fallbackReason } = await extractTextPayload(prompt);
  const result = parseExtractionPayload(
    rawText,
    'The text extraction response could not be parsed. Review the schedule and assumptions manually.',
    documentText,
    fallbackReason ? [`OCR fallback used: ${providerUsed}. ${fallbackReason}`] : [],
  );

  return { result, providerUsed };
}

export async function extractFromUploadedDocument(file) {
  const { ext, buffer, text } = await extractDocumentTextFromFile(file);

  if (ext === 'pdf') {
    const extracted = await extractFromPDF(buffer);
    return {
      ...extracted,
      documentText: extracted.documentText ?? text ?? '',
      inputKind: 'pdf',
    };
  }

  const { result, providerUsed } = await extractFromDocumentText(text, `${ext.toUpperCase()} text`);
  if (providerUsed) {
    result.notices.unshift(`${ext.toUpperCase()} upload routed through text-first extraction.`);
  }

  return {
    result,
    isLikelyScanned: false,
    documentText: text,
    inputKind: ext,
  };
}

export async function extractFromPDF(pdfBuffer) {
  const scanned = likelyScanned(pdfBuffer);
  const pdfBufferForText = pdfBuffer.slice(0);
  const pdfBufferForOCR = pdfBuffer.slice(0);
  const documentText = await extractPdfPlainText(pdfBufferForText);
  let textFirstWasInsufficient = false;

  if (!scanned && hasUsableDocumentText(documentText)) {
    try {
      const { result } = await extractFromDocumentText(documentText, 'native PDF text');
      result.notices.unshift('Native-text PDF routed through text-first extraction. OCR document vision was not required.');
      if (shouldUseTextFirstScheduleResult(result)) {
        return { result, isLikelyScanned: false, documentText };
      }
      textFirstWasInsufficient = true;
    } catch {
      // Fall through to OCR document extraction if text-first extraction fails.
    }
  }

  let rawText;
  let providerUsed;
  let fallbackReason;

  try {
    const base64PDF = bufferToBase64(pdfBufferForOCR);
    const ocrResult = await extractOCRText(base64PDF);
    rawText = ocrResult.rawText;
    providerUsed = ocrResult.providerUsed;
    fallbackReason = ocrResult.fallbackReason;
  } catch (ocrError) {
    // OCR completely failed — return empty result with notice instead of throwing
    return {
      result: normalizeExtractionResult(
        emptyExtractionResult([
          `OCR extraction failed: ${ocrError.message}. You can still proceed by entering the rent schedule manually.`,
        ]),
        documentText,
      ),
      isLikelyScanned: scanned,
      documentText,
    };
  }

  const notices = [];
  if (textFirstWasInsufficient) {
    notices.push('Native-text extraction did not yield a usable dated rent schedule; document vision OCR was run instead.');
  }
  if (fallbackReason) {
    notices.push(`OCR fallback used: ${providerUsed}. ${fallbackReason}`);
  }
  if (scanned) {
    notices.push(
      'This PDF appears to be scanned or image-based. Extraction reliability is reduced. Review all fields carefully before confirming.',
    );
  }

  const parsedResult = parseExtractionPayload(
    rawText,
    'OCR provider returned a response that could not be parsed. You can still proceed by entering the rent schedule manually.',
    documentText,
    notices,
  );

  if (scanned) {
    parsedResult.overallConfidence = 'low';
  }

  return { result: parsedResult, isLikelyScanned: scanned, documentText };

  let result;
  try {
    // Strip any accidental markdown fences
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    result = JSON.parse(cleaned);
  } catch {
    // JSON parse failed — return empty result with notice instead of throwing
    return {
      result: emptyExtractionResult([
        'OCR provider returned a response that could not be parsed. ' +
        'You can still proceed by entering the rent schedule manually.',
      ]),
      isLikelyScanned: scanned,
    };
  }

  // Ensure required arrays/objects exist
  result.confidenceFlags  = result.confidenceFlags  ?? [];
  result.notices          = result.notices          ?? [];
  result.rentSchedule     = result.rentSchedule     ?? [];
  result.rentCommencementDate = result.rentCommencementDate ?? null;
  result.freeRentEvents   = Array.isArray(result.freeRentEvents) ? result.freeRentEvents : [];
  result.abatementEvents  = Array.isArray(result.abatementEvents) ? result.abatementEvents : [];
  result.recurringCharges = Array.isArray(result.recurringCharges) ? result.recurringCharges : [];
  result = repairExtractionSemantics(result, documentText);

  if (fallbackReason) {
    result.notices.unshift(`OCR fallback used: ${providerUsed}. ${fallbackReason}`);
  }

  // Determine overall confidence
  const flagCount = result.confidenceFlags.length;
  result.overallConfidence = flagCount === 0 ? 'high' : flagCount <= 3 ? 'medium' : 'low';

  if (scanned) {
    result.notices.unshift(
      'This PDF appears to be scanned or image-based. Extraction reliability is reduced. ' +
      'Review all fields carefully before confirming.'
    );
    result.overallConfidence = 'low';
  }

  return { result, isLikelyScanned: scanned };
}

async function extractOCRText(base64PDF) {
  if (OCR_PROVIDER === 'openai') {
    return { rawText: await extractFromOpenAI(base64PDF), providerUsed: 'openai', fallbackReason: null };
  }

  try {
    return { rawText: await extractFromAnthropic(base64PDF), providerUsed: 'anthropic', fallbackReason: null };
  } catch (anthropicError) {
    if (!hasConfiguredOpenAIKey()) {
      throw anthropicError;
    }

    try {
      return {
        rawText: await extractFromOpenAI(base64PDF),
        providerUsed: 'openai',
        fallbackReason: 'Anthropic failed, so the app switched providers automatically.',
      };
    } catch (openaiError) {
      throw new Error(
        `Anthropic failed and OpenAI fallback also failed.\n\nAnthropic: ${anthropicError.message}\n\nOpenAI: ${openaiError.message}`
      );
    }
  }
}

async function extractFromAnthropic(base64PDF) {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') {
    throw new Error('VITE_ANTHROPIC_API_KEY is not configured. Set it in the .env file.');
  }

  const requestBody = {
    model: ANTHROPIC_MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64PDF,
            },
          },
          {
            type: 'text',
            text: EXTRACTION_PROMPT,
          },
        ],
      },
    ],
  };

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text ?? '';
}

async function extractPromptFromAnthropic(prompt) {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') {
    throw new Error('VITE_ANTHROPIC_API_KEY is not configured. Set it in the .env file.');
  }

  const requestBody = {
    model: ANTHROPIC_MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
  };

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text ?? '';
}

async function extractFromOpenAI(base64PDF) {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') {
    throw new Error('VITE_OPENAI_API_KEY is not configured. Set it in the .env file.');
  }

  const requestBody = {
    model: OPENAI_MODEL,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_file',
            filename: 'lease.pdf',
            file_data: `data:application/pdf;base64,${base64PDF}`,
          },
          {
            type: 'input_text',
            text: EXTRACTION_PROMPT,
          },
        ],
      },
    ],
  };

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return extractOutputText(data);
}

async function extractPromptFromOpenAI(prompt) {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') {
    throw new Error('VITE_OPENAI_API_KEY is not configured. Set it in the .env file.');
  }

  const requestBody = {
    model: OPENAI_MODEL,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: prompt,
          },
        ],
      },
    ],
  };

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return extractOutputText(data);
}

function extractOutputText(data) {
  if (!data || typeof data !== 'object') return '';

  if (typeof data.output_text === 'string') return data.output_text;

  const outputs = Array.isArray(data.output) ? data.output : [];
  const chunks = [];

  for (const item of outputs) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        chunks.push(part.text);
      }
    }
  }

  return chunks.join('');
}

function hasConfiguredOpenAIKey() {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  return Boolean(apiKey && apiKey !== 'your_api_key_here');
}
