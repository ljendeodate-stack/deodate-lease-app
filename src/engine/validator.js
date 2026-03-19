/**
 * @fileoverview Parameter and schedule validation.
 *
 * Validates all form inputs against the constraints in Section 2 of the spec
 * before processing is triggered. Returns structured error and warning objects
 * rather than throwing, so the UI can render them without crashing.
 *
 * Errors BLOCK processing. Warnings are informational — processing proceeds.
 *
 * No UI dependencies. All functions are pure.
 */

import { parseMDYStrict, parseISODate } from './yearMonth.js';
import { NNN_BUCKET_KEYS, EXPENSE_CATEGORY_DEFS } from './labelClassifier.js';

/**
 * @typedef {Object} ValidationIssue
 * @property {string} field    - The parameter field key or 'schedule'.
 * @property {string} message  - Human-readable description.
 * @property {'error'|'warning'} severity
 */

/**
 * Validate all form parameters and cross-check them against the monthly rows
 * produced by the expander.
 *
 * @param {Object}   params              - All form parameters as entered by the user.
 * @param {{ date: string, 'Month #': number }[]} rows
 *   Monthly rows from expander (used to derive lease term bounds).
 *
 * @returns {{ errors: ValidationIssue[], warnings: ValidationIssue[] }}
 */
export function validateParams(params, rows) {
  const errors = [];
  const warnings = [];

  // --- Square footage ---
  const sf = Number(params.squareFootage);
  if (!params.squareFootage || isNaN(sf) || sf <= 0) {
    if (params.sfRequired) {
      // SF is truly required when rent is $/SF
      errors.push({
        field: 'squareFootage',
        message: 'Square footage is required because the lease expresses rent as $/SF. Enter the rentable area to derive monthly dollar amounts.',
        severity: 'error',
      });
    } else {
      // SF is nice-to-have for $/SF column but not blocking
      warnings.push({
        field: 'squareFootage',
        message: 'Square footage not provided — the Effective $/SF column will show $0.',
        severity: 'warning',
      });
    }
  }

  // --- Abatement ---
  if (params.abatementEndDate && params.abatementEndDate.trim()) {
    const abDate = parseMDYStrict(params.abatementEndDate);
    if (!abDate) {
      errors.push({ field: 'abatementEndDate', message: 'Abatement end date must be in MM/DD/YYYY format.', severity: 'error' });
    } else if (rows.length > 0) {
      const leaseStart = parseISODate(rows[0].date);
      const leaseEnd = parseISODate(rows[rows.length - 1].date);
      if (leaseStart && abDate < leaseStart) {
        warnings.push({ field: 'abatementEndDate', message: 'Abatement end date falls before the lease start date.', severity: 'warning' });
      }
      if (leaseEnd && abDate > leaseEnd) {
        warnings.push({ field: 'abatementEndDate', message: 'Abatement end date falls after the lease end date.', severity: 'warning' });
      }
    }
  }

  if (params.abatementPct !== '' && params.abatementPct !== undefined) {
    const pct = Number(params.abatementPct);
    if (isNaN(pct)) {
      errors.push({ field: 'abatementPct', message: 'Abatement percentage must be a number.', severity: 'error' });
    } else if (pct < 0 || pct > 100) {
      errors.push({ field: 'abatementPct', message: 'Abatement percentage must be between 0 and 100.', severity: 'error' });
    }
  }

  // --- NNN charge categories ---
  const categories = NNN_BUCKET_KEYS;
  const labels = Object.fromEntries(
    NNN_BUCKET_KEYS.map((k) => [k, EXPENSE_CATEGORY_DEFS[k].displayLabel])
  );

  const leaseStart = rows.length > 0 ? parseISODate(rows[0].date) : null;
  const leaseEnd = rows.length > 0 ? parseISODate(rows[rows.length - 1].date) : null;

  for (const cat of categories) {
    const catParams = params[cat];
    if (!catParams) continue;
    const label = labels[cat];

    // Year 1 amount
    if (catParams.year1 !== '' && catParams.year1 !== undefined) {
      const y1 = Number(catParams.year1);
      if (isNaN(y1)) {
        errors.push({ field: `${cat}.year1`, message: `${label} Year 1 amount must be a number.`, severity: 'error' });
      }
    }

    // Escalation %
    if (catParams.escPct !== '' && catParams.escPct !== undefined) {
      const esc = Number(catParams.escPct);
      if (isNaN(esc)) {
        errors.push({ field: `${cat}.escPct`, message: `${label} escalation percentage must be a number.`, severity: 'error' });
      }
    }

    // Charge start date
    if (catParams.chargeStart && catParams.chargeStart.trim()) {
      const chargeDate = parseMDYStrict(catParams.chargeStart);
      if (!chargeDate) {
        errors.push({ field: `${cat}.chargeStart`, message: `${label} billing start date must be in MM/DD/YYYY format.`, severity: 'error' });
      } else if (leaseStart && leaseEnd) {
        if (chargeDate < leaseStart || chargeDate > leaseEnd) {
          warnings.push({ field: `${cat}.chargeStart`, message: `${label} billing start date falls outside the lease term.`, severity: 'warning' });
        }
      }
    }

    // Escalation start date
    if (catParams.escStart && catParams.escStart.trim()) {
      const escDate = parseMDYStrict(catParams.escStart);
      if (!escDate) {
        errors.push({ field: `${cat}.escStart`, message: `${label} escalation start date must be in MM/DD/YYYY format.`, severity: 'error' });
      } else if (leaseStart && leaseEnd) {
        if (escDate < leaseStart || escDate > leaseEnd) {
          warnings.push({ field: `${cat}.escStart`, message: `${label} escalation start date falls outside the lease term.`, severity: 'warning' });
        }
      }
    }
  }

  return { errors, warnings };
}

/**
 * Validate that the schedule rows themselves are non-empty and contain dates.
 * This is now a WARNING, not an error — the app will still try to produce output.
 *
 * @param {{ date: string }[]} rows - Expanded monthly rows.
 * @returns {{ errors: ValidationIssue[], warnings: ValidationIssue[] }}
 */
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
