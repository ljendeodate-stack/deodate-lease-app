/**
 * @fileoverview Symbol registry for late address resolution.
 *
 * Provides a Map<string, {row, col}> that bridges declarative specs
 * (which use symbolic names like 'ASSUMP.year1BaseRent') and formula
 * templates (which need A1-style cell references like '$C$8').
 *
 * Built in two phases:
 *   1. Layout pass — register all symbols with their row/col positions
 *   2. Write pass  — formula templates query symbols to produce A1 refs
 */

/**
 * Convert 0-based column index to Excel column letter(s).
 * @param {number} n — 0-based column index
 * @returns {string}
 */
export function colLetter(n) {
  let s = '';
  let i = n + 1;
  while (i > 0) {
    const r = (i - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

/**
 * A1-style cell reference from 0-based col and 1-based row.
 */
export function a1(c, r) {
  return `${colLetter(c)}${r}`;
}

export class SymbolRegistry {
  constructor() {
    /** @type {Map<string, {row: number, col: number}>} */
    this._map = new Map();
  }

  /**
   * Register a symbol with its absolute position.
   * @param {string} symbol — e.g. 'ASSUMP.year1BaseRent'
   * @param {{row: number, col: number}} pos — 1-based row, 0-based col
   */
  register(symbol, { row, col }) {
    this._map.set(symbol, { row, col });
  }

  /**
   * Check if a symbol is registered.
   */
  has(symbol) {
    return this._map.has(symbol);
  }

  /**
   * Get raw position.
   * @param {string} symbol
   * @returns {{row: number, col: number}}
   */
  get(symbol) {
    const pos = this._map.get(symbol);
    if (!pos) throw new Error(`Symbol not registered: ${symbol}`);
    return pos;
  }

  /**
   * Resolve to A1 address string.
   * @param {string} symbol
   * @param {{abs?: boolean}} [opts] — if abs=true, returns $C$8 style
   * @returns {string}
   */
  addr(symbol, opts = {}) {
    const { row, col } = this.get(symbol);
    const c = colLetter(col);
    if (opts.abs) return `$${c}$${row}`;
    return `${c}${row}`;
  }

  /**
   * Absolute address: $C$8.
   */
  abs(symbol) {
    return this.addr(symbol, { abs: true });
  }

  /**
   * Column letter only.
   */
  col(symbol) {
    return colLetter(this.get(symbol).col);
  }

  /**
   * Row number only (1-based).
   */
  row(symbol) {
    return this.get(symbol).row;
  }

  /**
   * All registered symbols.
   */
  symbols() {
    return [...this._map.keys()];
  }
}
