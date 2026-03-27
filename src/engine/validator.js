/**
 * @fileoverview Parameter and schedule validation.
 */

import { parseMDYStrict, parseISODate } from './yearMonth.js';
import { EXPENSE_CATEGORY_DEFS } from './labelClassifier.js';
import {
  CONCESSION_SCOPES,
  CONCESSION_VALUE_MODES,
  RECURRING_OVERRIDE_TARGETS,
  resolveMonthlyRowIndex,
} from './leaseTerms.js';

const STANDARD_CHARGE_KEYS = ['cams', 'insurance', 'taxes', 'security', 'otherItems'];

function parseLooseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = parseISODate(value);
    if (!parsed) return null;
    const [year, month, day] = value.split('-').map(Number);
    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      return null;
    }
    return parsed;
  }
  return parseMDYStrict(value);
}

function pushIssue(list, field, message, severity) {
  list.push({ field, message, severity });
}

function getLeaseBounds(rows) {
  if (!rows?.length) return { leaseStart: null, leaseEnd: null };
  return {
    leaseStart: parseISODate(rows[0].date ?? rows[0].periodStart),
    leaseEnd: parseISODate(rows[rows.length - 1].periodEnd ?? rows[rows.length - 1].date),
  };
}

function getChargeValidationEntries(params) {
  if (Array.isArray(params.charges) && params.charges.length > 0) {
    return params.charges.map((charge, index) => ({
      key: charge.key,
      label: charge.displayLabel || EXPENSE_CATEGORY_DEFS[charge.key]?.displayLabel || charge.key,
      fieldPrefix: `charges.${index}`,
      value: charge,
    }));
  }

  return STANDARD_CHARGE_KEYS
    .filter((key) => params[key])
    .map((key) => ({
      key,
      label: EXPENSE_CATEGORY_DEFS[key]?.displayLabel || key,
      fieldPrefix: key,
      value: params[key],
    }));
}

function getRecurringOverrideTargets(params) {
  const targets = new Map([
    [RECURRING_OVERRIDE_TARGETS.BASE_RENT, 'Base Rent'],
  ]);

  if ((params.nnnMode ?? 'individual') === 'aggregate') {
    targets.set(RECURRING_OVERRIDE_TARGETS.NNN_AGGREGATE, 'NNN - Aggregate');
  }

  if (Array.isArray(params.charges) && params.charges.length > 0) {
    params.charges.forEach((charge) => {
      if (!charge?.key) return;
      if ((params.nnnMode ?? 'individual') === 'aggregate' && charge.canonicalType === 'nnn') return;
      targets.set(charge.key, charge.displayLabel || charge.key);
    });
    return targets;
  }

  STANDARD_CHARGE_KEYS.forEach((key) => {
    targets.set(key, EXPENSE_CATEGORY_DEFS[key]?.displayLabel || key);
  });

  return targets;
}

function validateConcessionEvents(params, rows, errors, warnings) {
  const { leaseStart, leaseEnd } = getLeaseBounds(rows);
  const rowAssignments = new Map();

  const validateDatedEvent = (event, index, type) => {
    const fieldBase = `${type}.${index}`;
    const label = type === 'freeRentEvents' ? 'Free-rent event' : 'Abatement event';
    const date = parseLooseDate(event?.date);

    if (!event?.date || !String(event.date).trim()) {
      pushIssue(errors, `${fieldBase}.date`, `${label} date is required.`, 'error');
      return;
    }
    if (!date) {
      pushIssue(errors, `${fieldBase}.date`, `${label} date must be in MM/DD/YYYY format.`, 'error');
      return;
    }

    if (leaseStart && leaseEnd && (date < leaseStart || date > leaseEnd)) {
      pushIssue(
        warnings,
        `${fieldBase}.date`,
        `${label} date falls outside the resolved lease term and will snap to the nearest schedule row.`,
        'warning',
      );
    }

    const rowIndex = resolveMonthlyRowIndex(rows, date);
    if (rowIndex >= 0) {
      const existing = rowAssignments.get(rowIndex);
      if (existing) {
        pushIssue(
          errors,
          `${fieldBase}.date`,
          `${label} resolves to the same monthly row as ${existing}. Use one concession event per monthly row.`,
          'error',
        );
      } else {
        rowAssignments.set(rowIndex, label.toLowerCase());
      }
    }

    if (type !== 'abatementEvents') return;

    const value = Number(event?.value);
    if (event?.value === '' || event?.value === undefined || event?.value === null) {
      pushIssue(errors, `${fieldBase}.value`, 'Abatement percentage is required.', 'error');
      return;
    }
    if (!Number.isFinite(value)) {
      pushIssue(errors, `${fieldBase}.value`, 'Abatement percentage must be a number.', 'error');
      return;
    }

    const valueMode = event?.valueMode === CONCESSION_VALUE_MODES.FIXED_AMOUNT
      ? CONCESSION_VALUE_MODES.FIXED_AMOUNT
      : CONCESSION_VALUE_MODES.PERCENT;

    if (valueMode === CONCESSION_VALUE_MODES.PERCENT && (value < 0 || value > 100)) {
      pushIssue(errors, `${fieldBase}.value`, 'Abatement percentage must be between 0 and 100.', 'error');
    }
  };

  (params.freeRentEvents ?? []).forEach((event, index) => validateDatedEvent(event, index, 'freeRentEvents'));
  (params.abatementEvents ?? []).forEach((event, index) => validateDatedEvent(event, index, 'abatementEvents'));

  (params.legacyConcessionEvents ?? []).forEach((event, index) => {
    const fieldBase = `legacyConcessionEvents.${index}`;
    const scope = event?.scope === CONCESSION_SCOPES.MONTHLY_ROW
      ? CONCESSION_SCOPES.MONTHLY_ROW
      : CONCESSION_SCOPES.LEGACY_WINDOW;

    if (scope === CONCESSION_SCOPES.MONTHLY_ROW) {
      const date = parseLooseDate(event?.effectiveDate ?? event?.date);
      if (!date) {
        pushIssue(errors, `${fieldBase}.effectiveDate`, 'Imported concession event date is invalid.', 'error');
      }
      return;
    }

    const startDate = parseLooseDate(event?.startDate);
    const endDate = parseLooseDate(event?.endDate);
    if (!startDate || !endDate) {
      pushIssue(errors, `${fieldBase}.startDate`, 'Imported legacy concession window must have valid start and end dates.', 'error');
      return;
    }
    if (endDate < startDate) {
      pushIssue(errors, `${fieldBase}.endDate`, 'Imported legacy concession window cannot end before it starts.', 'error');
    }
  });

  const abDate = parseLooseDate(params.abatementEndDate);
  if (params.abatementEndDate && !abDate) {
    pushIssue(errors, 'abatementEndDate', 'Abatement end date must be in MM/DD/YYYY format.', 'error');
  }

  if (params.abatementPct !== '' && params.abatementPct !== undefined) {
    const pct = Number(params.abatementPct);
    if (Number.isNaN(pct)) {
      pushIssue(errors, 'abatementPct', 'Abatement percentage must be a number.', 'error');
    } else if (pct < 0 || pct > 100) {
      pushIssue(errors, 'abatementPct', 'Abatement percentage must be between 0 and 100.', 'error');
    }
  }
}

function validateRecurringOverrides(params, rows, errors, warnings) {
  const { leaseStart, leaseEnd } = getLeaseBounds(rows);
  const validTargets = getRecurringOverrideTargets(params);
  const rowAssignments = new Map();

  (params.recurringOverrides ?? []).forEach((override, index) => {
    const fieldBase = `recurringOverrides.${index}`;
    const targetKey = String(override?.targetKey || '');
    const targetLabel = validTargets.get(targetKey) ?? 'Recurring override';

    if (!targetKey) {
      pushIssue(errors, `${fieldBase}.targetKey`, 'Recurring override target is required.', 'error');
      return;
    }
    if (!validTargets.has(targetKey)) {
      pushIssue(errors, `${fieldBase}.targetKey`, 'Recurring override target is not available for the current recurring setup.', 'error');
    }

    if (!override?.date || !String(override.date).trim()) {
      pushIssue(errors, `${fieldBase}.date`, 'Recurring override date is required.', 'error');
      return;
    }

    const date = parseLooseDate(override.date);
    if (!date) {
      pushIssue(errors, `${fieldBase}.date`, 'Recurring override date must be in MM/DD/YYYY format.', 'error');
      return;
    }

    if (leaseStart && leaseEnd && (date < leaseStart || date > leaseEnd)) {
      pushIssue(
        warnings,
        `${fieldBase}.date`,
        `${targetLabel} override date falls outside the resolved lease term and will snap to the nearest schedule row.`,
        'warning',
      );
    }

    const rowIndex = resolveMonthlyRowIndex(rows, date);
    if (rowIndex >= 0) {
      const assignmentKey = `${targetKey}:${rowIndex}`;
      if (rowAssignments.has(assignmentKey)) {
        pushIssue(
          errors,
          `${fieldBase}.date`,
          `${targetLabel} already has an override on that monthly row. Use one override per target per monthly row.`,
          'error',
        );
      } else {
        rowAssignments.set(assignmentKey, true);
      }
    }

    if (override?.amount === '' || override?.amount === undefined || override?.amount === null) {
      pushIssue(errors, `${fieldBase}.amount`, 'Recurring override monthly amount is required.', 'error');
      return;
    }

    const amount = Number(override.amount);
    if (!Number.isFinite(amount)) {
      pushIssue(errors, `${fieldBase}.amount`, 'Recurring override monthly amount must be a number.', 'error');
      return;
    }
    if (amount < 0) {
      pushIssue(errors, `${fieldBase}.amount`, 'Recurring override monthly amount cannot be negative.', 'error');
    }
  });
}

export function validateParams(params, rows) {
  const errors = [];
  const warnings = [];

  const sf = Number(params.squareFootage);
  if (!params.squareFootage || Number.isNaN(sf) || sf <= 0) {
    if (params.sfRequired) {
      pushIssue(
        errors,
        'squareFootage',
        'Square footage is required because the lease expresses rent as $/SF. Enter the rentable area to derive monthly dollar amounts.',
        'error',
      );
    } else {
      pushIssue(
        warnings,
        'squareFootage',
        'Square footage not provided - the Effective $/SF column will show $0.',
        'warning',
      );
    }
  }

  validateConcessionEvents(params, rows, errors, warnings);
  validateRecurringOverrides(params, rows, errors, warnings);

  if ((params.nnnMode ?? 'individual') === 'aggregate') {
    if (params.nnnAggregate?.year1 !== '' && params.nnnAggregate?.year1 !== undefined) {
      const year1 = Number(params.nnnAggregate.year1);
      if (Number.isNaN(year1)) {
        pushIssue(errors, 'nnnAggregate.year1', 'Aggregate NNN Year 1 amount must be a number.', 'error');
      }
    }

    if (params.nnnAggregate?.escPct !== '' && params.nnnAggregate?.escPct !== undefined) {
      const escPct = Number(params.nnnAggregate.escPct);
      if (Number.isNaN(escPct)) {
        pushIssue(errors, 'nnnAggregate.escPct', 'Aggregate NNN escalation percentage must be a number.', 'error');
      }
    }
  }

  const { leaseStart, leaseEnd } = getLeaseBounds(rows);

  for (const entry of getChargeValidationEntries(params)) {
    const catParams = entry.value;
    if (!catParams) continue;
    const label = entry.label;

    if (catParams.year1 !== '' && catParams.year1 !== undefined) {
      const y1 = Number(catParams.year1);
      if (Number.isNaN(y1)) {
        pushIssue(errors, `${entry.fieldPrefix}.year1`, `${label} Year 1 amount must be a number.`, 'error');
      }
    }

    if (catParams.escPct !== '' && catParams.escPct !== undefined) {
      const esc = Number(catParams.escPct);
      if (Number.isNaN(esc)) {
        pushIssue(errors, `${entry.fieldPrefix}.escPct`, `${label} escalation percentage must be a number.`, 'error');
      }
    }

    if (catParams.chargeStart && String(catParams.chargeStart).trim()) {
      const chargeDate = parseLooseDate(catParams.chargeStart);
      if (!chargeDate) {
        pushIssue(errors, `${entry.fieldPrefix}.chargeStart`, `${label} billing start date must be in MM/DD/YYYY format.`, 'error');
      } else if (leaseStart && leaseEnd && (chargeDate < leaseStart || chargeDate > leaseEnd)) {
        pushIssue(warnings, `${entry.fieldPrefix}.chargeStart`, `${label} billing start date falls outside the lease term.`, 'warning');
      }
    }

    if (catParams.escStart && String(catParams.escStart).trim()) {
      const escDate = parseLooseDate(catParams.escStart);
      if (!escDate) {
        pushIssue(errors, `${entry.fieldPrefix}.escStart`, `${label} escalation start date must be in MM/DD/YYYY format.`, 'error');
      } else if (leaseStart && leaseEnd && (escDate < leaseStart || escDate > leaseEnd)) {
        pushIssue(warnings, `${entry.fieldPrefix}.escStart`, `${label} escalation start date falls outside the lease term.`, 'warning');
      }
    }
  }

  return { errors, warnings };
}

export function validateSchedule(rows) {
  if (!rows || rows.length === 0) {
    return {
      errors: [],
      warnings: [{
        field: 'schedule',
        message: 'No valid monthly rows were produced. The output may be empty or incomplete. Consider using the manual rent schedule entry.',
        severity: 'warning',
      }],
    };
  }
  return { errors: [], warnings: [] };
}
