import XLSX from 'xlsx-js-style';
import Papa from 'papaparse';
import { strFromU8, unzipSync } from 'fflate';

function decodeXmlEntities(value) {
  return String(value ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeLineBreaks(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeTextBuffer(buffer) {
  return normalizeLineBreaks(new TextDecoder('utf-8').decode(buffer));
}

function flattenWorkbookSheet(sheet, sheetName) {
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });

  const body = rows
    .map((row) => (Array.isArray(row) ? row : []))
    .map((row) => row.map((cell) => String(cell ?? '').trim()).join('\t').trim())
    .filter(Boolean)
    .join('\n');

  return body ? `Sheet: ${sheetName}\n${body}` : '';
}

export function extractWorkbookText(buffer) {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheetTexts = (workbook.SheetNames ?? [])
    .map((sheetName) => flattenWorkbookSheet(workbook.Sheets[sheetName], sheetName))
    .filter(Boolean);

  return normalizeLineBreaks(sheetTexts.join('\n\n'));
}

export function extractCsvText(buffer) {
  const text = decodeTextBuffer(buffer);
  const parsed = Papa.parse(text, { skipEmptyLines: false });
  if (parsed.errors?.length > 0) {
    return text;
  }

  return normalizeLineBreaks(
    (parsed.data ?? [])
      .map((row) => (Array.isArray(row) ? row : []))
      .map((row) => row.join('\t').trim())
      .filter(Boolean)
      .join('\n'),
  );
}

export function extractDocxText(buffer) {
  const archive = unzipSync(new Uint8Array(buffer));
  const xmlParts = Object.entries(archive)
    .filter(([name]) => /^word\/(document|header\d+|footer\d+)\.xml$/i.test(name))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, data]) => strFromU8(data));

  if (xmlParts.length === 0) return '';

  const paragraphs = [];

  for (const xml of xmlParts) {
    const text = xml
      .replace(/<\/w:p>/g, '\n')
      .replace(/<\/w:tr>/g, '\n')
      .replace(/<w:tab[^>]*\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .split('\n')
      .map((line) => decodeXmlEntities(line).replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean);

    paragraphs.push(...text);
  }

  return normalizeLineBreaks(paragraphs.join('\n'));
}

export function extractDocumentTextFromBuffer(buffer, ext) {
  switch (String(ext ?? '').toLowerCase()) {
    case 'txt':
      return decodeTextBuffer(buffer);
    case 'csv':
      return extractCsvText(buffer);
    case 'xlsx':
    case 'xls':
      return extractWorkbookText(buffer);
    case 'docx':
      return extractDocxText(buffer);
    default:
      return '';
  }
}

export async function extractDocumentTextFromFile(file) {
  const ext = String(file?.name ?? '').split('.').pop()?.toLowerCase() ?? '';
  const buffer = await file.arrayBuffer();
  return {
    ext,
    buffer,
    text: extractDocumentTextFromBuffer(buffer, ext),
  };
}
