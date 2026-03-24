import { toISOLocal } from '../../../engine/yearMonth.js';

function check(name, passed, details, severity = 'error') {
  return { name, passed, details, severity };
}

function isMateriallyPositive(value) {
  return Number(value || 0) > 0.005;
}

export function evaluateScenarioAnalysisFixture(fixture, scenario) {
  const checks = [];
  const requestedAnalysisDateIso = fixture.analysisDate ? toISOLocal(fixture.analysisDate) : null;
  const expectedAnalysisDateIso = requestedAnalysisDateIso ?? scenario.firstScheduleDateIso;
  const snapshot = scenario.semanticSnapshot;

  checks.push(check(
    'no-formula-errors',
    scenario.formulaErrors.length === 0,
    scenario.formulaErrors.length === 0
      ? 'No explicit formula error cells detected in Scenario Analysis.'
      : `Formula-like errors detected at ${scenario.formulaErrors.map((item) => item.address).join(', ')}.`
  ));

  checks.push(check(
    'effective-date-default',
    scenario.effectiveDateIso === expectedAnalysisDateIso &&
      (!requestedAnalysisDateIso ? scenario.formulaSemantics.analysisDateDefaultsToSchedule : true),
    requestedAnalysisDateIso
      ? `Scenario Analysis I5 resolved to ${scenario.effectiveDateIso}; expected ${expectedAnalysisDateIso}.`
      : `Scenario Analysis I5 resolved to ${scenario.effectiveDateIso}; first valid schedule date is ${scenario.firstScheduleDateIso}.`
  ));

  checks.push(check(
    'additional-rent-label',
    scenario.labels.renegotiationAdditionalRent.raw?.v === 'Additional Rent' &&
      scenario.labels.exitAdditionalRent.raw?.v === 'Additional Rent',
    `Renegotiation label=${JSON.stringify(scenario.labels.renegotiationAdditionalRent.raw?.v)}, exit label=${JSON.stringify(scenario.labels.exitAdditionalRent.raw?.v)}.`
  ));

  const snapshotShouldBePositive = snapshot && (
    isMateriallyPositive(snapshot.monthlyBaseRent) ||
    isMateriallyPositive(snapshot.additionalRent) ||
    isMateriallyPositive(snapshot.remainingObligation)
  );
  const hasEffectiveRowRouting = scenario.formulaSemantics.currentRemainingUsesApproximateLookup &&
    scenario.formulaSemantics.snapshotBaseUsesApproximateLookup &&
    scenario.formulaSemantics.snapshotAdditionalRentUsesApproximateLookup;

  checks.push(check(
    'non-zero-lease-no-false-zero',
    !snapshotShouldBePositive || hasEffectiveRowRouting,
    snapshotShouldBePositive
      ? `Semantic snapshot is positive (base=${snapshot.monthlyBaseRent}, additional=${snapshot.additionalRent}, remaining=${snapshot.remainingObligation}); effective-row routing formulas present=${hasEffectiveRowRouting}.`
      : 'Fixture resolved to a non-material snapshot, so false-zero routing is not implicated.'
  ));

  const plausibleInternals = snapshot
    ? snapshot.remainingObligation >= snapshot.remainingBaseRent &&
      snapshot.remainingObligation >= snapshot.remainingNets &&
      snapshot.fullLeaseFv >= snapshot.remainingObligation &&
      snapshot.additionalRent === (scenario.effectiveRow?.totalNNNAmount ?? 0)
    : false;

  checks.push(check(
    'internally-plausible-scenario-values',
    plausibleInternals,
    snapshot
      ? `remainingObligation=${snapshot.remainingObligation}, remainingBaseRent=${snapshot.remainingBaseRent}, remainingNets=${snapshot.remainingNets}, fullLeaseFv=${snapshot.fullLeaseFv}, additionalRent=${snapshot.additionalRent}.`
      : 'Semantic snapshot could not be resolved from Scenario Analysis.'
  ));

  if (fixture.expected?.hasOneTimeCharges) {
    checks.push(check(
      'one-time-charges-stay-separate',
      (scenario.effectiveRow?.totalNNNAmount ?? 0) === snapshot.additionalRent,
      `Additional Rent=${snapshot.additionalRent}; effective-row Total NNN=${scenario.effectiveRow?.totalNNNAmount ?? 0}; other charges remaining=${scenario.effectiveRow?.totalOtherChargesRemaining ?? 0}.`
    ));
  }

  checks.push(check(
    'analysis-date-input-style',
    scenario.styleSignals.analysisDateUsesBlueInputFont,
    `Scenario Analysis I5 font color=${scenario.effectiveDateCell.style?.font?.color?.rgb ?? 'missing'}.`,
    'warning'
  ));

  return {
    fixtureId: fixture.id,
    passed: checks.every((item) => item.passed || item.severity === 'warning'),
    checks,
  };
}
