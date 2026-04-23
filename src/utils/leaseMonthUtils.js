import {
  addMonthsAnchored,
  countMonthsInclusive,
  parseISODate,
  parseMDYStrict,
} from '../engine/yearMonth.js';

export function parseLeaseMonthDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const normalized = new Date(value);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
  }

  const asString = String(value).trim();
  if (!asString) return null;

  return parseISODate(asString) ?? parseMDYStrict(asString) ?? null;
}

export function getLeaseStartDate(periodRows = []) {
  return periodRows.reduce((earliest, row) => {
    const candidate = parseLeaseMonthDate(row?.periodStart ?? row?.date ?? row?.startDate ?? row?.start);
    if (!candidate) return earliest;
    if (!earliest || candidate.getTime() < earliest.getTime()) return candidate;
    return earliest;
  }, null);
}

export function getLeaseMonthNumber(leaseStartLike, periodStartLike) {
  const leaseStart = parseLeaseMonthDate(leaseStartLike);
  const periodStart = parseLeaseMonthDate(periodStartLike);
  if (!leaseStart || !periodStart || periodStart.getTime() < leaseStart.getTime()) return null;
  return countMonthsInclusive(leaseStart, periodStart);
}

export function getLeaseMonthRange(leaseStartLike, periodStartLike, periodEndLike) {
  const startMonthNumber = getLeaseMonthNumber(leaseStartLike, periodStartLike);
  const endMonthNumber = getLeaseMonthNumber(leaseStartLike, periodEndLike);
  return {
    startMonthNumber,
    endMonthNumber,
  };
}

export function getLeaseMonthStartDate(leaseStartLike, monthNumber) {
  const leaseStart = parseLeaseMonthDate(leaseStartLike);
  const normalizedMonthNumber = Number(monthNumber);
  if (!leaseStart || !Number.isInteger(normalizedMonthNumber) || normalizedMonthNumber <= 0) {
    return null;
  }

  return addMonthsAnchored(leaseStart, normalizedMonthNumber - 1);
}

export function getLeaseMonthEndDate(leaseStartLike, monthNumber) {
  const monthStart = getLeaseMonthStartDate(leaseStartLike, monthNumber);
  if (!monthStart) return null;

  const monthEnd = new Date(addMonthsAnchored(monthStart, 1).getTime() - 86400000);
  monthEnd.setHours(0, 0, 0, 0);
  return monthEnd;
}

export function formatLeaseMonthLabel(monthNumber) {
  return Number.isInteger(monthNumber) && monthNumber > 0 ? `Month ${monthNumber}` : '';
}

export function formatLeaseMonthRange(range) {
  if (!range) return '';
  const { startMonthNumber, endMonthNumber } = range;
  if (Number.isInteger(startMonthNumber) && Number.isInteger(endMonthNumber)) {
    return startMonthNumber === endMonthNumber
      ? String(startMonthNumber)
      : `${startMonthNumber}-${endMonthNumber}`;
  }
  if (Number.isInteger(startMonthNumber)) return String(startMonthNumber);
  return '';
}
