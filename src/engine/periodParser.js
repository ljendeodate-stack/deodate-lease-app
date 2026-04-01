/**
 * @fileoverview Flexible period string and rent value parsers.
 *
 * Handles all formats encountered in real lease documents:
 *   "3/1/18 - 2/28/19"   start-end with spaces around dash
 *   "3/1/18-2/28/19"     start-end no spaces
 *   "Year 1", "Year 2"   relative year labels (unresolved until user edits)
 *   "3/1/18"             single date — end inferred from next row's start minus 1 day
 *
 * Two-digit year rule: 00–49 → 2000–2049, 50–99 → 1950–1999.
 * Rent parsing strips $, commas, asterisks; flags * as potential abatement.
 *
 * No UI dependencies. All functions are pure.
 */

import { normalizeScheduleTextForParsing } from '../utils/scheduleTextNormalization.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Expand a 2-digit year to 4 digits.
 * 00–49 → 2000–2049, 50–99 → 1950–1999.
 * @param {number} yy
 * @returns {number}
 */
function expandYear(yy) {
  if (yy >= 100) return yy; // already a 4-digit year
  return yy < 50 ? 2000 + yy : 1900 + yy;
}

/**
 * Normalize a raw line from OCR-extracted text to correct common artifacts:
 *   - Removes spaces adjacent to slashes in date contexts ("3/ 1 /18" → "3/1/18")
 *   - Converts dot-as-slash date separators ("3.1.18" → "3/1/18")
 *     Safe: the dot-slash regex requires the first group to be 1–2 digits (max 99),
 *     which prevents matching inside large numbers like "121.097.81".
 *
 * @param {string} line
 * @returns {string}
 */
function normalizeLine(line) {
  let s = normalizeScheduleTextForParsing(line);
  // Remove spaces before a slash when the preceding char is a digit
  s = s.replace(/(?<=\d)\s+(?=\/)/g, '');
  // Remove spaces after a slash when the following char is a digit
  s = s.replace(/(?<=\/)\s+(?=\d)/g, '');
  // Convert dot-delimited dates to slash-delimited: "3.1.18" → "3/1/18"
  // Only matches when first group is 1–2 digits (valid month/day range)
  s = s.replace(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/g, '$1/$2/$3');
  return s;
}

/**
 * Returns true if the trimmed line contains only a single date token and nothing else.
 * Used to detect split OCR lines where the period start is on its own line.
 * @param {string} line
 * @returns {boolean}
 */
function isBareDateLine(line) {
  return /^\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/.test(line.trim());
}

/**
 * Returns true if the trimmed line begins with a date token (possibly followed by more content).
 * @param {string} line
 * @returns {boolean}
 */
function startsWithDate(line) {
  return /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line.trim());
}

/**
 * Parse a single date token in common lease formats:
 *   M/D/YY, M/D/YYYY, MM/DD/YY, MM/DD/YYYY
 *   YYYY-MM-DD
 *
 * @param {string} s
 * @returns {Date|null}
 */
function parseDateToken(s) {
  s = s.trim();
  if (!s) return null;

  // M/D/YY or M/D/YYYY
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const m = Number(slashMatch[1]);
    const d = Number(slashMatch[2]);
    const y = expandYear(Number(slashMatch[3]));
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    dt.setHours(0, 0, 0, 0);
    return dt;
  }

  // YYYY-MM-DD (ISO)
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    dt.setHours(0, 0, 0, 0);
    return dt;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public parsers
// ---------------------------------------------------------------------------

/**
 * Parse a flexible period string into start and end dates.
 *
 * @param {string} str - Raw period string from user input or bulk paste.
 * @returns {{
 *   start: Date|null,
 *   end: Date|null,
 *   isRelative: boolean,
 *   relativeYear: number|null,
 *   raw: string
 * }}
 */
export function parsePeriodString(str) {
  const s = normalizeLine((str ?? '').trim());

  // "Year N" relative label — can't auto-resolve dates
  const yearLabelMatch = s.match(/^[Yy]ear\s+(\d+)$/);
  if (yearLabelMatch) {
    return {
      start: null,
      end: null,
      isRelative: true,
      relativeYear: Number(yearLabelMatch[1]),
      raw: s,
    };
  }

  // Range with explicit " - " separator: "3/1/18 - 2/28/19"
  const spaceDashIdx = s.indexOf(' - ');
  if (spaceDashIdx !== -1) {
    const left = s.slice(0, spaceDashIdx);
    const right = s.slice(spaceDashIdx + 3);
    const start = parseDateToken(left);
    const end = parseDateToken(right);
    if (start && end) {
      return { start, end, isRelative: false, relativeYear: null, raw: s };
    }
  }

  // Range without spaces: "3/1/18-2/28/19"
  // Match two slash-dates separated by a dash
  const compactRangeMatch = s.match(
    /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{2,4})$/
  );
  if (compactRangeMatch) {
    const start = parseDateToken(compactRangeMatch[1]);
    const end = parseDateToken(compactRangeMatch[2]);
    if (start && end) {
      return { start, end, isRelative: false, relativeYear: null, raw: s };
    }
  }

  // Single date — end date will be inferred from the next row
  const single = parseDateToken(s);
  if (single) {
    return { start: single, end: null, isRelative: false, relativeYear: null, raw: s };
  }

  return { start: null, end: null, isRelative: false, relativeYear: null, raw: s };
}

/**
 * Parse a monthly rent string, tolerating common OCR artifacts:
 *   - Strips $, commas, spaces, and asterisks
 *   - Treats a leading "S" or "s" as a misread "$" (e.g. "S98,463.60")
 *   - Treats multiple dots as thousands separators when >1 dot is present
 *     (e.g. "S121.097.81" → 121097.81; "S98.463.60" → 98463.60)
 *
 * @param {string} str
 * @returns {{ rent: number, hasAsterisk: boolean }}
 */
export function parseRentString(str) {
  let s = String(str ?? '').trim();
  // Replace leading "S" or "s" (OCR misread of "$") before a digit or comma
  s = s.replace(/^[Ss](?=[\d,])/, '$');
  const hasAsterisk = s.includes('*');
  // Strip $, commas, asterisk, whitespace
  let cleaned = s.replace(/[$,*\s]/g, '');
  // If more than one dot remains, all but the last are thousands separators
  const dotCount = (cleaned.match(/\./g) ?? []).length;
  if (dotCount > 1) {
    const lastDot = cleaned.lastIndexOf('.');
    cleaned = cleaned.slice(0, lastDot).replace(/\./g, '') + cleaned.slice(lastDot);
  }
  const rent = parseFloat(cleaned);
  return { rent: isNaN(rent) ? NaN : rent, hasAsterisk };
}

/**
 * Infer end dates for rows where end is null.
 * For each such row, the end date = next row's start date minus 1 day.
 * The last row in the list will remain end: null if not explicitly set.
 *
 * @param {Array<{ start: Date|null, end: Date|null, isRelative: boolean, monthlyRent: number, hasAsterisk: boolean }>} rows
 * @returns {Array<{ start: Date|null, end: Date|null, isRelative: boolean, monthlyRent: number, hasAsterisk: boolean, endInferred: boolean }>}
 */
export function inferEndDates(rows) {
  return rows.map((row, idx) => {
    if (row.end !== null || !row.start) {
      return { ...row, endInferred: false };
    }
    // Find the next row with a real start date
    let inferredEnd = null;
    for (let i = idx + 1; i < rows.length; i++) {
      if (rows[i].start) {
        const d = new Date(rows[i].start.getTime() - 86400000); // minus 1 day
        d.setHours(0, 0, 0, 0);
        inferredEnd = d;
        break;
      }
    }
    return { ...row, end: inferredEnd, endInferred: inferredEnd !== null };
  });
}

/**
 * Split a normalized bulk-paste line into a period string and rent string.
 *
 * Strategy (in order):
 *   1. Split on tab character.
 *   2. Split on 2+ consecutive spaces (most common formatted input).
 *   3. Fallback regex: find the last whitespace-delimited token that looks like
 *      a rent value (handles single-space separator and "S"-prefixed OCR values).
 *
 * @param {string} line
 * @returns {{ periodStr: string, rentStr: string }|null}
 */
function splitLine(line) {
  // Tab separator
  const tabIdx = line.indexOf('\t');
  if (tabIdx !== -1) {
    const periodStr = line.slice(0, tabIdx).trim();
    const rentStr = line.slice(tabIdx + 1).trim();
    if (periodStr && rentStr) return { periodStr, rentStr };
  }

  // 2+ spaces separator
  const multiSpace = line.match(/^(.*?)\s{2,}(\S.*)$/);
  if (multiSpace) {
    const periodStr = multiSpace[1].trim();
    const rentStr = multiSpace[2].trim();
    if (periodStr && rentStr) return { periodStr, rentStr };
  }

  // Fallback: last whitespace + token that looks like a rent value.
  // Accepts $, S (OCR), or a bare digit at the start of the rent token.
  const rentFallback = line.match(/^(.*)\s+([S$]?[\d][\d,.*]*)$/);
  if (rentFallback) {
    const periodStr = rentFallback[1].trim();
    const rentStr = rentFallback[2].trim();
    if (periodStr && rentStr) return { periodStr, rentStr };
  }

  return null;
}

/**
 * Parse a full bulk-pasted rent schedule text into rows.
 *
 * @param {string} text - Multi-line text pasted from a lease PDF or Word doc.
 * @returns {{
 *   rows: Array<{
 *     periodStr: string,
 *     rentStr: string,
 *     start: Date|null,
 *     end: Date|null,
 *     isRelative: boolean,
 *     relativeYear: number|null,
 *     monthlyRent: number,
 *     hasAsterisk: boolean,
 *     warning: string|null
 *   }>,
 *   warnings: string[]
 * }}
 */
export function parseBulkPasteText(text) {
  // --- Step 1: split, trim, discard blanks ---
  const rawLines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // --- Step 2: normalize each line (OCR artifact repair) ---
  const normalized = rawLines.map(normalizeLine);

  // --- Step 3: merge continuation lines ---
  // When OCR breaks a period range across two lines (e.g. the start date lands
  // on one line and the end date + rent land on the next), join them with " - ".
  // Detection: current line is a bare date token AND the next line starts with a date.
  const merged = [];
  for (let i = 0; i < normalized.length; i++) {
    const line = normalized[i];
    if (
      isBareDateLine(line) &&
      i + 1 < normalized.length &&
      startsWithDate(normalized[i + 1])
    ) {
      merged.push(line.trim() + ' - ' + normalized[i + 1].trim());
      i++; // consumed next line
    } else {
      merged.push(line);
    }
  }

  const rows = [];
  const globalWarnings = [];

  for (let i = 0; i < merged.length; i++) {
    const line = merged[i];
    const split = splitLine(line);

    if (!split) {
      globalWarnings.push(`Row ${i + 1}: Could not separate period from rent in: "${line}"`);
      continue;
    }

    const { periodStr, rentStr } = split;
    const parsed = parsePeriodString(periodStr);
    const { rent, hasAsterisk } = parseRentString(rentStr);

    let warning = null;
    if (!parsed.start && !parsed.isRelative) {
      warning = `Could not parse period: "${periodStr}"`;
    }
    if (isNaN(rent)) {
      const rentMsg = `Could not parse rent: "${rentStr}"`;
      warning = warning ? `${warning}; ${rentMsg}` : rentMsg;
    }

    rows.push({
      periodStr,
      rentStr,
      start: parsed.start,
      end: parsed.end,
      isRelative: parsed.isRelative,
      relativeYear: parsed.relativeYear,
      monthlyRent: rent,
      hasAsterisk,
      warning,
    });
  }

  return { rows, warnings: globalWarnings };
}

/**
 * Convert parsed rows (with inferred end dates applied) to canonical period rows
 * ready for expandPeriods(). Drops any row without a valid start, end, and rent.
 *
 * @param {Array<{ start: Date|null, end: Date|null, monthlyRent: number }>} rows
 * @returns {{ periodStart: Date, periodEnd: Date, monthlyRent: number }[]}
 */
export function toCanonicalPeriodRows(rows) {
  return rows
    .filter((r) => r.start && r.end && !isNaN(r.monthlyRent))
    .map((r) => ({ periodStart: r.start, periodEnd: r.end, monthlyRent: r.monthlyRent }));
}
