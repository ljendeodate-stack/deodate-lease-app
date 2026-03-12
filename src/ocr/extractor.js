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
 * @typedef {Object} ExtractionResult
 * @property {RentTierExtraction[]} rentSchedule
 * @property {number|null}          squareFootage
 * @property {string|null}          abatementEndDate   - MM/DD/YYYY or null.
 * @property {number|null}          abatementPct       - 0–100.
 * @property {NNNChargeExtraction}  cams
 * @property {NNNChargeExtraction}  insurance
 * @property {NNNChargeExtraction}  taxes
 * @property {NNNChargeExtraction}  security
 * @property {NNNChargeExtraction}  otherItems
 * @property {string[]}             confidenceFlags    - Field paths with low confidence.
 * @property {string[]}             notices            - Non-blocking extraction notices.
 * @property {boolean}              sfRequired         - True if rent is expressed as $/SF and SF is needed.
 * @property {'high'|'medium'|'low'} overallConfidence
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
8. NNN CHARGE FIELDS — STRICT RULES (cams, insurance, taxes, security, otherItems):
   a. Only populate year1 with a non-null value if the lease document explicitly states a SEPARATE, RECURRING line-item charge for that specific category. The category name or an unambiguous synonym must appear in the document alongside a dollar amount.
   b. Base rent values from the rent schedule must NEVER be placed in any NNN charge field. Rent schedule values belong only in the rentSchedule array.
   c. "security" must be null for all sub-fields unless the lease describes an ongoing, separately-billed security charge (NOT a one-time security deposit).
   d. "otherItems" must be null for all sub-fields unless the lease explicitly names a recurring charge category not covered by CAMS, insurance, or taxes.
   e. An aggregate NNN estimate (e.g. "Estimated Annual Operating Expenses: $X" or "Estimated First Year NNN: $Y") is NOT a line-item charge. Do not populate any individual NNN field with an aggregate estimate. Instead, add a notice such as: "Estimated NNN total of $X found — verify and enter individual charge line items manually."
   f. If the document lists NNN charges as a combined total without breaking them into CAMS, insurance, and taxes separately, leave all three fields null and add a notice.

JSON SCHEMA:
{
  "rentSchedule": [
    { "periodStart": "MM/DD/YYYY", "periodEnd": "MM/DD/YYYY", "monthlyRent": number }
  ],
  "squareFootage": number | null,
  "abatementEndDate": "MM/DD/YYYY" | null,
  "abatementPct": number | null,
  "sfRequired": boolean,
  "cams":       { "year1": number | null, "escPct": number | null, "chargeStart": "MM/DD/YYYY" | null, "escStart": "MM/DD/YYYY" | null },
  "insurance":  { "year1": number | null, "escPct": number | null, "chargeStart": "MM/DD/YYYY" | null, "escStart": "MM/DD/YYYY" | null },
  "taxes":      { "year1": number | null, "escPct": number | null, "chargeStart": "MM/DD/YYYY" | null, "escStart": "MM/DD/YYYY" | null },
  "security":   { "year1": number | null, "escPct": number | null, "chargeStart": "MM/DD/YYYY" | null, "escStart": "MM/DD/YYYY" | null },
  "otherItems": { "year1": number | null, "escPct": number | null, "chargeStart": "MM/DD/YYYY" | null, "escStart": "MM/DD/YYYY" | null },
  "confidenceFlags": ["field.path", ...],
  "notices": ["string", ...]
}`;

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

/**
 * Extract lease parameters from a PDF using the configured OCR provider.
 * Implements Path A (Section 1) of the application spec.
 *
 * @param {ArrayBuffer} pdfBuffer    - Raw PDF bytes from the browser File API.
 * @returns {Promise<{ result: ExtractionResult, isLikelyScanned: boolean }>}
 * @throws {Error} On network failure or non-200 API response.
 */
export async function extractFromPDF(pdfBuffer) {
  const scanned = likelyScanned(pdfBuffer);
  const base64PDF = bufferToBase64(pdfBuffer);
  const { rawText, providerUsed, fallbackReason } = await extractOCRText(base64PDF);

  let result;
  try {
    // Strip any accidental markdown fences
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    result = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `OCR provider returned a response that could not be parsed as JSON.\n\nRaw response:\n${rawText}`
    );
  }

  // Ensure required arrays/objects exist
  result.confidenceFlags = result.confidenceFlags ?? [];
  result.notices = result.notices ?? [];
  result.rentSchedule = result.rentSchedule ?? [];

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
            file_data: base64PDF,
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
