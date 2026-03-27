import { addMonthsAnchored, parseMDYStrict } from './yearMonth.js';

export const SCHEDULE_REPRESENTATION_TYPES = {
  DATED_PERIODS: 'dated_periods',
  RELATIVE_MONTH_RANGES: 'relative_month_ranges',
  LEASE_YEAR_RANGES: 'lease_year_ranges',
};

export const SCHEDULE_START_SCOPES = {
  BASE_RENT_START: 'base_rent_start',
  TERM_START: 'term_start',
  RENT_SCHEDULE_ANCHOR: 'rent_schedule_anchor',
  CHARGE_START: 'charge_start',
};

export const SCHEDULE_RULE_KINDS = {
  ABSOLUTE_DATE: 'absolute_date',
  EVENT_DATE: 'event_date',
  EVENT_PLUS_DAYS: 'event_plus_days',
  EVENT_PLUS_MONTHS: 'event_plus_months',
  FIRST_OF_MONTH_ON_OR_AFTER_EVENT: 'first_of_month_on_or_after_event',
  FIRST_FULL_CALENDAR_MONTH_AFTER_EVENT: 'first_full_calendar_month_after_event',
  EARLIER_OF: 'earlier_of',
  LATER_OF: 'later_of',
};

const EVENT_DEFS = [
  { key: 'rent_commencement_date', label: 'Rent Commencement Date', aliases: ['rent commencement date'] },
  { key: 'commencement_date', label: 'Commencement Date', aliases: ['lease commencement date', 'term commencement date', 'commencement date'] },
  { key: 'effective_date', label: 'Effective Date', aliases: ['effective date'] },
  { key: 'execution_date', label: 'Execution Date', aliases: ['execution date'] },
  { key: 'delivery_date', label: 'Delivery Date', aliases: ['delivery date'] },
  { key: 'possession_date', label: 'Possession Date', aliases: ['possession date'] },
  { key: 'opening_date', label: 'Opening Date', aliases: ['opening date'] },
  { key: 'permit_issuance_date', label: 'Permit Issuance Date', aliases: ['permit issuance date', 'permit issue date'] },
  { key: 'substantial_completion_date', label: 'Substantial Completion Date', aliases: ['substantial completion date'] },
];

const MONTH_NAME_TO_NUMBER = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const NAMED_DATE_PATTERN = '(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(\\d{1,2}),\\s*(\\d{4})';
const NUMERIC_DATE_PATTERN = '(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})';
const DATE_CAPTURE_PATTERN = `(?:${NAMED_DATE_PATTERN}|${NUMERIC_DATE_PATTERN})`;
const MONTH_RANGE_PATTERN = /\bmonths?\s+(\d{1,3})(?:\s*(?:-|to|through)\s*(\d{1,3}))?\b[\s\S]{0,80}?\$\s*([\d,]+(?:\.\d{1,2})?)/gi;
const LEASE_YEAR_RANGE_PATTERN = /\b(?:lease\s+)?years?\s+(\d{1,2})(?:\s*(?:-|to|through)\s*(\d{1,2}))?\b[\s\S]{0,80}?\$\s*([\d,]+(?:\.\d{1,2})?)/gi;

function normalizeSearchText(value) {
  return String(value ?? '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .trim()
    .toLowerCase();
}

function escapeRegex(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitDocumentLines(documentText) {
  return String(documentText ?? '')
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildTextWindows(documentText) {
  const lines = splitDocumentLines(documentText);
  const windows = [];

  for (let index = 0; index < lines.length; index += 1) {
    const oneLine = lines[index];
    windows.push({ original: oneLine, normalized: normalizeSearchText(oneLine) });

    if (index < lines.length - 1) {
      const twoLine = `${lines[index]} ${lines[index + 1]}`;
      windows.push({ original: twoLine, normalized: normalizeSearchText(twoLine) });
    }
  }

  return windows;
}

function parseNamedDate(monthName, day, year) {
  const month = MONTH_NAME_TO_NUMBER[String(monthName ?? '').toLowerCase()];
  if (!month) return null;
  const parsed = new Date(Number(year), month - 1, Number(day));
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function parseDateLike(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const cloned = new Date(value);
    cloned.setHours(0, 0, 0, 0);
    return cloned;
  }

  const asString = String(value).trim();
  if (!asString) return null;

  const strict = parseMDYStrict(asString);
  if (strict) return strict;

  const named = asString.match(new RegExp(`^${NAMED_DATE_PATTERN}$`, 'i'));
  if (named) return parseNamedDate(named[1], named[2], named[3]);

  const loose = new Date(asString);
  if (Number.isNaN(loose.getTime())) return null;
  loose.setHours(0, 0, 0, 0);
  return loose;
}

function formatMDY(date) {
  if (!date || Number.isNaN(date.getTime?.())) return null;
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${date.getFullYear()}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfPriorDay(date) {
  return addDays(date, -1);
}

function toMoneyNumber(value) {
  const amount = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

function humanizeEventKey(eventKey) {
  return EVENT_DEFS.find((entry) => entry.key === eventKey)?.label
    ?? String(eventKey ?? '')
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
}

function inferScope(normalizedText) {
  if (/\b(base rent|minimum rent|monthly rent|annual rent|fixed rent|rent shall|rent schedule)\b/.test(normalizedText)) {
    return SCHEDULE_START_SCOPES.BASE_RENT_START;
  }
  if (/\b(lease term|term shall|initial term|commencement of the term)\b/.test(normalizedText)) {
    return SCHEDULE_START_SCOPES.TERM_START;
  }
  if (/\b(cam|common area|operating expense|operating expenses|insurance|tax|additional rent|charge)\b/.test(normalizedText)) {
    return SCHEDULE_START_SCOPES.CHARGE_START;
  }
  return SCHEDULE_START_SCOPES.RENT_SCHEDULE_ANCHOR;
}

function inferStartType(scope) {
  switch (scope) {
    case SCHEDULE_START_SCOPES.TERM_START:
      return 'term_start';
    case SCHEDULE_START_SCOPES.CHARGE_START:
      return 'charge_start';
    default:
      return 'rent_start';
  }
}

function pushUniqueRule(list, rule) {
  if (!rule) return;
  const key = [
    rule.scope,
    rule.ruleKind,
    rule.triggerEvent ?? '',
    rule.resolvedDate ?? '',
    rule.offsetValue ?? '',
    rule.offsetUnit ?? '',
    (rule.compositeRules ?? []).map((entry) => entry.triggerEvent).join('|'),
    normalizeSearchText(rule.sourceText),
  ].join('::');
  if (list.some((entry) => entry._dedupeKey === key)) return;
  list.push({ ...rule, _dedupeKey: key });
}

function stripRuleDedupeKey(rule) {
  if (!rule) return rule;
  const { _dedupeKey, ...rest } = rule;
  return rest;
}

function findMentionedEvents(normalizedText) {
  const mentions = [];

  for (const eventDef of EVENT_DEFS) {
    let bestIndex = Number.POSITIVE_INFINITY;
    for (const alias of eventDef.aliases) {
      const index = normalizedText.indexOf(alias);
      if (index >= 0 && index < bestIndex) bestIndex = index;
    }
    if (bestIndex !== Number.POSITIVE_INFINITY) {
      mentions.push({ key: eventDef.key, index: bestIndex });
    }
  }

  return mentions
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.key);
}

function buildAbsoluteDateRules(windows) {
  const rules = [];

  for (const window of windows) {
    for (const eventDef of EVENT_DEFS) {
      const aliasGroup = eventDef.aliases.map(escapeRegex).join('|');
      const regex = new RegExp(
        `\\b(?:${aliasGroup})\\b[^\\n]{0,60}?(?:shall\\s+be|means|is|:|=|will\\s+be)?\\s*(${DATE_CAPTURE_PATTERN})`,
        'i',
      );
      const match = window.original.match(regex);
      if (!match) continue;

      const resolvedDate = parseDateLike(match[1]);
      if (!resolvedDate) continue;

      const scope = inferScope(window.normalized);
      pushUniqueRule(rules, {
        scope,
        startType: inferStartType(scope),
        triggerEvent: eventDef.key,
        ruleKind: SCHEDULE_RULE_KINDS.ABSOLUTE_DATE,
        offsetValue: null,
        offsetUnit: null,
        resolvedDate: formatMDY(resolvedDate),
        compositeRules: [],
        confidence: 0.96,
        sourceText: window.original,
      });
    }
  }

  return rules;
}

function buildRuleForEventPhrase(window, eventKey, ruleKind, offsetValue = null, offsetUnit = null, confidence = 0.82) {
  const scope = inferScope(window.normalized);
  return {
    scope,
    startType: inferStartType(scope),
    triggerEvent: eventKey,
    ruleKind,
    offsetValue,
    offsetUnit,
    resolvedDate: null,
    compositeRules: [],
    confidence,
    sourceText: window.original,
  };
}

function buildPhraseRules(windows) {
  const rules = [];

  for (const window of windows) {
    for (const eventDef of EVENT_DEFS) {
      const aliasPattern = eventDef.aliases.map(escapeRegex).join('|');

      if (new RegExp(`\\bfirst full calendar month after\\b[\\s\\S]{0,40}?\\b(?:the\\s+)?(?:${aliasPattern})\\b`, 'i').test(window.original)) {
        pushUniqueRule(rules, buildRuleForEventPhrase(
          window,
          eventDef.key,
          SCHEDULE_RULE_KINDS.FIRST_FULL_CALENDAR_MONTH_AFTER_EVENT,
          null,
          null,
          0.9,
        ));
      }

      if (new RegExp(`\\bfirst day of (?:the )?(?:calendar )?month (?:after|following)\\b[\\s\\S]{0,40}?\\b(?:the\\s+)?(?:${aliasPattern})\\b`, 'i').test(window.original)) {
        pushUniqueRule(rules, buildRuleForEventPhrase(
          window,
          eventDef.key,
          SCHEDULE_RULE_KINDS.FIRST_OF_MONTH_ON_OR_AFTER_EVENT,
          null,
          null,
          0.85,
        ));
      }

      const daysAfter = window.original.match(new RegExp(`\\b(\\d{1,3})\\s+days? after\\b[\\s\\S]{0,40}?\\b(?:the\\s+)?(?:${aliasPattern})\\b`, 'i'));
      if (daysAfter) {
        pushUniqueRule(rules, buildRuleForEventPhrase(
          window,
          eventDef.key,
          SCHEDULE_RULE_KINDS.EVENT_PLUS_DAYS,
          Number(daysAfter[1]),
          'days',
          0.84,
        ));
      }

      const monthsAfter = window.original.match(new RegExp(`\\b(\\d{1,2})\\s+months? after\\b[\\s\\S]{0,40}?\\b(?:the\\s+)?(?:${aliasPattern})\\b`, 'i'));
      if (monthsAfter) {
        pushUniqueRule(rules, buildRuleForEventPhrase(
          window,
          eventDef.key,
          SCHEDULE_RULE_KINDS.EVENT_PLUS_MONTHS,
          Number(monthsAfter[1]),
          'months',
          0.84,
        ));
      }

      if (new RegExp(`\\b(?:from and after|upon|commences on|shall commence on|begins on|starting on)\\b[\\s\\S]{0,40}?\\b(?:the\\s+)?(?:${aliasPattern})\\b`, 'i').test(window.original)) {
        pushUniqueRule(rules, buildRuleForEventPhrase(
          window,
          eventDef.key,
          SCHEDULE_RULE_KINDS.EVENT_DATE,
          null,
          null,
          0.8,
        ));
      }
    }

    if (/\blater of\b/i.test(window.original) || /\bearlier of\b/i.test(window.original)) {
      const mentionedEvents = findMentionedEvents(window.normalized);
      if (mentionedEvents.length >= 2) {
        const scope = inferScope(window.normalized);
        pushUniqueRule(rules, {
          scope,
          startType: inferStartType(scope),
          triggerEvent: null,
          ruleKind: /\blater of\b/i.test(window.original)
            ? SCHEDULE_RULE_KINDS.LATER_OF
            : SCHEDULE_RULE_KINDS.EARLIER_OF,
          offsetValue: null,
          offsetUnit: null,
          resolvedDate: null,
          compositeRules: mentionedEvents.slice(0, 2).map((eventKey) => ({ triggerEvent: eventKey })),
          confidence: 0.82,
          sourceText: window.original,
        });
      }
    }
  }

  return rules;
}

export function extractScheduleStartRules(documentText = '') {
  const windows = buildTextWindows(documentText);
  return [
    ...buildAbsoluteDateRules(windows),
    ...buildPhraseRules(windows),
  ].map(stripRuleDedupeKey);
}

function normalizeEventDateMap(eventDates = {}) {
  const normalized = {};

  for (const [eventKey, value] of Object.entries(eventDates ?? {})) {
    const parsed = parseDateLike(value);
    if (!parsed) continue;
    normalized[eventKey] = formatMDY(parsed);
  }

  return normalized;
}

function collectResolvedEventDates(startRules, extractedEventDates = {}) {
  const resolved = normalizeEventDateMap(extractedEventDates);

  for (const rule of startRules) {
    if (rule.ruleKind !== SCHEDULE_RULE_KINDS.ABSOLUTE_DATE || !rule.triggerEvent || !rule.resolvedDate) continue;
    if (!resolved[rule.triggerEvent]) {
      resolved[rule.triggerEvent] = rule.resolvedDate;
    }
  }

  return resolved;
}

function parseInlineAnchorRule(normalizedText, sourceText) {
  if (normalizedText.includes('rent commencement date')) {
    return {
      scope: SCHEDULE_START_SCOPES.BASE_RENT_START,
      startType: inferStartType(SCHEDULE_START_SCOPES.BASE_RENT_START),
      triggerEvent: 'rent_commencement_date',
      ruleKind: SCHEDULE_RULE_KINDS.EVENT_DATE,
      offsetValue: null,
      offsetUnit: null,
      resolvedDate: null,
      compositeRules: [],
      fallbackTriggerEvents: ['commencement_date'],
      confidence: 0.72,
      sourceText,
    };
  }

  if (normalizedText.includes('commencement date')) {
    return {
      scope: SCHEDULE_START_SCOPES.BASE_RENT_START,
      startType: inferStartType(SCHEDULE_START_SCOPES.BASE_RENT_START),
      triggerEvent: 'commencement_date',
      ruleKind: SCHEDULE_RULE_KINDS.EVENT_DATE,
      offsetValue: null,
      offsetUnit: null,
      resolvedDate: null,
      compositeRules: [],
      fallbackTriggerEvents: [],
      confidence: 0.7,
      sourceText,
    };
  }

  return null;
}

function chooseAnchorRule(startRules, sourceText) {
  const normalizedText = normalizeSearchText(sourceText);
  const baseRentRules = (startRules ?? [])
    .filter((rule) => [SCHEDULE_START_SCOPES.BASE_RENT_START, SCHEDULE_START_SCOPES.RENT_SCHEDULE_ANCHOR].includes(rule.scope));
  const prioritizedRules = [...baseRentRules].sort((left, right) => {
    const leftRank = left.ruleKind === SCHEDULE_RULE_KINDS.ABSOLUTE_DATE ? 1 : 0;
    const rightRank = right.ruleKind === SCHEDULE_RULE_KINDS.ABSOLUTE_DATE ? 1 : 0;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return (right.confidence ?? 0) - (left.confidence ?? 0);
  });

  if (prioritizedRules.length > 0) {
    return {
      ...prioritizedRules[0],
      fallbackTriggerEvents: prioritizedRules[0].fallbackTriggerEvents ?? [],
    };
  }

  const inlineRule = parseInlineAnchorRule(normalizedText, sourceText);
  if (inlineRule) return inlineRule;

  return {
    scope: SCHEDULE_START_SCOPES.BASE_RENT_START,
    startType: inferStartType(SCHEDULE_START_SCOPES.BASE_RENT_START),
    triggerEvent: 'rent_commencement_date',
    ruleKind: SCHEDULE_RULE_KINDS.EVENT_DATE,
    offsetValue: null,
    offsetUnit: null,
    resolvedDate: null,
    compositeRules: [],
    fallbackTriggerEvents: ['commencement_date'],
    confidence: 0.58,
    assumptionNote: 'Defaulted the semantic rent schedule anchor to Rent Commencement Date because no clearer base-rent start phrase was detected.',
    sourceText,
  };
}

function buildCandidateSummaryLines(candidate) {
  if (!candidate) return [];

  if (candidate.representationType === SCHEDULE_REPRESENTATION_TYPES.RELATIVE_MONTH_RANGES) {
    return candidate.terms.map((term) =>
      `Months ${term.startMonth}-${term.endMonth}: $${term.monthlyRent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} monthly`,
    );
  }

  if (candidate.representationType === SCHEDULE_REPRESENTATION_TYPES.LEASE_YEAR_RANGES) {
    return candidate.terms.map((term) =>
      `Lease Years ${term.startYear}-${term.endYear}: $${term.monthlyRent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} monthly`,
    );
  }

  if (candidate.representationType === SCHEDULE_REPRESENTATION_TYPES.DATED_PERIODS) {
    return candidate.terms.map((term) =>
      `${term.periodStart} through ${term.periodEnd}: $${term.monthlyRent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} monthly`,
    );
  }

  return [];
}

function extractCandidateTerms(documentText, pattern, type) {
  const terms = [];
  const windows = buildTextWindows(documentText);
  const seen = new Set();

  for (const window of windows) {
    pattern.lastIndex = 0;
    let match = pattern.exec(window.original);

    while (match) {
      const startValue = Number(match[1]);
      const endValue = Number(match[2] ?? match[1]);
      const monthlyRent = toMoneyNumber(match[3]);
      if (Number.isInteger(startValue) && Number.isInteger(endValue) && endValue >= startValue && monthlyRent != null) {
        const dedupeKey = `${type}:${startValue}:${endValue}:${monthlyRent}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          terms.push(
            type === SCHEDULE_REPRESENTATION_TYPES.LEASE_YEAR_RANGES
              ? {
                  startYear: startValue,
                  endYear: endValue,
                  monthlyRent,
                  sourceText: window.original,
                }
              : {
                  startMonth: startValue,
                  endMonth: endValue,
                  monthlyRent,
                  sourceText: window.original,
                },
          );
        }
      }

      match = pattern.exec(window.original);
    }
  }

  return terms;
}

function buildDatedPeriodCandidate(existingRentSchedule = []) {
  if (!Array.isArray(existingRentSchedule) || existingRentSchedule.length === 0) return null;

  return {
    id: 'dated_periods_1',
    scope: 'base_rent',
    representationType: SCHEDULE_REPRESENTATION_TYPES.DATED_PERIODS,
    terms: existingRentSchedule.map((term) => ({
      periodStart: term.periodStart,
      periodEnd: term.periodEnd,
      monthlyRent: Number(term.monthlyRent),
      sourceText: `${term.periodStart} through ${term.periodEnd}`,
    })),
    anchorRule: null,
    confidence: 0.95,
  };
}

function buildRelativeMonthCandidate(documentText, startRules) {
  const terms = extractCandidateTerms(documentText, MONTH_RANGE_PATTERN, SCHEDULE_REPRESENTATION_TYPES.RELATIVE_MONTH_RANGES)
    .sort((left, right) => left.startMonth - right.startMonth);

  if (terms.length === 0) return null;

  return {
    id: 'relative_month_ranges_1',
    scope: 'base_rent',
    representationType: SCHEDULE_REPRESENTATION_TYPES.RELATIVE_MONTH_RANGES,
    terms,
    anchorRule: chooseAnchorRule(startRules, terms[0]?.sourceText ?? documentText),
    confidence: 0.87,
  };
}

function buildLeaseYearCandidate(documentText, startRules) {
  const terms = extractCandidateTerms(documentText, LEASE_YEAR_RANGE_PATTERN, SCHEDULE_REPRESENTATION_TYPES.LEASE_YEAR_RANGES)
    .sort((left, right) => left.startYear - right.startYear);

  if (terms.length === 0) return null;

  return {
    id: 'lease_year_ranges_1',
    scope: 'base_rent',
    representationType: SCHEDULE_REPRESENTATION_TYPES.LEASE_YEAR_RANGES,
    terms,
    anchorRule: chooseAnchorRule(startRules, terms[0]?.sourceText ?? documentText),
    confidence: 0.83,
  };
}

function toDateObjectMap(eventDates = {}) {
  const mapped = {};
  for (const [eventKey, value] of Object.entries(eventDates ?? {})) {
    const parsed = parseDateLike(value);
    if (!parsed) continue;
    mapped[eventKey] = parsed;
  }
  return mapped;
}

function resolveRuleDate(rule, eventDates) {
  const unresolvedDependencies = [];

  if (!rule) return { anchorDate: null, unresolvedDependencies };

  if (rule.ruleKind === SCHEDULE_RULE_KINDS.ABSOLUTE_DATE) {
    const resolved = parseDateLike(rule.resolvedDate);
    return { anchorDate: resolved, unresolvedDependencies: resolved ? [] : [rule.triggerEvent].filter(Boolean) };
  }

  const resolveEventDate = (eventKey) => {
    if (!eventKey) return null;
    const resolved = eventDates[eventKey];
    if (!resolved) unresolvedDependencies.push(eventKey);
    return resolved ?? null;
  };

  const primaryEventDate = resolveEventDate(rule.triggerEvent);
  let eventDate = primaryEventDate;

  if (!eventDate && Array.isArray(rule.fallbackTriggerEvents)) {
    for (const fallbackKey of rule.fallbackTriggerEvents) {
      const fallbackDate = resolveEventDate(fallbackKey);
      if (fallbackDate) {
        eventDate = fallbackDate;
        break;
      }
    }
  }

  if (rule.ruleKind === SCHEDULE_RULE_KINDS.EVENT_DATE) {
    return { anchorDate: eventDate, unresolvedDependencies };
  }

  if (rule.ruleKind === SCHEDULE_RULE_KINDS.EVENT_PLUS_DAYS) {
    return { anchorDate: eventDate ? addDays(eventDate, Number(rule.offsetValue) || 0) : null, unresolvedDependencies };
  }

  if (rule.ruleKind === SCHEDULE_RULE_KINDS.EVENT_PLUS_MONTHS) {
    return { anchorDate: eventDate ? addMonthsAnchored(eventDate, Number(rule.offsetValue) || 0) : null, unresolvedDependencies };
  }

  if (rule.ruleKind === SCHEDULE_RULE_KINDS.FIRST_OF_MONTH_ON_OR_AFTER_EVENT) {
    if (!eventDate) return { anchorDate: null, unresolvedDependencies };
    const anchorDate = eventDate.getDate() === 1
      ? new Date(eventDate.getFullYear(), eventDate.getMonth(), 1)
      : new Date(eventDate.getFullYear(), eventDate.getMonth() + 1, 1);
    anchorDate.setHours(0, 0, 0, 0);
    return { anchorDate, unresolvedDependencies };
  }

  if (rule.ruleKind === SCHEDULE_RULE_KINDS.FIRST_FULL_CALENDAR_MONTH_AFTER_EVENT) {
    if (!eventDate) return { anchorDate: null, unresolvedDependencies };
    const anchorDate = new Date(eventDate.getFullYear(), eventDate.getMonth() + 1, 1);
    anchorDate.setHours(0, 0, 0, 0);
    return { anchorDate, unresolvedDependencies };
  }

  if ([SCHEDULE_RULE_KINDS.EARLIER_OF, SCHEDULE_RULE_KINDS.LATER_OF].includes(rule.ruleKind)) {
    const resolvedDates = (rule.compositeRules ?? [])
      .map((entry) => resolveEventDate(entry.triggerEvent))
      .filter(Boolean);
    if (resolvedDates.length === 0) return { anchorDate: null, unresolvedDependencies };

    const sorted = [...resolvedDates].sort((left, right) => left.getTime() - right.getTime());
    return {
      anchorDate: rule.ruleKind === SCHEDULE_RULE_KINDS.EARLIER_OF ? sorted[0] : sorted[sorted.length - 1],
      unresolvedDependencies,
    };
  }

  return { anchorDate: null, unresolvedDependencies };
}

function materializeDatedPeriods(candidate) {
  const periodRows = candidate.terms
    .map((term) => ({
      periodStart: parseDateLike(term.periodStart),
      periodEnd: parseDateLike(term.periodEnd),
      monthlyRent: Number(term.monthlyRent),
    }))
    .filter((term) => term.periodStart && term.periodEnd && Number.isFinite(term.monthlyRent));

  return {
    periodRows,
    anchorDate: periodRows[0]?.periodStart ?? null,
    unresolvedDependencies: [],
  };
}

function materializeRelativeTerms(candidate, contextDates, termMapper) {
  const explicitBaseRentStart = parseDateLike(contextDates.base_rent_start_date ?? contextDates.schedule_anchor_date);
  const eventDates = toDateObjectMap(contextDates);
  const ruleResolution = explicitBaseRentStart
    ? { anchorDate: explicitBaseRentStart, unresolvedDependencies: [] }
    : resolveRuleDate(candidate.anchorRule, eventDates);

  if (!ruleResolution.anchorDate) {
    return {
      periodRows: [],
      anchorDate: null,
      unresolvedDependencies: Array.from(new Set(ruleResolution.unresolvedDependencies)),
    };
  }

  const periodRows = [];

  for (const term of candidate.terms) {
    const mapped = termMapper(term);
    if (!mapped) continue;
    const { startMonth, endMonth, monthlyRent } = mapped;
    const periodStart = addMonthsAnchored(ruleResolution.anchorDate, startMonth - 1);
    const periodEnd = endOfPriorDay(addMonthsAnchored(ruleResolution.anchorDate, endMonth));
    periodRows.push({ periodStart, periodEnd, monthlyRent });
  }

  return {
    periodRows,
    anchorDate: ruleResolution.anchorDate,
    unresolvedDependencies: Array.from(new Set(ruleResolution.unresolvedDependencies)),
  };
}

export function materializeScheduleCandidate(candidate, contextDates = {}) {
  if (!candidate) {
    return {
      periodRows: [],
      anchorDate: null,
      unresolvedDependencies: [],
    };
  }

  if (candidate.representationType === SCHEDULE_REPRESENTATION_TYPES.DATED_PERIODS) {
    return materializeDatedPeriods(candidate);
  }

  if (candidate.representationType === SCHEDULE_REPRESENTATION_TYPES.RELATIVE_MONTH_RANGES) {
    return materializeRelativeTerms(candidate, contextDates, (term) => ({
      startMonth: term.startMonth,
      endMonth: term.endMonth,
      monthlyRent: term.monthlyRent,
    }));
  }

  if (candidate.representationType === SCHEDULE_REPRESENTATION_TYPES.LEASE_YEAR_RANGES) {
    return materializeRelativeTerms(candidate, contextDates, (term) => ({
      startMonth: ((term.startYear - 1) * 12) + 1,
      endMonth: term.endYear * 12,
      monthlyRent: term.monthlyRent,
    }));
  }

  return {
    periodRows: [],
    anchorDate: null,
    unresolvedDependencies: [],
  };
}

function candidateScore(candidate, contextDates) {
  const materialized = materializeScheduleCandidate(candidate, contextDates);
  let score = candidate.confidence ?? 0.5;
  if (materialized.periodRows.length > 0) score += 0.05;
  if (materialized.unresolvedDependencies.length > 0) score -= Math.min(0.12, materialized.unresolvedDependencies.length * 0.04);
  return score;
}

function selectPreferredCandidate(candidates, contextDates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  return [...candidates]
    .sort((left, right) => candidateScore(right, contextDates) - candidateScore(left, contextDates))[0];
}

function buildStartRuleSummaries(preferredCandidate, materialization, resolvedEventDates) {
  const summaries = [];
  if (!preferredCandidate) return summaries;

  if (materialization.anchorDate) {
    summaries.push(`Base-rent anchor resolved to ${formatMDY(materialization.anchorDate)}.`);
  }

  if (preferredCandidate.anchorRule?.ruleKind === SCHEDULE_RULE_KINDS.FIRST_FULL_CALENDAR_MONTH_AFTER_EVENT) {
    summaries.push(`Base rent starts on the first full calendar month after the ${humanizeEventKey(preferredCandidate.anchorRule.triggerEvent)}.`);
  } else if (preferredCandidate.anchorRule?.ruleKind === SCHEDULE_RULE_KINDS.FIRST_OF_MONTH_ON_OR_AFTER_EVENT) {
    summaries.push(`Base rent starts on the first day of the month after the ${humanizeEventKey(preferredCandidate.anchorRule.triggerEvent)}.`);
  } else if (preferredCandidate.anchorRule?.ruleKind === SCHEDULE_RULE_KINDS.EVENT_PLUS_DAYS) {
    summaries.push(`Base rent starts ${preferredCandidate.anchorRule.offsetValue} day(s) after the ${humanizeEventKey(preferredCandidate.anchorRule.triggerEvent)}.`);
  } else if (preferredCandidate.anchorRule?.ruleKind === SCHEDULE_RULE_KINDS.EVENT_PLUS_MONTHS) {
    summaries.push(`Base rent starts ${preferredCandidate.anchorRule.offsetValue} month(s) after the ${humanizeEventKey(preferredCandidate.anchorRule.triggerEvent)}.`);
  } else if (preferredCandidate.anchorRule?.ruleKind === SCHEDULE_RULE_KINDS.LATER_OF) {
    const labels = (preferredCandidate.anchorRule.compositeRules ?? []).map((entry) => humanizeEventKey(entry.triggerEvent));
    summaries.push(`Base rent starts on the later of ${labels.join(' and ')}.`);
  } else if (preferredCandidate.anchorRule?.ruleKind === SCHEDULE_RULE_KINDS.EARLIER_OF) {
    const labels = (preferredCandidate.anchorRule.compositeRules ?? []).map((entry) => humanizeEventKey(entry.triggerEvent));
    summaries.push(`Base rent starts on the earlier of ${labels.join(' and ')}.`);
  } else if (preferredCandidate.anchorRule?.triggerEvent) {
    summaries.push(`Base rent is anchored to the ${humanizeEventKey(preferredCandidate.anchorRule.triggerEvent)}.`);
  }

  for (const [eventKey, value] of Object.entries(resolvedEventDates ?? {})) {
    if (!value) continue;
    if (summaries.length >= 4) break;
    summaries.push(`${humanizeEventKey(eventKey)} detected as ${value}.`);
  }

  return Array.from(new Set(summaries));
}

function buildUserGuidance(preferredCandidate, materialization) {
  if (!preferredCandidate) return null;

  if (materialization.periodRows.length > 0 && preferredCandidate.representationType !== SCHEDULE_REPRESENTATION_TYPES.DATED_PERIODS) {
    return 'Detected semantic rent terms were materialized into dated periods. Updating Rent Commencement Date will re-anchor the base-rent schedule.';
  }

  if (materialization.periodRows.length === 0 && preferredCandidate.representationType !== SCHEDULE_REPRESENTATION_TYPES.DATED_PERIODS) {
    return 'A semantic rent schedule was detected, but a base-rent anchor date is still needed. Enter Rent Commencement Date to materialize the dated schedule.';
  }

  return 'Rent schedule loaded as explicit dated periods.';
}

function toDerivedRentSchedule(periodRows = []) {
  return periodRows.map((row) => ({
    periodStart: formatMDY(row.periodStart),
    periodEnd: formatMDY(row.periodEnd),
    monthlyRent: row.monthlyRent,
  }));
}

export function analyzeScheduleSemantics({
  documentText = '',
  existingRentSchedule = [],
  extractedEventDates = {},
} = {}) {
  const startRules = extractScheduleStartRules(documentText);
  const resolvedEventDates = collectResolvedEventDates(startRules, extractedEventDates);
  const candidates = [
    buildDatedPeriodCandidate(existingRentSchedule),
    buildRelativeMonthCandidate(documentText, startRules),
    buildLeaseYearCandidate(documentText, startRules),
  ].filter(Boolean);

  const preferredCandidate = selectPreferredCandidate(candidates, resolvedEventDates);
  const materialization = materializeScheduleCandidate(preferredCandidate, resolvedEventDates);

  return {
    startRules,
    candidates,
    preferredCandidateId: preferredCandidate?.id ?? null,
    preferredRepresentationType: preferredCandidate?.representationType ?? null,
    resolvedEventDates,
    preferredPeriodRows: materialization.periodRows,
    derivedRentSchedule: toDerivedRentSchedule(materialization.periodRows),
    preferredAnchorDate: formatMDY(materialization.anchorDate),
    unresolvedDependencies: Array.from(new Set(materialization.unresolvedDependencies)),
    materializationStatus: preferredCandidate
      ? (materialization.periodRows.length > 0 ? 'resolved' : 'needs_anchor')
      : 'none',
    summaryLines: buildCandidateSummaryLines(preferredCandidate),
    startRuleSummaries: buildStartRuleSummaries(preferredCandidate, materialization, resolvedEventDates),
    userGuidance: buildUserGuidance(preferredCandidate, materialization),
  };
}

export function materializeScheduleSemantics(analysis, contextDates = {}) {
  if (!analysis) return null;

  const resolvedEventDates = {
    ...normalizeEventDateMap(analysis.resolvedEventDates),
    ...normalizeEventDateMap(contextDates),
  };
  const candidates = Array.isArray(analysis.candidates) ? analysis.candidates : [];
  const preferredCandidate = candidates.find((candidate) => candidate.id === analysis.preferredCandidateId)
    ?? selectPreferredCandidate(candidates, resolvedEventDates);
  const materialization = materializeScheduleCandidate(preferredCandidate, {
    ...resolvedEventDates,
    ...contextDates,
  });

  return {
    ...analysis,
    preferredCandidateId: preferredCandidate?.id ?? null,
    preferredRepresentationType: preferredCandidate?.representationType ?? null,
    resolvedEventDates,
    preferredPeriodRows: materialization.periodRows,
    derivedRentSchedule: toDerivedRentSchedule(materialization.periodRows),
    preferredAnchorDate: formatMDY(materialization.anchorDate),
    unresolvedDependencies: Array.from(new Set(materialization.unresolvedDependencies)),
    materializationStatus: preferredCandidate
      ? (materialization.periodRows.length > 0 ? 'resolved' : 'needs_anchor')
      : 'none',
    summaryLines: buildCandidateSummaryLines(preferredCandidate),
    startRuleSummaries: buildStartRuleSummaries(preferredCandidate, materialization, resolvedEventDates),
    userGuidance: buildUserGuidance(preferredCandidate, materialization),
  };
}
