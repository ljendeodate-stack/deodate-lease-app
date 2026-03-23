/**
 * @fileoverview Post-generation structural verification.
 *
 * Runs a set of checks on the generated workbook to catch structural
 * issues before the user receives the file. Warnings are logged to
 * the console — they do not block export.
 */

/**
 * Run all verification checks.
 *
 * @param {object}   wb         — xlsx-js-style workbook
 * @param {object}   reg        — SymbolRegistry
 * @param {object}   L          — layout
 * @param {number}   rowCount   — expected data row count
 * @param {number}   chargeCount
 * @param {string[]} otLabels
 */
export function verifyWorkbook(wb, reg, L, rowCount, chargeCount, otLabels) {
  const warnings = [];
  const sheetNames = wb.SheetNames;

  // V-01: Every registered symbol has a non-null cell
  const ws1 = wb.Sheets[sheetNames[0]];
  if (ws1 && reg) {
    for (const sym of reg.symbols()) {
      const pos = reg.get(sym);
      if (pos.row === 0) continue; // column-only registrations
      const addr = reg.addr(sym);
      if (!ws1[addr]) {
        warnings.push(`V-01: Symbol '${sym}' at ${addr} has no cell`);
      }
    }
  }

  // V-03: Data row count matches
  if (ws1) {
    const { FIRST_DATA_ROW: FDR } = L;
    const lastData = FDR + rowCount - 1;
    const lastAddr = `A${lastData}`;
    if (!ws1[lastAddr]) {
      warnings.push(`V-03: Expected data at ${lastAddr} (row count=${rowCount}) — cell missing`);
    }
  }

  // V-04: Assumption rows = 8 + 2 * chargeCount
  const expectedAssumpRows = 8 + 2 * chargeCount;
  const actualAssumpEnd = 12 + 2 * chargeCount;
  if (ws1) {
    const lastAssumpAddr = `B${actualAssumpEnd}`;
    if (!ws1[lastAssumpAddr]) {
      warnings.push(`V-04: Expected assumption label at ${lastAssumpAddr} — cell missing`);
    }
  }

  // V-05: Formula cells in data area have `f` property
  if (ws1) {
    const { FIRST_DATA_ROW: FDR } = L;
    // Spot-check first data row columns E, F, G (should be formulas)
    for (const colIdx of [4, 5, 6]) {
      const addr = `${String.fromCharCode(65 + colIdx)}${FDR}`;
      const cell = ws1[addr];
      if (cell && !cell.f) {
        warnings.push(`V-05: Cell ${addr} expected to have formula but has none`);
      }
    }
  }

  // V-08: No undefined/NaN/Infinity cell values (spot-check first sheet)
  if (ws1) {
    for (const key of Object.keys(ws1)) {
      if (key.startsWith('!')) continue;
      const cell = ws1[key];
      if (cell.v === undefined && cell.t === 'n') {
        warnings.push(`V-08: Cell ${key} has undefined numeric value`);
      }
      if (typeof cell.v === 'number' && (isNaN(cell.v) || !isFinite(cell.v))) {
        warnings.push(`V-08: Cell ${key} has NaN or Infinity value: ${cell.v}`);
      }
    }
  }

  // V-10: Frozen pane matches header row
  if (ws1 && ws1['!views'] && ws1['!views'][0]) {
    const frozenY = ws1['!views'][0].ySplit;
    if (frozenY !== L.HEADER_ROW) {
      warnings.push(`V-10: Frozen pane ySplit=${frozenY} does not match HEADER_ROW=${L.HEADER_ROW}`);
    }
  }

  // V-06: Cross-sheet refs use correct sheet name (Annual Summary)
  const ws2 = wb.Sheets[sheetNames[1]];
  if (ws2) {
    for (const key of Object.keys(ws2)) {
      if (key.startsWith('!')) continue;
      const cell = ws2[key];
      if (cell.f && cell.f.includes("'Lease Schedule'")) {
        // Verify the referenced sheet exists
        if (!sheetNames.includes('Lease Schedule')) {
          warnings.push(`V-06: Cross-sheet formula in Annual Summary references 'Lease Schedule' but sheet not found`);
          break;
        }
      }
    }
  }

  // Log warnings
  if (warnings.length > 0) {
    console.warn(`[XLSX Export Verification] ${warnings.length} warning(s):`);
    warnings.forEach((w) => console.warn(`  ${w}`));
  }

  return warnings;
}
