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

import { parseLeaseDate } from '../engine/yearMonth.js';
import { analyzeScheduleSemantics } from '../engine/scheduleSemantics.js';
import { parseBulkPasteText, inferEndDates, toCanonicalPeriodRows } from '../engine/periodParser.js';
import { extractDocumentTextFromFile } from './documentText.js';
import { applyCanonicalOneTimeItems, mergeOneTimeItemCollections, normalizeOneTimeItem } from './oneTimeItems.js';

const OCR_PROVIDER = (import.meta.env?.VITE_OCR_PROVIDER || 'anthropic').toLowerCase();

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-opus-4-6';

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const OPENAI_MODEL = import.meta.env?.VITE_OPENAI_OCR_MODEL || 'gpt-4o';

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
    .replace(/[\u2012\u2013\u2014\u2212]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .trim()
    .toLowerCase();
}

function pushUnique(list, value) {
  if (!Array.isArray(list) || !value) return;
  if (!list.includes(value)) list.push(value);
}

function removeValue(list, value) {
  if (!Array.isArray(list) || !value) return;
  const index = list.indexOf(value);
  if (index >= 0) list.splice(index, 1);
}

const WORD_NUMBER_MAP = {
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
  eleven: 11,
  twelve: 12,
};

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

function countToNumber(primaryValue, parentheticalValue = null) {
  const parenthetical = Number(parentheticalValue);
  if (Number.isInteger(parenthetical) && parenthetical > 0) return parenthetical;

  const numericValue = Number(primaryValue);
  if (Number.isInteger(numericValue) && numericValue > 0) return numericValue;

  return WORD_NUMBER_MAP[String(primaryValue ?? '').trim().toLowerCase()] ?? null;
}

function toMDY(monthName, day, year) {
  const month = MONTH_NAME_TO_NUMBER[String(monthName ?? '').toLowerCase()];
  if (!month) return null;
  return `${month}/${String(day).padStart(2, '0')}/${year}`;
}

function mdyToTimestamp(value) {
  const match = String(value ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return Number.NaN;
  return new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2])).getTime();
}

function splitDocumentLines(documentText = '') {
  return String(documentText ?? '')
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildDocumentWindows(documentText = '', maxLines = 3) {
  const lines = splitDocumentLines(documentText);
  const windows = [];

  for (let i = 0; i < lines.length; i += 1) {
    for (let span = 1; span <= maxLines && i + span <= lines.length; span += 1) {
      windows.push(lines.slice(i, i + span).join(' '));
    }
  }

  return windows;
}

function splitEconomicClauses(documentText = '') {
  return String(documentText ?? '')
    .split(/(?:\r?\n+|(?<=[.;])\s+)/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function ensureOneTimeChargeCollections(result) {
  const merged = mergeOneTimeItemCollections(result);
  return {
    oneTimeItems: merged,
    oneTimeCharges: merged,
  };
}

function hasMatchingOneTimeCharge(charges, targetCharge) {
  const normalizedTarget = normalizeOneTimeItem(targetCharge, { source: 'deterministic' });
  if (!normalizedTarget) return false;

  return (charges ?? []).some((charge) =>
    normalizeSearchText(charge?.label) === normalizeSearchText(normalizedTarget.label)
    && Number(charge?.amount ?? 0).toFixed(2) === Number(normalizedTarget.amount ?? 0).toFixed(2)
    && Number(charge?.sign ?? 1) === Number(normalizedTarget.sign ?? 1)
    && normalizeSearchText(charge?.dueDate) === normalizeSearchText(normalizedTarget.dueDate),
  );
}

function hasOneTimeChargeByLabel(charges, targetLabel) {
  const normalizedTarget = normalizeSearchText(targetLabel);
  return (charges ?? []).some((charge) => normalizeSearchText(charge?.label) === normalizedTarget);
}

function appendRecoveredOneTimeCharge(repaired, charge) {
  const normalized = normalizeOneTimeItem(charge, { source: 'deterministic' });
  if (!normalized) return false;

  const collections = ensureOneTimeChargeCollections(repaired);
  if (hasMatchingOneTimeCharge(collections.oneTimeItems, normalized) || hasMatchingOneTimeCharge(collections.oneTimeCharges, normalized)) {
    repaired.oneTimeItems = collections.oneTimeItems;
    repaired.oneTimeCharges = collections.oneTimeCharges;
    return false;
  }

  const merged = applyCanonicalOneTimeItems({
    ...repaired,
    oneTimeItems: [...collections.oneTimeItems, normalized],
    oneTimeCharges: [...collections.oneTimeCharges, normalized],
  });
  repaired.oneTimeItems = merged.oneTimeItems;
  repaired.oneTimeCharges = merged.oneTimeCharges;
  return true;
}

function formatParsedDate(date) {
  if (!date || Number.isNaN(date.getTime?.())) return null;
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
}

const FLEXIBLE_DATE_PATTERN = /\b(?:\d{1,2}\/\d{1,2}\/\d{2,4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},?\s+\d{2,4})\b/gi;

function extractDueDateOrTrigger(windowText = '') {
  const dateMatches = windowText.match(FLEXIBLE_DATE_PATTERN) ?? [];
  for (const candidate of dateMatches) {
    const parsed = parseLeaseDate(candidate);
    if (parsed) {
      return {
        dueDate: formatParsedDate(parsed),
        triggerText: null,
      };
    }
  }

  const triggerMatch = windowText.match(/\b(?:at|upon|after|within)\b[\s\S]{0,80}?(?:lease execution|execution of (?:this )?lease|occupancy|opening|substantial completion|completion|delivery|receipt of invoices?|receipt of lien releases?|certificate of occupancy|co\b|commencement|rent commencement)\b/i)
    ?? windowText.match(/\b(?:lease execution|execution of (?:this )?lease|occupancy|opening|substantial completion|completion|delivery|receipt of invoices?|receipt of lien releases?|certificate of occupancy|co\b|commencement|rent commencement)\b[\s\S]{0,80}/i);

  return {
    dueDate: null,
    triggerText: triggerMatch?.[0]?.replace(/\s+/g, ' ').trim() || null,
  };
}

function extractAmountCandidates(windowText = '') {
  const matches = [];
  const regex = /\(\$\s*([\d,]+(?:\.\d{1,2})?)\)|\$\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s+dollars?\b/gi;

  let match = regex.exec(windowText);
  while (match) {
    const raw = match[1] ?? match[2] ?? match[3];
    const amount = moneyToNumber(raw);
    const precedingCharacter = windowText[Math.max(0, match.index - 1)] ?? '';
    const isFractionTail = match[3] && precedingCharacter === '/';
    if (!isFractionTail && amount != null && amount >= 50) {
      matches.push({
        amount,
        index: match.index,
        rawText: match[0],
      });
    }
    match = regex.exec(windowText);
  }

  return matches;
}

function deriveTrancheQualifier(beforeContext = '', afterContext = '') {
  const before = normalizeSearchText(beforeContext);
  const after = normalizeSearchText(afterContext);
  const combined = `${before} ${after}`.trim();
  const percentMatch = combined.match(/\b(\d{1,3})%\b/);

  if (/\btenant broker\b/.test(combined)) return 'Tenant Broker';
  if (/\blandlord broker\b/.test(combined)) return 'Landlord Broker';
  if (/\bparking\b/.test(combined) && /\bdeposit\b/.test(combined)) return 'Parking';

  const cues = [
    { label: 'Initial Funding', match: /(?:^|\s)(initial|first)(?:\s|$)/, source: `${before.slice(-30)} ${after.slice(0, 30)}` },
    { label: 'Final Funding', match: /(?:^|\s)(final|remaining|balance)(?:\s|$)/, source: `${before.slice(-30)} ${after.slice(0, 30)}` },
  ]
    .map((entry) => ({
      ...entry,
      index: normalizeSearchText(entry.source).search(entry.match),
    }))
    .filter((entry) => entry.index >= 0)
    .sort((left, right) => left.index - right.index);

  if (cues.length > 0) return cues[0].label;
  if (percentMatch) return `${percentMatch[1]}% Tranche`;
  return null;
}

const ONE_TIME_ITEM_SPECS = [
  {
    label: 'Security Deposit',
    aliases: [/\bsecurity deposit\b/i],
    sign: 1,
  },
  {
    label: 'Tenant Improvement Allowance',
    aliases: [/\b(?:tenant improvement allowance|improvement allowance|tenant allowance|tia)\b/i],
    sign: -1,
  },
  {
    label: 'Landlord Work Contribution',
    aliases: [/\b(?:landlord work contribution|landlord contribution|work allowance|landlord work allowance)\b/i],
    sign: -1,
  },
  {
    label: 'Moving Allowance',
    aliases: [/\b(?:moving allowance|move-?in allowance|relocation allowance)\b/i],
    sign: -1,
  },
  {
    label: 'Lease Commission',
    aliases: [/\b(?:tenant broker commission|landlord broker commission|broker(?:age)? commission|leasing commission|lease commission)\b/i],
    sign: -1,
  },
  {
    label: 'Parking Deposit',
    aliases: [/\bparking deposit\b/i],
    sign: 1,
  },
  {
    label: 'Letter of Credit',
    aliases: [/\bletter of credit\b/i],
    sign: 1,
  },
  {
    label: 'HVAC Charge Order',
    aliases: [/\bhvac\b[\s\S]{0,30}\b(?:charge[- ]?order|change[- ]?order|allowance|fee|cost)\b/i],
    sign: 1,
  },
];

function detectOneTimeEconomicItems(documentText = '') {
  const clauses = splitEconomicClauses(documentText);
  const recoveredItems = [];
  const seen = new Set();

  const containsAliasForOtherSpec = (clauseText, activeSpec) =>
    ONE_TIME_ITEM_SPECS.some((spec) =>
      spec !== activeSpec && spec.aliases.some((pattern) => pattern.test(clauseText))
    );

  for (let clauseIndex = 0; clauseIndex < clauses.length; clauseIndex += 1) {
    const clauseText = clauses[clauseIndex];

    for (const spec of ONE_TIME_ITEM_SPECS) {
      if (!spec.aliases.some((pattern) => pattern.test(clauseText))) continue;

      const relevantClauses = [clauseText];
      for (let nextIndex = clauseIndex + 1; nextIndex < Math.min(clauses.length, clauseIndex + 3); nextIndex += 1) {
        const nextClause = clauses[nextIndex];
        if (containsAliasForOtherSpec(nextClause, spec)) break;
        relevantClauses.push(nextClause);
      }

      for (const relevantClause of relevantClauses) {
        const amountMatches = extractAmountCandidates(relevantClause);
        if (amountMatches.length === 0) continue;

        for (const amountMatch of amountMatches) {
          const beforeContext = relevantClause.slice(Math.max(0, amountMatch.index - 45), amountMatch.index);
          const afterContext = relevantClause.slice(amountMatch.index, Math.min(relevantClause.length, amountMatch.index + 55));
          const context = `${beforeContext}${afterContext}`;
          const trancheQualifier = deriveTrancheQualifier(beforeContext, afterContext);
          const trigger = extractDueDateOrTrigger(context);
          const label = trancheQualifier && !normalizeSearchText(spec.label).includes(normalizeSearchText(trancheQualifier))
            ? `${spec.label} - ${trancheQualifier}`
            : spec.label;
          const notes = [trigger.triggerText, trancheQualifier && trancheQualifier !== 'Parking' ? `Recovered tranche: ${trancheQualifier}.` : null]
            .filter(Boolean)
            .join(' ');
          const item = normalizeOneTimeItem({
            label,
            amount: amountMatch.amount,
            dueDate: trigger.dueDate,
            sign: spec.sign,
            source: 'deterministic',
            confidence: trigger.dueDate ? 0.88 : 0.8,
            evidenceText: relevantClause,
            notes: notes || null,
          });
          if (!item) continue;

          const key = [
            normalizeSearchText(item.label),
            item.sign,
            item.amount.toFixed(2),
            normalizeSearchText(item.dueDate),
            normalizeSearchText(item.notes),
          ].join('::');
          if (seen.has(key)) continue;
          seen.add(key);
          recoveredItems.push(item);
        }
      }
    }
  }

  return recoveredItems;
}

function buildFreeRentEvents(monthCount, evidenceText) {
  return Array.from({ length: monthCount }, (_, index) => ({
    monthNumber: index + 1,
    value: null,
    valueMode: null,
    date: null,
    label: 'Conditionally Excused Rent',
    rawText: evidenceText,
    assumptionNote: 'Generated from lease text stating that Monthly Base Rent is excused for the first full calendar months of the Term.',
  }));
}

function mergeFreeRentEvents(existingEvents = [], recoveredFreeRent = null) {
  const baseEvents = Array.isArray(existingEvents) ? existingEvents.map((event) => ({ ...event })) : [];
  if (!recoveredFreeRent?.monthCount) return baseEvents;

  const recoveredEvents = buildFreeRentEvents(recoveredFreeRent.monthCount, recoveredFreeRent.evidenceText);
  const existingMonthKeys = new Set(
    baseEvents
      .map((event) => Number(event?.monthNumber))
      .filter((value) => Number.isInteger(value) && value > 0),
  );

  for (const event of recoveredEvents) {
    if (existingMonthKeys.has(event.monthNumber)) continue;
    baseEvents.push(event);
  }

  return baseEvents.sort((left, right) => {
    const leftMonth = Number(left?.monthNumber) || Number.POSITIVE_INFINITY;
    const rightMonth = Number(right?.monthNumber) || Number.POSITIVE_INFINITY;
    return leftMonth - rightMonth;
  });
}

function detectPremisesSquareFootage(documentText = '') {
  const windows = buildDocumentWindows(documentText, 2);
  for (const windowText of windows) {
    const match = windowText.match(/\brentable area of the premises\b[\s:.-]{0,20}([\d,]+)\s+square feet\b/i)
      ?? windowText.match(/\bthe rentable area of the premises is\b[\s:.-]{0,20}([\d,]+)\s+square feet\b/i);
    if (!match) continue;

    const value = Number(match[1].replace(/,/g, ''));
    if (Number.isFinite(value) && value > 0) return value;
  }

  return null;
}

function detectSecurityDepositAmount(documentText = '') {
  const windows = buildDocumentWindows(documentText, 3);
  for (const windowText of windows) {
    const match = windowText.match(/\bsecurity deposit\b[\s\S]{0,160}?\(\$\s*([\d,]+(?:\.\d{1,2})?)\)/i)
      ?? windowText.match(/\bsecurity deposit\b[\s\S]{0,100}?\$\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (!match) continue;

    const amount = moneyToNumber(match[1]);
    if (amount != null && amount > 0) {
      return {
        amount,
        evidenceText: windowText,
      };
    }
  }

  return null;
}

function detectLeadingFreeRentMonths(documentText = '') {
  const windows = buildDocumentWindows(documentText, 4);
  for (const windowText of windows) {
    if (!/\b(excused|free rent|abat(?:ed|ement))\b/i.test(windowText)) continue;
    if (!/\bmonthly base rent\b/i.test(windowText)) continue;

    const match = windowText.match(/\bfirst\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s*\(\s*(\d+)\s*\))?\s+full calendar months?\s+of\s+the\s+term\b/i);
    if (!match) continue;

    const monthCount = countToNumber(match[1], match[2]);
    if (!Number.isInteger(monthCount) || monthCount <= 0) continue;

    return {
      monthCount,
      evidenceText: windowText,
    };
  }

  return null;
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

  const startDate = parseLeaseDate(prefixMatch[1]);
  const endDate = parseLeaseDate(prefixMatch[2]);
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
    const leftTime = parseLeaseDate(left.periodStart)?.getTime() ?? 0;
    const rightTime = parseLeaseDate(right.periodStart)?.getTime() ?? 0;
    return leftTime - rightTime;
  });
}

export function repairDirectLeaseFactSemantics(result, documentText) {
  const repaired = {
    ...applyCanonicalOneTimeItems(result),
    confidenceFlags: Array.isArray(result?.confidenceFlags) ? [...result.confidenceFlags] : [],
    notices: Array.isArray(result?.notices) ? [...result.notices] : [],
    freeRentEvents: Array.isArray(result?.freeRentEvents)
      ? result.freeRentEvents.map((event) => ({ ...event }))
      : [],
  };

  const currentSquareFootage = Number(repaired.squareFootage);
  if (!Number.isFinite(currentSquareFootage) || currentSquareFootage <= 0) {
    const recoveredSquareFootage = detectPremisesSquareFootage(documentText);
    if (Number.isFinite(recoveredSquareFootage) && recoveredSquareFootage > 0) {
      repaired.squareFootage = recoveredSquareFootage;
      removeValue(repaired.confidenceFlags, 'squareFootage');
      pushUnique(repaired.notices, 'Rentable square footage was recovered directly from lease text after OCR left the field blank.');
    }
  }

  if (!(Number(repaired.securityDeposit) > 0) && !hasOneTimeChargeByLabel(ensureOneTimeChargeCollections(repaired).oneTimeItems, 'Security Deposit')) {
    const recoveredDeposit = detectSecurityDepositAmount(documentText);
    if (recoveredDeposit?.amount) {
      repaired.securityDeposit = recoveredDeposit.amount;
      if (!repaired.securityDepositDate) repaired.securityDepositDate = null;
      appendRecoveredOneTimeCharge(repaired, {
        label: 'Security Deposit',
        amount: recoveredDeposit.amount,
        dueDate: null,
        sign: 1,
        confidence: 0.92,
        evidenceText: recoveredDeposit.evidenceText,
        notes: 'Recovered directly from lease text after OCR omitted the deposit.',
      });
      pushUnique(repaired.notices, 'Security deposit was recovered directly from lease text after OCR omitted the one-time charge.');
    }
  }

  const recoveredFreeRent = detectLeadingFreeRentMonths(documentText);
  if (recoveredFreeRent?.monthCount) {
    const beforeCount = repaired.freeRentEvents.length;
    repaired.freeRentEvents = mergeFreeRentEvents(repaired.freeRentEvents, recoveredFreeRent);
    const appendedCount = repaired.freeRentEvents.length - beforeCount;
    if (appendedCount > 0) {
      pushUnique(
        repaired.notices,
        `${appendedCount} free-rent month${appendedCount === 1 ? '' : 's'} were recovered directly from lease text to complete the OCR concession set.`,
      );
    }
  }

  const existingOneTimeItems = mergeOneTimeItemCollections(repaired);
  const recoveredOneTimeItems = detectOneTimeEconomicItems(documentText);
  let appendedCount = 0;
  for (const item of recoveredOneTimeItems) {
    const alreadyPresent = existingOneTimeItems.some((existing) => (
      normalizeSearchText(existing.label) === normalizeSearchText(item.label)
      && Number(existing.amount).toFixed(2) === Number(item.amount).toFixed(2)
      && (existing.sign ?? 1) === (item.sign ?? 1)
    ));
    if (alreadyPresent) continue;
    if (appendRecoveredOneTimeCharge(repaired, item)) {
      existingOneTimeItems.push(item);
      appendedCount += 1;
    }
  }
  if (appendedCount > 0) {
    pushUnique(
      repaired.notices,
      `${appendedCount} one-time economic item${appendedCount === 1 ? '' : 's'} were recovered deterministically from lease text after OCR omission or schema drift.`,
    );
  }

  return applyCanonicalOneTimeItems(repaired);
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
    .split(/(?:\r?\n+|(?<=\.)\s+|(?<=;)\s+)/)
    .map((line) => line.trim())
    .filter(Boolean);

  const charges = [];
  const seen = new Set();
  const leadingEscPattern = /\b(?<label>nnn|cam(?:s)?|common area maintenance|operating expenses?|insurance|property insurance|real estate taxes?|taxes|additional rent)\b[\s,:-]*(?:escalat(?:e|ed|es)?[\s,:-]*)?(?:(?<esc>\d+(?:\.\d+)?)%\s*(?:every|per)\s*(?<cadenceValue>\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(?<cadenceUnit>year|years|month|months))?[\s,;-]*(?:amt|amount|monthly|per month|month|at)?[\s:$-]*(?<amount>\d[\d,]*(?:\.\d{1,2})?)/i;
  const trailingEscPattern = /\b(?<label>nnn|cam(?:s)?|common area maintenance|operating expenses?|insurance|property insurance|real estate taxes?|taxes|additional rent)\b[\s,:-]*(?:amount|amt)?[\s:$-]*(?<amount>\d[\d,]*(?:\.\d{1,2})?)[\s,;-]*(?:per|\/)?\s*(?:month|monthly)?[\s,;-]*(?:escalat(?:e|ed|es)?|increase(?:s|d)?)?[\s,:-]*(?<esc>\d+(?:\.\d+)?)%\s*(?:every|per)\s*(?<cadenceValue>\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(?<cadenceUnit>year|years|month|months)/i;
  const obligationOnlyPattern = /\b(?<label>operating expenses?|common area maintenance|cam(?:s)?|insurance|property insurance|real estate taxes?|taxes|additional rent|security services?|management fee|administrative fee|service charge)\b[\s\S]{0,90}?\b(?:tenant shall pay|tenant shall reimburse|shall pay as additional rent|shall reimburse landlord|payable monthly|payable annually|additional rent)\b/i;

  for (const line of lines) {
    const match = line.match(leadingEscPattern) ?? line.match(trailingEscPattern);
    if (!match?.groups?.amount) {
      const obligationMatch = line.match(obligationOnlyPattern);
      if (!obligationMatch?.groups?.label) continue;

      const route = inferRecurringChargeRoute(obligationMatch.groups.label);
      const key = `${route.bucketKey ?? route.label}:obligation-only`;
      if (seen.has(key)) continue;
      seen.add(key);

      charges.push({
        label: route.label,
        bucketKey: route.bucketKey,
        canonicalType: route.canonicalType,
        year1: null,
        amountBasis: 'unknown',
        escPct: null,
        chargeStart: null,
        escStart: null,
        confidence: 0.48,
        evidenceText: line,
        sourceKind: 'narrative_obligation',
        cadenceMonths: null,
      });
      continue;
    }

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
        repairSfBasedRentSemantics(
          repairDirectLeaseFactSemantics(result, documentText),
          documentText,
        ),
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
      ? result.rentSchedule.map((row) => ({ ...row }))
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

  // Secondary fallback: LLM returned rows but none have parseable dates (hallucinated or
  // malformed output). Run the text-regex extraction so the explicit schedule is not silently
  // suppressed by a junk LLM row.
  if (repaired.rentSchedule.length > 0) {
    const parseableCount = repaired.rentSchedule.filter(
      (row) => parseLeaseDate(row.periodStart) || parseLeaseDate(row.periodEnd),
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
    oneTimeItems: [],
    oneTimeCharges: [],
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

function normalizeExtractionResult(result, documentText, notices = []) {
  const normalized = applyCanonicalOneTimeItems({
    ...emptyExtractionResult(),
    ...(result ?? {}),
  });

  normalized.confidenceFlags = normalized.confidenceFlags ?? [];
  normalized.notices = [...notices, ...(normalized.notices ?? [])];
  normalized.rentSchedule = normalized.rentSchedule ?? [];
  normalized.rentCommencementDate = normalized.rentCommencementDate ?? null;
  normalized.freeRentEvents = Array.isArray(normalized.freeRentEvents) ? normalized.freeRentEvents : [];
  normalized.abatementEvents = Array.isArray(normalized.abatementEvents) ? normalized.abatementEvents : [];
  normalized.recurringCharges = Array.isArray(normalized.recurringCharges) ? normalized.recurringCharges : [];

  const repaired = applyCanonicalOneTimeItems(repairExtractionSemantics(normalized, documentText));
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
  const documentText = await extractPdfPlainText(pdfBuffer);

  if (!scanned && hasUsableDocumentText(documentText)) {
    try {
      const { result } = await extractFromDocumentText(documentText, 'native PDF text');
      result.notices.unshift('Native-text PDF routed through text-first extraction. OCR document vision was not required.');
      if (hasMeaningfulExtraction(result)) {
        return { result, isLikelyScanned: false, documentText };
      }
    } catch {
      // Fall through to OCR document extraction if text-first extraction fails.
    }
  }

  let rawText;
  let providerUsed;
  let fallbackReason;

  try {
    const base64PDF = bufferToBase64(pdfBuffer);
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
  const apiKey = import.meta.env?.VITE_ANTHROPIC_API_KEY;
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
  const apiKey = import.meta.env?.VITE_ANTHROPIC_API_KEY;
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
  const apiKey = import.meta.env?.VITE_OPENAI_API_KEY;
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
  const apiKey = import.meta.env?.VITE_OPENAI_API_KEY;
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
  const apiKey = import.meta.env?.VITE_OPENAI_API_KEY;
  return Boolean(apiKey && apiKey !== 'your_api_key_here');
}
