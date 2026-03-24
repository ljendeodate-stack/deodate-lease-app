import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { annualSummaryFixtures } from '../fixtures/annualSummaryFixtures.js';
import { buildAnnualSummaryFixtureWorkbook } from './buildAnnualSummaryFixtureWorkbook.js';
import { readAnnualSummaryWorkbook } from '../readers/annualSummaryReader.js';
import { evaluateAnnualSummaryFixture } from '../assertions/annualSummaryAssertions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = path.resolve(__dirname, '../../../../scripts/semantic-export/output');

export function runAnnualSummaryHarness({
  writeWorkbooks = true,
  outputDir = defaultOutputDir,
} = {}) {
  if (writeWorkbooks) {
    mkdirSync(outputDir, { recursive: true });
  }

  const fixtureResults = annualSummaryFixtures.map((fixture) => {
    const built = buildAnnualSummaryFixtureWorkbook(fixture);
    const workbookPath = path.join(outputDir, `${fixture.filename}.xlsx`);

    if (writeWorkbooks) {
      writeFileSync(workbookPath, built.workbookBytes);
    }

    const summary    = readAnnualSummaryWorkbook(built.workbookBytes, built.processedRows);
    const evaluation = evaluateAnnualSummaryFixture(fixture, summary);

    return {
      fixture,
      workbookPath,
      built,
      summary,
      evaluation,
    };
  });

  return {
    outputDir,
    fixtureResults,
    passed: fixtureResults.every((result) => result.evaluation.passed),
  };
}
