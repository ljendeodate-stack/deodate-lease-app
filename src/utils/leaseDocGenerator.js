/**
 * @fileoverview Generate a companion .docx document for a processed lease.
 *
 * Pure function — no UI dependencies. Returns Promise<Blob>.
 * Implements Section E of IMPLEMENTATION_PLAN.md.
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
const SZ = 18; // half-points → 9pt

function text(str, opts = {}) {
  return new TextRun({ text: str, font: FONT, size: SZ, ...opts });
}

function bold(str, opts = {}) {
  return text(str, { bold: true, ...opts });
}

function para(runs, opts = {}) {
  return new Paragraph({
    children: Array.isArray(runs) ? runs : [runs],
    spacing: { after: 80 },
    ...opts,
  });
}

function heading(str, level = HeadingLevel.HEADING_2) {
  return new Paragraph({
    children: [new TextRun({ text: str, font: FONT, size: 22, bold: true })],
    heading: level,
    spacing: { before: 200, after: 80 },
  });
}

function bullet(str) {
  return new Paragraph({
    children: [text(str)],
    bullet: { level: 0 },
    spacing: { after: 40 },
  });
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
        children: [para(bold(label), { spacing: { after: 20 } })],
        width: { size: 40, type: WidthType.PERCENTAGE },
        borders: noBorder(),
      }),
      new TableCell({
        children: [para(text(String(value ?? 'N/A')), { spacing: { after: 20 } })],
        width: { size: 60, type: WidthType.PERCENTAGE },
        borders: noBorder(),
      }),
    ],
  });
}

function kvTable(pairs) {
  return new Table({
    rows: pairs.map(([k, v]) => kvRow(k, v)),
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

function fmtDate(d) {
  if (!d) return 'N/A';
  if (typeof d === 'string') {
    if (d.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [y, m, dd] = d.split('-');
      return `${m}/${dd}/${y}`;
    }
    return d;
  }
  if (d instanceof Date && !isNaN(d.getTime())) {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${d.getFullYear()}`;
  }
  return 'N/A';
}

function fmtDollar(n) {
  if (n == null || isNaN(n)) return '$0.00';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildSection1(rows, params, metadata) {
  const first = rows[0] ?? {};
  const last = rows[rows.length - 1] ?? {};
  return [
    heading('1. Lease Overview'),
    kvTable([
      ['Lease Name', params.leaseName || 'Untitled'],
      ['Commencement Date', fmtDate(first.periodStart)],
      ['Expiration Date', fmtDate(last.periodEnd)],
      ['Total Term', `${rows.length} months`],
      ['Rentable Square Footage', params.squareFootage ? Number(params.squareFootage).toLocaleString() : 'Not provided'],
      ['Input Path', metadata.inputPath === 'scan' ? 'PDF Scan (OCR)' : 'Manual / File Entry'],
    ]),
  ];
}

function buildSection2(params) {
  const isAgg = params.nnnMode === 'aggregate';
  const charges = params.charges ?? [];

  // Build charge table rows dynamically
  const chargeRows = [];
  if (isAgg) {
    chargeRows.push(['NNN Aggregate Monthly', fmtDollar(params.nnnAggregate?.year1)]);
  }
  for (const ch of charges) {
    if (isAgg && ch.canonicalType === 'nnn') continue; // skip individual NNN in aggregate mode
    const label = ch.displayLabel || ch.key;
    const typeTag = ch.canonicalType === 'nnn' ? ' [NNN]' : ' [Other]';
    chargeRows.push([`${label} Year 1 Monthly${typeTag}`, fmtDollar(ch.year1)]);
  }

  const items = [
    heading('2. Key Extracted Terms'),
    kvTable([
      ['NNN Mode', isAgg ? 'Aggregate (single monthly estimate)' : 'Individual (per-charge)'],
      ...chargeRows,
    ]),
  ];

  if (params.abatementEndDate) {
    items.push(para([bold('Abatement: '), text(`ends ${fmtDate(params.abatementEndDate)}, ${params.abatementPct ?? 100}% abatement`)]));
  }

  const ot = params.oneTimeItems ?? [];
  if (ot.length > 0) {
    items.push(para(bold(`One-Time Charges: ${ot.length}`)));
    ot.forEach((item) => {
      items.push(bullet(`${item.label || 'Unnamed'}: ${fmtDollar(item.amount)} on ${item.date ? fmtDate(item.date) : 'lease commencement'}`));
    });
  }

  return items;
}

function buildSection3(rows, params) {
  const items = [heading('3. Idiosyncrasies and Unusual Provisions')];
  let hasContent = false;

  // Aggregate NNN
  if (params.nnnMode === 'aggregate') {
    items.push(bullet('Aggregate NNN: No line-item breakdown for CAM/Insurance/Taxes was available. A single monthly NNN estimate is used.'));
    hasContent = true;
  }

  // Abatement
  if (params.abatementEndDate && params.abatementPct > 0) {
    if (params.abatementPct === 100) {
      items.push(bullet(`Free rent period: 100% abatement through ${fmtDate(params.abatementEndDate)}. Tenant pays $0 base rent during this period.`));
    } else {
      items.push(bullet(`Partial abatement: ${params.abatementPct}% abatement through ${fmtDate(params.abatementEndDate)}.`));
    }
    hasContent = true;
  }

  // Boundary proration
  const boundaryRow = rows.find((r) => r.prorationBasis === 'abatement-boundary');
  if (boundaryRow && boundaryRow.baseRentProrationFactor !== 1) {
    items.push(bullet(`Partial-month abatement boundary detected: proration factor of ${boundaryRow.baseRentProrationFactor?.toFixed(4) ?? 'N/A'}.`));
    hasContent = true;
  }

  // Step-ups
  const year1Rent = rows[0]?.scheduledBaseRent ?? 0;
  const year2Row = rows.find((r) => (r.leaseYear ?? r['Year #']) === 2);
  if (year2Row && year1Rent > 0 && year2Row.scheduledBaseRent !== year1Rent) {
    const rate = ((year2Row.scheduledBaseRent / year1Rent) - 1) * 100;
    items.push(bullet(`Rent escalation detected: Year 1 → Year 2 = ${rate.toFixed(2)}% increase.`));
    hasContent = true;
  }

  // One-time charges without dates
  const otNoDates = (params.oneTimeItems ?? []).filter((i) => !i.date);
  if (otNoDates.length > 0) {
    items.push(bullet(`${otNoDates.length} one-time charge(s) without specific dates — assigned to lease commencement.`));
    hasContent = true;
  }

  // Stub periods
  const yearCounts = {};
  rows.forEach((r) => { const y = r.leaseYear ?? r['Year #']; if (y) yearCounts[y] = (yearCounts[y] || 0) + 1; });
  const years = Object.keys(yearCounts).map(Number).sort((a, b) => a - b);
  if (years.length > 0) {
    if (yearCounts[years[0]] < 12) {
      items.push(bullet(`Stub period at lease start: Year ${years[0]} has only ${yearCounts[years[0]]} months.`));
      hasContent = true;
    }
    if (years.length > 1 && yearCounts[years[years.length - 1]] < 12) {
      items.push(bullet(`Stub period at lease end: Year ${years[years.length - 1]} has only ${yearCounts[years[years.length - 1]]} months.`));
      hasContent = true;
    }
  }

  if (!hasContent) {
    items.push(para(text('No unusual provisions detected for this lease.')));
  }

  return items;
}

function buildSection4(params) {
  return [
    heading('4. Assumptions the System Made'),
    bullet('Escalation compounding model: annual, applied at year boundaries based on the Year # column.'),
    bullet('NNN escalation uses the same Year # as base rent unless a category-specific escalation start date was provided.'),
    bullet('Abatement applies to base rent only — NNN charges are not abated.'),
    bullet('One-time items without dates are assigned to the first row (lease commencement).'),
    bullet('Remaining balances are tail-sums (simple forward accumulation, not NPV).'),
    ...(params.nnnMode === 'aggregate'
      ? [bullet('Aggregate NNN: The single monthly NNN estimate is placed in the CAMS column; Insurance and Taxes columns are zero.')]
      : []),
  ];
}

function buildSection5(metadata) {
  const items = [heading('5. Warnings and Confidence Notes')];

  if (metadata.inputPath === 'scan') {
    const flags = metadata.ocrConfidenceFlags ?? [];
    const notices = metadata.ocrNotices ?? [];
    const extWarnings = metadata.extractionWarnings ?? [];

    if (flags.length > 0) {
      items.push(para(bold('OCR Confidence Flags (low-confidence fields):')));
      flags.forEach((f) => items.push(bullet(f)));
    }
    if (notices.length > 0) {
      items.push(para(bold('OCR Extraction Notices:')));
      notices.forEach((n) => items.push(bullet(n)));
    }
    if (extWarnings.length > 0) {
      items.push(para(bold('Extraction Warnings:')));
      extWarnings.forEach((w) => items.push(bullet(w)));
    }
    if (flags.length === 0 && notices.length === 0 && extWarnings.length === 0) {
      items.push(para(text('No warnings or confidence issues were flagged during extraction.')));
    }
  } else {
    items.push(para(text('This schedule was entered manually. No automated extraction or confidence scoring was performed. All values are user-supplied.')));
  }

  const parseWarnings = metadata.parseWarnings ?? [];
  if (parseWarnings.length > 0) {
    items.push(para(bold('Parse Warnings:')));
    parseWarnings.forEach((w) => items.push(bullet(w)));
  }

  return items;
}

function buildSection6() {
  return [
    heading('6. How to Interpret the Excel Workbook'),
    para(bold('Tab Overview:')),
    bullet('Lease Schedule — Monthly ledger with assumptions block (rows 5–22) and data rows (row 25+).'),
    bullet('Annual Summary — Year-by-year totals with cross-sheet SUMIF formulas.'),
    bullet('Audit Trail — Per-row calculation trace (proration factors, escalation years, charge active flags).'),
    para(bold('Color Coding:')),
    bullet('Blue text = hard-coded user input values (editable assumptions and one-time charges).'),
    bullet('Black text = formula outputs (auto-calculated from assumptions).'),
    bullet('Red-pink fill = NNN / obligation columns.'),
    bullet('Amber rows = abatement period rows.'),
    para(bold('Assumptions Block (Rows 5–22, Column C):')),
    para(text('All blue assumption cells drive formulas throughout the workbook. Editing a blue cell in column C will automatically recalculate all dependent formula cells.')),
  ];
}

function buildSection7(metadata, params) {
  const items = [
    heading('7. Fields to Verify Manually'),
    bullet('Square footage (affects Effective $/SF column)'),
    bullet('Abatement end date and percentage'),
    bullet('NNN Year 1 amounts and escalation rates'),
    bullet('One-time charge amounts and dates'),
  ];

  if (metadata.inputPath === 'scan') {
    const flags = metadata.ocrConfidenceFlags ?? [];
    if (flags.length > 0) {
      items.push(para(bold('Additionally, these OCR-flagged fields need review:')));
      flags.forEach((f) => items.push(bullet(f)));
    }
  }

  if (!params.squareFootage) {
    items.push(bullet('Square footage was not provided — Effective $/SF will show $0.'));
  }

  return items;
}

function buildSection8() {
  return [
    heading('8. Formula-Driven vs. Assumption-Driven Values'),
    para(text('The following columns are formula-driven (black text) and will auto-calculate when assumptions change:')),
    bullet('Scheduled Base Rent = $C$8 * (1+$C$9)^(Year#-1)'),
    bullet('Base Rent Applied = abatement logic referencing $C$11 and $C$12'),
    bullet('Abatement = Scheduled Base Rent - Base Rent Applied'),
    bullet('Each charge column = Year 1 amount * (1+esc rate)^(Year#-1), referencing its assumption row pair'),
    bullet('Total NNN = sum of all NNN-type charge columns'),
    bullet('Total Monthly Obligation = Base Rent Applied + Total NNN + Other-type charges + One-Time Charges'),
    bullet('Remaining balance columns = tail-sums of their respective columns'),
    para([bold('Warning: '), text('Do not overwrite formula cells (black text) directly. Edit the blue assumption cells in column C instead.')]),
  ];
}

function buildSection9() {
  return [
    heading('9. Common Correction Scenarios'),
    bullet('"My rent is wrong" -> Edit $C$8 (Year 1 base rent) or $C$9 (escalation rate).'),
    bullet('"Charge amounts are wrong" -> Edit the charge Year 1 and Escalation Rate cells in the assumptions block (rows 13+).'),
    bullet('"Abatement period is wrong" -> Edit $C$11 (full-month count) or $C$12 (partial factor).'),
    bullet('"I need to add a one-time charge" -> Insert a new column after the last one-time column, then update the Total Monthly Obligation formula.'),
    bullet('"My square footage changed" -> Edit $C$5.'),
  ];
}

function buildSection10(rows, params) {
  const items = [heading('10. Notes on Specific Lease Features')];
  let hasContent = false;

  // Abatements
  if (params.abatementEndDate && params.abatementPct > 0) {
    items.push(para(bold('Abatements')));
    items.push(para(text(`The abatement end date (${fmtDate(params.abatementEndDate)}) is the last day of abatement (inclusive). Full rent begins the following day. Rows where the entire period falls within the abatement window are highlighted in amber. Boundary months where abatement ends mid-period are prorated using the partial-month factor.`)));
    hasContent = true;
  }

  // NNN categories
  const charges = params.charges ?? [];
  const nnnCharges = charges.filter((ch) => ch.canonicalType === 'nnn');
  const otherCharges = charges.filter((ch) => ch.canonicalType === 'other');
  const hasNNN = nnnCharges.some((ch) => ch.year1 > 0) ||
    (params.nnnMode === 'aggregate' && params.nnnAggregate?.year1);
  if (hasNNN) {
    const nnnNames = nnnCharges.map((ch) => ch.displayLabel || ch.key).join(', ');
    const otherNames = otherCharges.map((ch) => ch.displayLabel || ch.key).join(', ');
    items.push(para(bold('NNN Categories')));
    items.push(para(text(`Total NNN = ${nnnNames || '(none)'}. Other Charges = ${otherNames || '(none)'}. This distinction affects the NNN Remaining and Other Charges Remaining balance columns.`)));
    hasContent = true;
  }

  // One-time charges
  const ot = params.oneTimeItems ?? [];
  if (ot.length > 0) {
    items.push(para(bold('One-Time Charges')));
    items.push(para(text('One-time charge columns contain blue hard-coded values, not formulas. They appear only on the row matching the charge date. These are not subject to annual escalation.')));
    hasContent = true;
  }

  // Other-type charges note
  if (otherCharges.some((ch) => ch.year1 > 0)) {
    const names = otherCharges.filter((ch) => ch.year1 > 0).map((ch) => ch.displayLabel || ch.key).join(', ');
    items.push(para(bold('Other-Type Charges')));
    items.push(para(text(`${names} are classified as Other Charges, not NNN. They appear in their own columns and are included in the Other Charges Remaining balance.`)));
    hasContent = true;
  }

  if (!hasContent) {
    items.push(para(text('No feature-specific notes for this lease configuration.')));
  }

  return items;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Generate a companion Word document for a processed lease.
 * @param {Array} rows - processedRows from calculateAllCharges
 * @param {Object} params - processedParams from formToCalculatorParams
 * @param {Object} metadata - leaseMetadata assembled in App.jsx
 * @returns {Promise<Blob>} .docx file as a Blob
 */
export async function generateLeaseDoc(rows, params, metadata) {
  const meta = metadata ?? {};

  const sections = [
    // Title
    new Paragraph({
      children: [new TextRun({
        text: `${params.leaseName || 'Lease'} — Review Document`,
        font: FONT, size: 32, bold: true, color: '1F3864',
      })],
      spacing: { after: 40 },
    }),
    para(text(`Generated by DEODATE Lease Schedule Engine on ${new Date().toLocaleDateString('en-US')}`, { italics: true, color: '666666' })),
    para(text('')),

    ...buildSection1(rows, params, meta),
    ...buildSection2(params),
    ...buildSection3(rows, params),
    ...buildSection4(params),
    ...buildSection5(meta),
    ...buildSection6(),
    ...buildSection7(meta, params),
    ...buildSection8(),
    ...buildSection9(),
    ...buildSection10(rows, params),
  ];

  const doc = new Document({
    creator: 'DEODATE Lease Schedule Engine',
    title: `${params.leaseName || 'Lease'} — Review Document`,
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children: sections,
    }],
  });

  return Packer.toBlob(doc);
}
