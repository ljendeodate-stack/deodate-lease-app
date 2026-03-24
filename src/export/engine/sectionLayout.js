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

/**
 * Row layout for the expanded six-section assumptions block (1-based row numbers):
 *
 *  Section 1 — LEASE DRIVERS       rows  5–11   (7 rows: heading + 6 fields)
 *  Section 2 — MONTHLY RENT        rows 12–(14+N) (3+N rows: heading + mode + base rent + N charges)
 *  Section 3 — ESCALATIONS         rows (15+N)–(17+2N) (3+N rows: heading + esc rate + anniv month + N charges)
 *  Section 4 — ABATEMENT           rows (18+2N)–(22+2N) (5 rows: heading + 4 fields)
 *  Section 5 — FREE RENT           rows (23+2N)–(25+2N) (3 rows: heading + 2 fields)
 *  Section 6 — NON-RECURRING       rows (26+2N)–(26+2N+max(M,1)) (1+max(M,1) rows: heading + M items or "(none)")
 *
 * Total assumption rows = 22 + 2N + max(M,1)
 * Last assumption row   = 26 + 2N + max(M,1)
 * HEADER_ROW            = 28 + 2N + max(M,1)   (blank separator at 27+…)
 */

/** Number of assumption rows preceding the data header (static portion only). */
const BASE_ASSUMPTIONS_COUNT = 8;    // retained for backward compat export
const CHARGE_ASSUMPTIONS_START = 13; // retained for backward compat export

/**
 * Compute row and column layout given charge and OT counts.
 * Returns the same shape as the original computeLayout() for compatibility.
 *
 * @param {number} chargeCount — number of dynamic charges
 * @param {number} otCount     — number of one-time item columns
 * @returns {object}
 */
export function computeLayout(chargeCount, otCount) {
  const HEADER_ROW     = 28 + 2 * chargeCount + Math.max(otCount, 1);
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
 * Row positions match the six-section layout computed by buildAssumptionsSection.
 * Only cells that are referenced by live Excel formulas need to be registered.
 *
 * @param {import('./registry.js').SymbolRegistry} reg
 * @param {Array} charges — resolved charge objects
 */
export function registerAssumptionSymbols(reg, charges) {
  const N = charges.length;

  // Section 1 — Lease Drivers (rows 5–11): squareFootage at row 7
  reg.register('ASSUMP.squareFootage',          { row: 7,         col: 2 });
  reg.register('ASSUMP.commencementDate',       { row: 8,         col: 2 });
  reg.register('ASSUMP.expirationDate',         { row: 9,         col: 2 });

  // Section 2 — Monthly Rent Breakdown: year1BaseRent at row 14, charges at rows 15…14+N
  reg.register('ASSUMP.year1BaseRent',          { row: 14,        col: 2 });
  charges.forEach((ch, idx) => {
    reg.register(`ASSUMP.charge.${ch.key}.year1`, { row: 15 + idx, col: 2 });
  });

  // Section 3 — Escalation Assumptions: annualEscRate at row 16+N, anniversaryMonth at 17+N, charges at 18+N…
  reg.register('ASSUMP.annualEscRate',          { row: 16 + N,    col: 2 });
  reg.register('ASSUMP.anniversaryMonth',       { row: 17 + N,    col: 2 });
  charges.forEach((ch, idx) => {
    reg.register(`ASSUMP.charge.${ch.key}.escRate`, { row: 18 + N + idx, col: 2 });
  });

  // Section 4 — Abatement: fullAbatementMonths at row 19+2N, abatementPartialFactor at 22+2N
  reg.register('ASSUMP.fullAbatementMonths',    { row: 19 + 2*N,  col: 2 });
  reg.register('ASSUMP.abatementPartialFactor', { row: 22 + 2*N,  col: 2 });
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
