/**
 * @fileoverview Parameter and schedule validation.
 *
 * Validates all form inputs against the constraints in Section 2 of the spec
 * before processing is triggered. Returns structured error objects rather than
 * throwing, so the UI can render them without crashing.
 *
 * No UI dependencies. All functions are pure.
 */

import { parseMDYStrict, parseISODate } from './yearMonth.js';

/**
 * @typedef {Object} ValidationError
 * @property {string} field   - The parameter field key or 'schedule'.
 * @property {string} message - Human-readable error description.
 */

/**
 * Validate all form parameters and cross-check them against the monthly rows
 * produced by the expander.
 *
 * @param {Object}   params              - All form parameters as entered by the user.
 * @param {string}   params.squareFootage
 * @param {string}   params.abatementEndDate        - MM/DD/YYYY or empty.
 * @param {string}   params.abatementPct            - 0–100.
 * @param {Object}   params.cams                    - { year1, escPct, escStart, chargeStart }
 * @param {Object}   params.insurance
 * @param {Object}   params.taxes
 * @param {Object}   params.security
 * @param {Object}   params.otherItems
 * @param {boolean}  params.sfRequired              - True when OCR flagged $/SF input.
 *
 * @param {{ date: string, 'Month #': number }[]} rows
 *   Monthly rows from expander (used to derive lease term bounds).
 *
 * @returns {ValidationError[]} Array of errors; empty array means valid.
 *
 * @n8nNode No direct equivalent — addresses spec Section 2 validation requirements.
 */
export function validateParams(params, rows) {
  const errors = [];

  // --- Square footage ---
  const sf = Number(params.squareFootage);
  if (!params.squareFootage || isNaN(sf) || sf <= 0) {
    errors.push({ field: 'squareFootage', message: 'Square footage is required and must be a positive number.' });
  }

  // --- Abatement ---
  if (params.abatementEndDate && params.abatementEndDate.trim()) {
    const abDate = parseMDYStrict(params.abatementEndDate);
    if (!abDate) {
      errors.push({ field: 'abatementEndDate', message: 'Abatement end date must be in MM/DD/YYYY format.' });
    } else if (rows.length > 0) {
      const leaseStart = parseISODate(rows[0].date);
      const leaseEnd = parseISODate(rows[rows.length - 1].date);
      if (leaseStart && abDate < leaseStart) {
        errors.push({ field: 'abatementEndDate', message: 'Abatement end date falls before the lease start date.' });
      }
      if (leaseEnd && abDate > leaseEnd) {
        errors.push({ field: 'abatementEndDate', message: 'Abatement end date falls after the lease end date.' });
      }
    }
  }

  if (params.abatementPct !== '' && params.abatementPct !== undefined) {
    const pct = Number(params.abatementPct);
    if (isNaN(pct)) {
      errors.push({ field: 'abatementPct', message: 'Abatement percentage must be a number.' });
    } else if (pct < 0 || pct > 100) {
      errors.push({ field: 'abatementPct', message: 'Abatement percentage must be between 0 and 100.' });
    }
  }

  // --- NNN charge categories ---
  const categories = ['cams', 'insurance', 'taxes', 'security', 'otherItems'];
  const labels = {
    cams: 'CAMS',
    insurance: 'Insurance',
    taxes: 'Taxes',
    security: 'Security',
    otherItems: 'Other Items',
  };

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
        errors.push({ field: `${cat}.year1`, message: `${label} Year 1 amount must be a number.` });
      }
    }

    // Escalation %
    if (catParams.escPct !== '' && catParams.escPct !== undefined) {
      const esc = Number(catParams.escPct);
      if (isNaN(esc)) {
        errors.push({ field: `${cat}.escPct`, message: `${label} escalation percentage must be a number.` });
      }
    }

    // Charge start date — must be within lease term if provided
    if (catParams.chargeStart && catParams.chargeStart.trim()) {
      const chargeDate = parseMDYStrict(catParams.chargeStart);
      if (!chargeDate) {
        errors.push({ field: `${cat}.chargeStart`, message: `${label} billing start date must be in MM/DD/YYYY format.` });
      } else if (leaseStart && leaseEnd) {
        if (chargeDate < leaseStart || chargeDate > leaseEnd) {
          errors.push({ field: `${cat}.chargeStart`, message: `${label} billing start date falls outside the lease term.` });
        }
      }
    }

    // Escalation start date
    if (catParams.escStart && catParams.escStart.trim()) {
      const escDate = parseMDYStrict(catParams.escStart);
      if (!escDate) {
        errors.push({ field: `${cat}.escStart`, message: `${label} escalation start date must be in MM/DD/YYYY format.` });
      } else if (leaseStart && leaseEnd) {
        if (escDate < leaseStart || escDate > leaseEnd) {
          errors.push({ field: `${cat}.escStart`, message: `${label} escalation start date falls outside the lease term.` });
        }
      }
    }
  }

  // --- $/SF flag: square footage required for conversion ---
  if (params.sfRequired && (!params.squareFootage || isNaN(Number(params.squareFootage)) || Number(params.squareFootage) <= 0)) {
    errors.push({
      field: 'squareFootage',
      message: 'Square footage is required because the lease expresses rent as $/SF. Enter the rentable area to derive monthly dollar amounts.',
    });
  }

  return errors;
}

/**
 * Validate that the schedule rows themselves are non-empty and contain dates.
 *
 * @param {{ date: string }[]} rows - Expanded monthly rows.
 * @returns {ValidationError[]}
 */
export function validateSchedule(rows) {
  if (!rows || rows.length === 0) {
    return [{ field: 'schedule', message: 'No valid monthly rows were produced from the uploaded file. Check that the schedule has Period Start, Period End, and Monthly Base Rent columns.' }];
  }
  return [];
}
