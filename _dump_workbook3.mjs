import XLSX from 'xlsx-js-style';
import { readFileSync, writeFileSync } from 'fs';

const buf = readFileSync('Edits for abatement and formatting and items and routing (version 1).xlsx');
const wb = XLSX.read(buf, { type: 'buffer', cellStyles: true, cellFormula: true, cellDates: false });

console.log('=== SHEET NAMES ===');
console.log(JSON.stringify(wb.SheetNames, null, 2));

for (let si = 0; si < wb.SheetNames.length; si++) {
  const name = wb.SheetNames[si];
  const ws = wb.Sheets[name];
  const lines = [];
  const log = (...args) => lines.push(args.join(' '));

  log(`=== SHEET: "${name}" ===`);
  log(`!ref: ${ws['!ref'] || '(none)'}`);
  log(`!merges: ${JSON.stringify(ws['!merges'] || [])}`);

  // Compact JSON dump - skip all-null rows
  const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  log(`\n--- sheet_to_json (non-null rows only) ---`);
  for (let r = 0; r < json.length; r++) {
    const row = json[r];
    if (row.some(v => v !== null)) {
      log(`Row ${r}: ${JSON.stringify(row)}`);
    }
  }

  // Raw cell data for first 50 rows
  if (!ws['!ref']) { writeFileSync(`_dump_sheet${si}.txt`, lines.join('\n'), 'utf8'); continue; }
  const range = XLSX.utils.decode_range(ws['!ref']);
  const maxRow = Math.min(range.e.r, 49);
  log(`\n--- Raw cell data (rows 1-${maxRow + 1}, cols A-${XLSX.utils.encode_col(range.e.c)}) ---`);
  for (let r = range.s.r; r <= maxRow; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (cell && cell.t !== 'z') { // skip blank/stub cells
        const info = { address: addr, value: cell.v, type: cell.t };
        if (cell.f) info.formula = cell.f;
        if (cell.w) info.formatted = cell.w;
        log(JSON.stringify(info));
      }
    }
  }

  writeFileSync(`_dump_sheet${si}.txt`, lines.join('\n'), 'utf8');
  console.log(`Wrote _dump_sheet${si}.txt (${lines.length} lines) - "${name}"`);
}
