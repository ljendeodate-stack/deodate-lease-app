import { describe, expect, it } from 'vitest';
import XLSX from 'xlsx-js-style';
import { strToU8, zipSync } from 'fflate';

import {
  extractCsvText,
  extractDocxText,
  extractDocumentTextFromBuffer,
  extractWorkbookText,
} from './documentText.js';

describe('documentText extraction', () => {
  it('flattens workbook text for hybrid sheet extraction', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Period Start', 'Period End', 'Monthly Rent'],
      ['01/01/2025', '12/31/2025', '10000'],
      ['Notes', '', 'Rent escalates 2% every two years'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Schedule');
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });

    const text = extractWorkbookText(buffer);

    expect(text).toContain('Sheet: Schedule');
    expect(text).toContain('Period Start\tPeriod End\tMonthly Rent');
    expect(text).toContain('Rent escalates 2% every two years');
  });

  it('extracts text from a DOCX document body', () => {
    const archive = zipSync({
      'word/document.xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8"?>'
        + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        + '<w:body>'
        + '<w:p><w:r><w:t>Lease term 01/01/2025-01/01/2035</w:t></w:r></w:p>'
        + '<w:p><w:r><w:t>Rent 10000 month, escalated 2% every two years</w:t></w:r></w:p>'
        + '</w:body></w:document>',
      ),
    });

    const text = extractDocxText(archive.buffer);

    expect(text).toContain('Lease term 01/01/2025-01/01/2035');
    expect(text).toContain('Rent 10000 month, escalated 2% every two years');
  });

  it('routes txt and csv buffers through text extraction', () => {
    const txtBuffer = new TextEncoder().encode('NNN escalate 2.5% every year, amt 10000').buffer;
    const csvBuffer = new TextEncoder().encode('col1,col2\nlease term,01/01/2025-01/01/2035').buffer;

    expect(extractDocumentTextFromBuffer(txtBuffer, 'txt')).toContain('NNN escalate 2.5% every year');
    expect(extractCsvText(csvBuffer)).toContain('lease term\t01/01/2025-01/01/2035');
  });
});
