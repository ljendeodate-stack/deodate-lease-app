import { describe, expect, it } from 'vitest';

import { deriveInlineScenarioValues } from './inlineScenarioColumns.js';

describe('deriveInlineScenarioValues', () => {
  it('uses base rent remaining only for renego columns', () => {
    const values = deriveInlineScenarioValues({
      totalBaseRentRemaining: 1000,
      totalObligationRemaining: 5000,
    });

    expect(values.renegoBaseOnly10).toBe(900);
    expect(values.renegoBaseOnly20).toBe(800);
    expect(values.renegoBaseOnly30).toBe(700);
  });

  it('uses total obligation remaining only for exit columns', () => {
    const values = deriveInlineScenarioValues({
      totalBaseRentRemaining: 1000,
      totalObligationRemaining: 5000,
    });

    expect(values.exitBaseNetsOther0).toBe(5000);
    expect(values.exitBaseNetsOther20).toBe(4000);
    expect(values.exitBaseNetsOther30).toBe(3500);
    expect(values.exitBaseNetsOther40).toBe(3000);
    expect(values.exitBaseNetsOther50).toBe(2500);
  });

  it('keeps renego values unchanged when nets and other obligations change but base remaining does not', () => {
    const baseline = deriveInlineScenarioValues({
      totalBaseRentRemaining: 1200,
      totalObligationRemaining: 5000,
      totalNNNRemaining: 800,
      totalOtherChargesRemaining: 400,
    });
    const changedObligations = deriveInlineScenarioValues({
      totalBaseRentRemaining: 1200,
      totalObligationRemaining: 9000,
      totalNNNRemaining: 3000,
      totalOtherChargesRemaining: 1200,
    });

    expect(changedObligations.renegoBaseOnly10).toBe(baseline.renegoBaseOnly10);
    expect(changedObligations.renegoBaseOnly20).toBe(baseline.renegoBaseOnly20);
    expect(changedObligations.renegoBaseOnly30).toBe(baseline.renegoBaseOnly30);
    expect(changedObligations.exitBaseNetsOther50).not.toBe(baseline.exitBaseNetsOther50);
  });
});
