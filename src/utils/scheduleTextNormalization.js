const DASH_VARIANT_PATTERN = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;

export function normalizeScheduleTextForParsing(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(DASH_VARIANT_PATTERN, '-')
    // Some extracted documents degrade separators into replacement glyphs.
    .replace(/(\d)\s*\uFFFD+\s*(\d)/g, '$1-$2')
    // Canonicalize common textual range separators between numbers.
    .replace(/(\d)\s+(?:to|through)\s+(\d)/gi, '$1-$2')
    // Collapse spaced numeric/date ranges into a single hyphen.
    .replace(/(\d)\s*-\s*(\d)/g, '$1-$2');
}
