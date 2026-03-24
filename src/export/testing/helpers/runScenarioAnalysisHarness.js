import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scenarioAnalysisFixtures } from '../fixtures/scenarioAnalysisFixtures.js';
import { buildScenarioFixtureWorkbook } from './buildScenarioFixtureWorkbook.js';
import { readScenarioAnalysisWorkbook } from '../readers/scenarioAnalysisReader.js';
import { evaluateScenarioAnalysisFixture } from '../assertions/scenarioAnalysisAssertions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = path.resolve(__dirname, '../../../../scripts/semantic-export/output');

export function runScenarioAnalysisHarness({
  writeWorkbooks = true,
  outputDir = defaultOutputDir,
} = {}) {
  if (writeWorkbooks) {
    mkdirSync(outputDir, { recursive: true });
  }

  const fixtureResults = scenarioAnalysisFixtures.map((fixture) => {
    const built = buildScenarioFixtureWorkbook(fixture);
    const workbookPath = path.join(outputDir, `${fixture.filename}.xlsx`);

    if (writeWorkbooks) {
      writeFileSync(workbookPath, built.workbookBytes);
    }

    const scenario = readScenarioAnalysisWorkbook(built.workbookBytes, built.processedRows);
    const evaluation = evaluateScenarioAnalysisFixture(fixture, scenario);

    return {
      fixture,
      workbookPath,
      built,
      scenario,
      evaluation,
    };
  });

  return {
    outputDir,
    fixtureResults,
    passed: fixtureResults.every((result) => result.evaluation.passed),
  };
}
