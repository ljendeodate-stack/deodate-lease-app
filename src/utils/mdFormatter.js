/**
 * @fileoverview DEODATE markdown output formatter.
 *
 * Provides composable functions for generating markdown deliverables —
 * change sheets, feature notes, assumption logs, and any other .md output
 * this application produces — conforming to the institutional style standard
 * established in buyout_renegotiation_feature_notes.md.
 *
 * STYLE RULES ENFORCED
 * ─────────────────────
 * 1. Document header block  — H1 title + **File/Sheet/Prepared by/As-of** metadata, separated by ---
 * 2. Section structure      — H2 for major sections, H3 for subsections, sections separated by ---
 * 3. Table-first            — markdown tables for cell references, formula inventories, color coding,
 *                             assumption registers, and multi-item comparisons
 * 4. Inline code            — cell addresses, ranges, formulas, file names, sheet names in backticks
 * 5. Bold for emphasis only — field labels in metadata block; named items in bullet lists
 * 6. Assumption bullets     — **Item name.** Explanation on same line
 * 7. Change numbered list   — 1. **Label** — plain prose explanation
 * 8. Institutional tone     — no filler phrases; calibrated language throughout
 * 9. Verification statement — required in Assumptions & Limitations when formula changes are documented
 * 10. Color coding table    — required in any Excel-deliverable output
 *
 * USAGE
 * ─────
 * import { buildDocument, buildTable, buildChangeList, buildAssumptionList,
 *          buildColorCodingTable, buildVerificationStatement } from '../utils/mdFormatter.js';
 *
 * const md = buildDocument({
 *   title:    'Lease Schedule — Monthly Charge Ledger',
 *   file:     'lease_schedule.xlsx',
 *   sheet:    'Lease Schedule',
 *   asOf:     '2026-03-13',         // ISO YYYY-MM-DD or explicit string
 *   sections: [
 *     { title: 'Summary of Changes', body: buildChangeList([...]) },
 *     { title: 'Assumptions & Limitations', body: buildAssumptionList([...]) + '\n' + buildVerificationStatement(1815) },
 *     { title: 'Color Coding Reference', body: buildColorCodingTable() },
 *   ],
 * });
 */

// ── Date formatting ────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Format a date for use in the As-of metadata field.
 * Accepts ISO YYYY-MM-DD strings, MM/DD/YYYY strings, Date objects,
 * or pre-formatted strings (returned unchanged if not parseable).
 *
 * @param {string|Date} value
 * @returns {string}  e.g. "March 13, 2026"
 */
export function formatAsOfDate(value) {
  if (!value) return '';

  if (value instanceof Date) {
    return `${MONTH_NAMES[value.getMonth()]} ${value.getDate()}, ${value.getFullYear()}`;
  }

  // ISO YYYY-MM-DD
  const isoMatch = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${MONTH_NAMES[Number(month) - 1]} ${Number(day)}, ${year}`;
  }

  // MM/DD/YYYY
  const mdyMatch = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    const [, month, day, year] = mdyMatch;
    return `${MONTH_NAMES[Number(month) - 1]} ${Number(day)}, ${year}`;
  }

  // Pass through any other string (already formatted or free-form)
  return String(value);
}

// ── Document header block (Rule 1) ────────────────────────────────────────────

/**
 * Build the opening header block for a markdown deliverable.
 *
 * Produces:
 *   # Title
 *
 *   **File:** `file.xlsx`
 *   **Sheet:** `Sheet Name`
 *   **Prepared by:** DEODATE
 *   **As-of:** Month DD, YYYY
 *
 *   ---
 *
 * @param {string}  title
 * @param {Object}  meta
 * @param {string}  meta.file    — filename (will be wrapped in backticks)
 * @param {string}  [meta.sheet] — sheet name (omitted if not provided)
 * @param {string|Date} meta.asOf — date value passed to formatAsOfDate()
 * @returns {string}
 */
export function buildDocumentHeader(title, { file, sheet, asOf } = {}) {
  const lines = [`# ${title}`, ''];

  if (file)  lines.push(`**File:** \`${file}\``);
  if (sheet) lines.push(`**Sheet:** \`${sheet}\``);
  lines.push('**Prepared by:** DEODATE');
  if (asOf)  lines.push(`**As-of:** ${formatAsOfDate(asOf)}`);

  lines.push('', '---', '');
  return lines.join('\n');
}

// ── Section structure (Rule 2) ────────────────────────────────────────────────

/**
 * Build a major section block (H2) or subsection (H3).
 * The body string is placed directly after the heading.
 * A `---` separator is appended at the end.
 *
 * @param {string}   title
 * @param {string}   body       — pre-formatted markdown string
 * @param {2|3}      [level=2]  — heading level
 * @returns {string}
 */
export function buildSection(title, body, level = 2) {
  const prefix = '#'.repeat(level);
  return [`${prefix} ${title}`, '', body.trimEnd(), '', '---', ''].join('\n');
}

// ── Markdown table (Rule 3) ───────────────────────────────────────────────────

/**
 * Build a markdown table.
 *
 * Column widths are calculated from the widest cell in each column
 * (header or data) so all columns align.
 *
 * @param {string[]}   headers  — column header labels
 * @param {string[][]} rows     — data rows; each inner array must have the same
 *                               length as headers; missing cells default to ''
 * @returns {string}
 */
export function buildTable(headers, rows) {
  const colCount = headers.length;

  // Normalise: ensure every row has exactly colCount cells
  const normalised = rows.map(row =>
    headers.map((_, i) => String(row[i] ?? ''))
  );

  // Compute column widths
  const widths = headers.map((h, i) => {
    const dataMax = normalised.reduce((max, row) => Math.max(max, row[i].length), 0);
    return Math.max(h.length, dataMax, 3); // minimum width 3 for separator dashes
  });

  const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));

  const headerRow    = '| ' + headers.map((h, i) => pad(h, widths[i])).join(' | ') + ' |';
  const separatorRow = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';
  const dataRows     = normalised.map(row =>
    '| ' + row.map((cell, i) => pad(cell, widths[i])).join(' | ') + ' |'
  );

  return [headerRow, separatorRow, ...dataRows].join('\n');
}

// ── Change list (Rule 7) ──────────────────────────────────────────────────────

/**
 * Build a numbered list documenting sequential changes.
 *
 * Each item renders as:
 *   N. **Label** — Description
 *
 * @param {Array<{ label: string, description: string }>} changes
 * @returns {string}
 */
export function buildChangeList(changes) {
  return changes
    .map((c, i) => `${i + 1}. **${c.label}** — ${c.description}`)
    .join('\n');
}

// ── Assumption / limitation bullets (Rule 6) ──────────────────────────────────

/**
 * Build a bullet list for assumptions and limitations sections.
 *
 * Each item renders as:
 *   - **Item name.** Detail explanation.
 *
 * @param {Array<{ name: string, detail: string }>} items
 * @returns {string}
 */
export function buildAssumptionList(items) {
  return items
    .map(({ name, detail }) => `- **${name}.** ${detail}`)
    .join('\n');
}

// ── Verification statement (Rule 9) ───────────────────────────────────────────

/**
 * Build the standard formula-recalculation verification bullet.
 * Include this as the last bullet in the Assumptions & Limitations section
 * for any output that documents formula changes.
 *
 * @param {number} formulaCount — total number of formulas that recalculated
 * @returns {string}
 */
export function buildVerificationStatement(formulaCount) {
  return `- **Formula recalculation verified.** All ${formulaCount.toLocaleString()} formula${formulaCount === 1 ? '' : 's'} recalculated with zero errors after changes were applied.`;
}

// ── Color coding table (Rule 10) ──────────────────────────────────────────────

/**
 * Build the standard DEODATE color coding reference table.
 * Required in all Excel-deliverable markdown outputs.
 *
 * @returns {string}
 */
export function buildColorCodingTable() {
  return buildTable(
    ['Color', 'Meaning'],
    [
      ['Blue text',                   'Hardcoded input — user-editable'],
      ['Black text',                  'Formula output — do not override'],
      ['Dark navy fill',              'Table header row'],
      ['Light blue fill',             'Assumptions input row'],
      ['Light pink fill',             'NNN/applied rent output cells'],
      ['Alternating white/blue rows', 'Monthly schedule periods'],
    ],
  );
}

// ── Full document assembly ─────────────────────────────────────────────────────

/**
 * Assemble a complete markdown document from a header and ordered sections.
 *
 * @param {Object}   opts
 * @param {string}   opts.title   — document title (H1)
 * @param {string}   opts.file    — filename in metadata block
 * @param {string}   [opts.sheet] — sheet name in metadata block (omit if not applicable)
 * @param {string|Date} opts.asOf — as-of date
 * @param {Array<{
 *   title:   string,
 *   body:    string,
 *   level?:  2|3
 * }>} opts.sections — ordered section definitions
 * @returns {string}
 */
export function buildDocument({ title, file, sheet, asOf, sections = [] }) {
  const parts = [buildDocumentHeader(title, { file, sheet, asOf })];

  for (const s of sections) {
    parts.push(buildSection(s.title, s.body, s.level ?? 2));
  }

  return parts.join('\n');
}
