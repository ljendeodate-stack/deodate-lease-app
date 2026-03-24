import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runScenarioAnalysisHarness } from '../../src/export/testing/helpers/runScenarioAnalysisHarness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(__dirname, './output');
const result = runScenarioAnalysisHarness({ writeWorkbooks: true, outputDir });

console.log('\nScenario Analysis semantic export harness');
console.log(`Output directory: ${outputDir}\n`);

for (const item of result.fixtureResults) {
  const status = item.evaluation.passed ? 'PASS' : 'FAIL';
  console.log(`${status}  ${item.fixture.id}`);
  console.log(`  Description: ${item.fixture.description}`);
  console.log(`  Workbook: ${item.workbookPath}`);
  console.log(`  Effective date: ${item.scenario.effectiveDateIso}`);

  for (const check of item.evaluation.checks) {
    const marker = check.passed ? 'PASS' : (check.severity === 'warning' ? 'WARN' : 'FAIL');
    console.log(`  ${marker}  ${check.name}: ${check.details}`);
  }

  console.log('');
}

if (!result.passed) {
  console.error('Scenario Analysis semantic checks failed.');
  process.exitCode = 1;
} else {
  console.log('All Scenario Analysis semantic checks passed.');
}
