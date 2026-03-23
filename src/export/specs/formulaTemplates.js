/**
 * @fileoverview Formula template functions — symbolic -> A1.
 *
 * Each template receives a context object and returns an Excel formula string.
 * The context provides:
 *   reg   — SymbolRegistry instance
 *   r     — current 1-based row number
 *   col   — helper: colLetter from registry
 *
 * Templates replace hardcoded cell references (e.g. $C$8) with
 * registry lookups (e.g. reg.abs('ASSUMP.year1BaseRent')).
 */

import { colLetter } from '../engine/registry.js';

/**
 * E — Scheduled Base Rent: =$C$8*(1+$C$9)^(D{r}-1)
 */
export function scheduledBaseRent(reg, r) {
  const y1  = reg.abs('ASSUMP.year1BaseRent');
  const esc = reg.abs('ASSUMP.annualEscRate');
  return `${y1}*(1+${esc})^(D${r}-1)`;
}

/**
 * F — Base Rent Applied: IF(C{r}<=$C$11,0,IF(C{r}=$C$11+1,E{r}*$C$12,E{r}))
 */
export function baseRentApplied(reg, r) {
  const abatMonths = reg.abs('ASSUMP.fullAbatementMonths');
  const partFactor = reg.abs('ASSUMP.abatementPartialFactor');
  return `IF(C${r}<=${abatMonths},0,IF(C${r}=${abatMonths}+1,E${r}*${partFactor},E${r}))`;
}

/**
 * G — Abatement: =E{r}-F{r}
 */
export function abatementAmount(_reg, r) {
  return `E${r}-F${r}`;
}

/**
 * Dynamic charge column: =$C${y1Row}*(1+$C${escRow})^(D{r}-1)
 */
export function chargeAmount(reg, r, chargeKey) {
  const y1  = reg.abs(`ASSUMP.charge.${chargeKey}.year1`);
  const esc = reg.abs(`ASSUMP.charge.${chargeKey}.escRate`);
  return `${y1}*(1+${esc})^(D${r}-1)`;
}

/**
 * Total NNN: sum of NNN-type charge columns for row r.
 */
export function totalNNN(nnnColIndices, r) {
  if (nnnColIndices.length === 0) return '0';
  return nnnColIndices.map(ci => `${colLetter(ci)}${r}`).join('+');
}

/**
 * Total Monthly Obligation: F + TotalNNN + Other charge cols + OT cols.
 */
export function totalMonthlyObligation(nnnLetter, otherColIndices, otColIndices, r) {
  const otherTerms = otherColIndices.map(ci => `${colLetter(ci)}${r}`);
  const otTerms    = otColIndices.map(ci => `${colLetter(ci)}${r}`);
  const allExtra   = [...otherTerms, ...otTerms];
  const extraStr   = allExtra.length > 0 ? '+' + allExtra.join('+') : '';
  return `F${r}+${nnnLetter}${r}${extraStr}`;
}

/**
 * Effective $/SF: IF($C$5=0,0,TMO{r}/$C$5)
 */
export function effectivePerSF(reg, tmLetter, r) {
  const sf = reg.abs('ASSUMP.squareFootage');
  return `IF(${sf}=0,0,${tmLetter}${r}/${sf})`;
}

/**
 * Tail-SUM for remaining balance columns: SUM(col{r}:col{lastData})
 */
export function tailSum(colIdx, r, lastData) {
  const letter = colLetter(colIdx);
  return `SUM(${letter}${r}:${letter}${lastData})`;
}

/**
 * Other Charges Remaining: compound tail-sum of other-type charge cols + OT cols.
 */
export function otherChargesRemaining(otherColIndices, otColIndices, r, lastData) {
  const parts = [
    ...otherColIndices.map(ci => `SUM(${colLetter(ci)}${r}:${colLetter(ci)}${lastData})`),
    ...otColIndices.map(ci => `SUM(${colLetter(ci)}${r}:${colLetter(ci)}${lastData})`),
  ];
  return parts.length > 0 ? parts.join('+') : '0';
}
