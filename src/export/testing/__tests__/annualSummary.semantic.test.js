import { describe, expect, it } from 'vitest';

import { runAnnualSummaryHarness } from '../helpers/runAnnualSummaryHarness.js';

describe('Annual Summary semantic export harness', () => {
  it('passes the initial fixture suite', () => {
    const result = runAnnualSummaryHarness({ writeWorkbooks: false });

    const failures = result.fixtureResults.flatMap((fixtureResult) =>
      fixtureResult.evaluation.checks
        .filter((check) => !check.passed && check.severity !== 'warning')
        .map((check) => `${fixtureResult.fixture.id}:${check.name}:${check.details}`)
    );

    expect(failures).toEqual([]);
  });
});
