import { describe, expect, it } from 'vitest';

import { runScenarioAnalysisHarness } from '../helpers/runScenarioAnalysisHarness.js';

describe('Scenario Analysis semantic export harness', () => {
  it('passes the initial fixture suite', () => {
    const result = runScenarioAnalysisHarness({ writeWorkbooks: false });

    const failures = result.fixtureResults.flatMap((fixtureResult) =>
      fixtureResult.evaluation.checks
        .filter((check) => !check.passed && check.severity !== 'warning')
        .map((check) => `${fixtureResult.fixture.id}:${check.name}:${check.details}`)
    );

    expect(failures).toEqual([]);
  });
});
