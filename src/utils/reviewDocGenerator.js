/**
 * @fileoverview Generate a concise .docx review memo for a processed lease.
 *
 * The memo is max ~1 page and covers:
 *   - Lease identification (name, term, SF)
 *   - Extraction confidence summary
 *   - Fields categorized as reliable / uncertain / missing
 *   - Plausibility warnings
 *   - Validation warnings
 *   - Items requiring manual review
 *
 * Pure function — no UI dependencies. Returns a Blob.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
} from 'docx';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FONT = 'Calibri';
const FONT_SIZE = 18; // half-points → 9pt

function text(str, opts = {}) {
  return new TextRun({ text: str, font: FONT, size: FONT_SIZE, ...opts });
}

function boldText(str, opts = {}) {
  return text(str, { bold: true, ...opts });
}

function para(runs, opts = {}) {
  return new Paragraph({
    children: Array.isArray(runs) ? runs : [runs],
    spacing: { after: 60 },
    ...opts,
  });
}

function heading(str, level = HeadingLevel.HEADING_2) {
  return new Paragraph({
    children: [new TextRun({ text: str, font: FONT, size: 20, bold: true })],
    heading: level,
    spacing: { before: 120, after: 60 },
  });
}

function bullet(str) {
  return new Paragraph({
    children: [text(str)],
    bullet: { level: 0 },
    spacing: { after: 40 },
  });
}

function fmtDate(d) {
  if (!d) return 'N/A';
  if (typeof d === 'string') return d;
  if (d instanceof Date && !isNaN(d.getTime())) {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${d.getFullYear()}`;
  }
  return 'N/A';
}

function noBorder() {
  return {
    top: { style: BorderStyle.NONE, size: 0 },
    bottom: { style: BorderStyle.NONE, size: 0 },
    left: { style: BorderStyle.NONE, size: 0 },
    right: { style: BorderStyle.NONE, size: 0 },
  };
}

function kvRow(label, value) {
  return new TableRow({
    children: [
      new TableCell({
        children: [para(boldText(label), { spacing: { after: 20 } })],
        width: { size: 35, type: WidthType.PERCENTAGE },
        borders: noBorder(),
      }),
      new TableCell({
        children: [para(text(value || 'N/A'), { spacing: { after: 20 } })],
        width: { size: 65, type: WidthType.PERCENTAGE },
        borders: noBorder(),
      }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/**
 * Generate a review memo as a .docx Blob.
 *
 * @param {Object} opts
 * @param {string}  opts.leaseName
 * @param {string}  opts.leaseStart     - ISO date or formatted string
 * @param {string}  opts.leaseEnd       - ISO date or formatted string
 * @param {number}  opts.squareFootage
 * @param {number}  opts.totalMonths
 * @param {import('../engine/confidenceScorer.js').ConfidenceResult|null} opts.confidenceResult
 * @param {{ reliable: string[], uncertain: string[], missing: string[] }|null} opts.fieldCategories
 * @param {import('../engine/plausibility.js').PlausibilityIssue[]} opts.plausibilityIssues
 * @param {{ field: string, message: string, severity: string }[]} opts.validationWarnings
 * @param {string}  opts.nnnMode
 * @param {string}  opts.generatedDate  - Date string for the memo header
 * @returns {Promise<Blob>}
 */
export async function generateReviewMemo({
  leaseName = 'Untitled Lease',
  leaseStart,
  leaseEnd,
  squareFootage,
  totalMonths,
  confidenceResult,
  fieldCategories,
  plausibilityIssues = [],
  validationWarnings = [],
  nnnMode = 'individual',
  generatedDate,
}) {
  const sections = [];

  // --- Title ---
  sections.push(
    new Paragraph({
      children: [
        new TextRun({
          text: 'DEODATE — Lease Review Memo',
          font: FONT,
          size: 28,
          bold: true,
          color: '1D4ED8',
        }),
      ],
      spacing: { after: 40 },
    })
  );

  sections.push(
    para([
      text(`Generated: ${generatedDate || new Date().toLocaleDateString('en-US')}`, { italics: true, color: '6B7280' }),
    ])
  );

  // --- Lease Summary ---
  sections.push(heading('Lease Summary'));

  const summaryRows = [
    kvRow('Lease Name', leaseName),
    kvRow('Lease Start', leaseStart || 'N/A'),
    kvRow('Lease End', leaseEnd || 'N/A'),
    kvRow('Total Months', totalMonths != null ? String(totalMonths) : 'N/A'),
    kvRow('Square Footage', squareFootage ? squareFootage.toLocaleString() : 'Not provided'),
    kvRow('NNN Mode', nnnMode === 'aggregate' ? 'Aggregate (combined)' : 'Individual (itemized)'),
  ];

  sections.push(
    new Table({
      rows: summaryRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
    })
  );

  // --- Extraction Confidence ---
  if (confidenceResult) {
    sections.push(heading('Extraction Confidence'));

    const levelLabel =
      confidenceResult.level === 'high' ? 'HIGH' :
      confidenceResult.level === 'medium' ? 'MEDIUM' : 'LOW';

    const pctStr = `${(confidenceResult.overall * 100).toFixed(0)}%`;

    sections.push(
      para([
        boldText('Overall: '),
        text(`${pctStr} (${levelLabel})`),
      ])
    );

    if (confidenceResult.reasons.length > 0) {
      for (const reason of confidenceResult.reasons) {
        sections.push(bullet(reason));
      }
    }
  }

  // --- Field Categories ---
  if (fieldCategories) {
    sections.push(heading('Field Extraction Status'));

    if (fieldCategories.reliable.length > 0) {
      sections.push(para(boldText('Reliably extracted:', { color: '059669' })));
      for (const f of fieldCategories.reliable) {
        sections.push(bullet(f));
      }
    }

    if (fieldCategories.uncertain.length > 0) {
      sections.push(para(boldText('Uncertain — verify:', { color: 'D97706' })));
      for (const f of fieldCategories.uncertain) {
        sections.push(bullet(f));
      }
    }

    if (fieldCategories.missing.length > 0) {
      sections.push(para(boldText('Missing — manual entry needed:', { color: 'DC2626' })));
      for (const f of fieldCategories.missing) {
        sections.push(bullet(f));
      }
    }
  }

  // --- Plausibility Warnings ---
  const plausWarnings = plausibilityIssues.filter((i) => i.severity === 'warning');
  const plausErrors = plausibilityIssues.filter((i) => i.severity === 'error');

  if (plausWarnings.length > 0 || plausErrors.length > 0) {
    sections.push(heading('Plausibility Checks'));

    if (plausErrors.length > 0) {
      sections.push(para(boldText('Issues (blocking):', { color: 'DC2626' })));
      for (const issue of plausErrors) {
        sections.push(bullet(issue.message));
      }
    }

    if (plausWarnings.length > 0) {
      sections.push(para(boldText('Warnings (non-blocking):', { color: 'D97706' })));
      for (const issue of plausWarnings) {
        sections.push(bullet(issue.message));
      }
    }
  }

  // --- Validation Warnings ---
  if (validationWarnings.length > 0) {
    sections.push(heading('Validation Notes'));
    for (const w of validationWarnings) {
      sections.push(bullet(w.message));
    }
  }

  // --- Manual Review Checklist ---
  const reviewItems = [];
  if (fieldCategories?.uncertain?.length > 0) {
    reviewItems.push(`Verify ${fieldCategories.uncertain.length} uncertain field(s) flagged above.`);
  }
  if (fieldCategories?.missing?.length > 0) {
    reviewItems.push(`Provide ${fieldCategories.missing.length} missing field(s) via manual entry.`);
  }
  if (plausWarnings.length > 0) {
    reviewItems.push(`Review ${plausWarnings.length} plausibility warning(s).`);
  }
  if (nnnMode === 'aggregate') {
    reviewItems.push('NNN is aggregate — consider obtaining itemized CAMS/Insurance/Taxes breakdown.');
  }
  if (!squareFootage) {
    reviewItems.push('Square footage not provided — Effective $/SF column will show $0.');
  }

  if (reviewItems.length > 0) {
    sections.push(heading('Action Items'));
    for (const item of reviewItems) {
      sections.push(bullet(item));
    }
  } else {
    sections.push(heading('Action Items'));
    sections.push(para(text('No action items — all fields appear complete.', { color: '059669' })));
  }

  // --- Footer ---
  sections.push(
    new Paragraph({
      children: [
        text('This memo is auto-generated by the DEODATE Lease Schedule Engine. It is not a legal review.', {
          italics: true,
          color: '9CA3AF',
          size: 16,
        }),
      ],
      spacing: { before: 200 },
      alignment: AlignmentType.CENTER,
    })
  );

  // --- Build document ---
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: FONT_SIZE },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 720,    // 0.5 inch in twips
              bottom: 720,
              left: 1080,  // 0.75 inch
              right: 1080,
            },
          },
        },
        children: sections,
      },
    ],
  });

  return Packer.toBlob(doc);
}
