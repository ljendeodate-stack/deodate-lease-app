/**
 * @fileoverview Section-based layout computation.
 *
 * Replaces the manual row/col arithmetic in computeLayout() with a
 * declarative section model. Each section declares its row count
 * (static or dynamic), and start rows are computed as cumulative sums.
 *
 * Column layout similarly computed from ordered column definitions
 * with dynamic charge/OT columns inserted at known positions.
 */

const BASE_ASSUMPTIONS_COUNT = 8;    // rows 5–12
const CHARGE_ASSUMPTIONS_START = 13; // first charge assumption row (1-based)

/**
 * Compute row and column layout given charge and OT counts.
 * Returns the same shape as the original computeLayout() for compatibility.
 *
 * @param {number} chargeCount — number of dynamic charges
 * @param {number} otCount     — number of one-time item columns
 * @returns {object}
 */
export function computeLayout(chargeCount, otCount) {
  const HEADER_ROW     = 14 + 2 * chargeCount;
  const FIRST_DATA_ROW = HEADER_ROW + 1;

  // Column indices (0-based)
  const CHARGE_START      = 7;                          // first charge col (after Abatement)
  const TOTAL_NNN_COL     = CHARGE_START + chargeCount;
  const OT_START          = TOTAL_NNN_COL + 1;
  const TOTAL_MONTHLY     = OT_START + otCount;
  const EFF_SF            = TOTAL_MONTHLY + 1;
  const OBLIG_REM         = EFF_SF + 1;
  const BASE_REM          = OBLIG_REM + 1;
  const NNN_REM           = BASE_REM + 1;
  const OTHER_CHARGES_REM = NNN_REM + 1;
  const LAST_COL          = OTHER_CHARGES_REM;

  return {
    HEADER_ROW, FIRST_DATA_ROW,
    CHARGE_START, TOTAL_NNN_COL, OT_START,
    TOTAL_MONTHLY, EFF_SF, OBLIG_REM, BASE_REM, NNN_REM,
    OTHER_CHARGES_REM, LAST_COL,
    CHARGE_ASSUMPTIONS_START,
    BASE_ASSUMPTIONS_COUNT,
  };
}

/**
 * Register all assumption-block symbols into the registry.
 *
 * @param {import('./registry.js').SymbolRegistry} reg
 * @param {Array} charges — resolved charge objects
 */
export function registerAssumptionSymbols(reg, charges) {
  // Base assumptions — column C (index 2), rows 5–12
  reg.register('ASSUMP.squareFootage',       { row: 5,  col: 2 });
  reg.register('ASSUMP.commencementDate',    { row: 6,  col: 2 });
  reg.register('ASSUMP.expirationDate',      { row: 7,  col: 2 });
  reg.register('ASSUMP.year1BaseRent',       { row: 8,  col: 2 });
  reg.register('ASSUMP.annualEscRate',       { row: 9,  col: 2 });
  reg.register('ASSUMP.anniversaryMonth',    { row: 10, col: 2 });
  reg.register('ASSUMP.fullAbatementMonths', { row: 11, col: 2 });
  reg.register('ASSUMP.abatementPartialFactor', { row: 12, col: 2 });

  // Dynamic charge assumptions — 2 rows per charge starting at row 13
  charges.forEach((ch, idx) => {
    const y1Row  = CHARGE_ASSUMPTIONS_START + idx * 2;
    const escRow = y1Row + 1;
    reg.register(`ASSUMP.charge.${ch.key}.year1`,   { row: y1Row,  col: 2 });
    reg.register(`ASSUMP.charge.${ch.key}.escRate`,  { row: escRow, col: 2 });
  });
}

/**
 * Register all data-area column symbols into the registry.
 * Row is not fixed (varies per data row), so we register col only with row=0 sentinel.
 *
 * @param {import('./registry.js').SymbolRegistry} reg
 * @param {object} L — layout object from computeLayout()
 * @param {Array} charges
 * @param {string[]} otLabels
 */
export function registerColumnSymbols(reg, L, charges, otLabels) {
  reg.register('COL.periodStart',     { row: 0, col: 0 });
  reg.register('COL.periodEnd',       { row: 0, col: 1 });
  reg.register('COL.monthNum',        { row: 0, col: 2 });
  reg.register('COL.yearNum',         { row: 0, col: 3 });
  reg.register('COL.scheduledRent',   { row: 0, col: 4 });
  reg.register('COL.baseRentApplied', { row: 0, col: 5 });
  reg.register('COL.abatement',       { row: 0, col: 6 });

  charges.forEach((ch, idx) => {
    reg.register(`COL.charge.${ch.key}`, { row: 0, col: L.CHARGE_START + idx });
  });

  reg.register('COL.totalNNN',        { row: 0, col: L.TOTAL_NNN_COL });

  otLabels.forEach((lbl, j) => {
    reg.register(`COL.ot.${j}`,        { row: 0, col: L.OT_START + j });
  });

  reg.register('COL.totalMonthly',    { row: 0, col: L.TOTAL_MONTHLY });
  reg.register('COL.effSF',           { row: 0, col: L.EFF_SF });
  reg.register('COL.obligRem',        { row: 0, col: L.OBLIG_REM });
  reg.register('COL.baseRem',         { row: 0, col: L.BASE_REM });
  reg.register('COL.nnnRem',          { row: 0, col: L.NNN_REM });
  reg.register('COL.otherChargesRem', { row: 0, col: L.OTHER_CHARGES_REM });
}
