import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAnnualSummaryHarness } from '../../src/export/testing/helpers/runAnnualSummaryHarness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(__dirname, './output');
const result = runAnnualSummaryHarness({ writeWorkbooks: true, outputDir });

console.log('\nAnnual Summary semantic export harness');
console.log(`Output directory: ${outputDir}\n`);

for (const item of result.fixtureResults) {
  const status = item.evaluation.passed ? 'PASS' : 'FAIL';
  console.log(`${status}  ${item.fixture.id}`);
  console.log(`  Description: ${item.fixture.description}`);
  console.log(`  Workbook: ${item.workbookPath}`);

  for (const check of item.evaluation.checks) {
    const marker = check.passed ? 'PASS' : (check.severity === 'warning' ? 'WARN' : 'FAIL');
    console.log(`  ${marker}  ${check.name}: ${check.details}`);
  }

  console.log('');
}

if (!result.passed) {
  console.error('Annual Summary semantic checks failed.');
  process.exitCode = 1;
} else {
  console.log('All Annual Summary semantic checks passed.');
}
