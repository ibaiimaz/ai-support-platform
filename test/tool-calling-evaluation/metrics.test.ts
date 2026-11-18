import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateMetrics } from '../../src/evaluation/tool-calling/metrics.js';
import { buildReport } from '../../src/evaluation/tool-calling/report.js';
import { candidate, identity, perfectResults } from './helpers.js';

test('AC-20–23: independent perfect counts and five gates; deterministic gate remains independent', async () => {
  const dataset = await candidate();
  const results = perfectResults(dataset);
  const report = buildReport(dataset, identity, results, new Date().toISOString());
  // Explicit counts from the reviewed group design: 20+10+3 lookups, 50 categories, 10 abstentions.
  assert.deepEqual(
    [report.metrics.precision.numerator, report.metrics.precision.denominator],
    [33, 33],
  );
  assert.deepEqual([report.metrics.recall.numerator, report.metrics.recall.denominator], [33, 33]);
  assert.deepEqual(
    [report.metrics.classification.numerator, report.metrics.classification.denominator],
    [50, 50],
  );
  assert.deepEqual(
    [report.metrics.abstention.numerator, report.metrics.abstention.denominator],
    [60, 60],
  );
  assert.deepEqual(
    [report.metrics.counterfactual.numerator, report.metrics.counterfactual.denominator],
    [10, 10],
  );
  assert.equal(report.status, 'COMPLETE_PASSED');
  assert.equal(report.deterministicGate, 'NOT_EVALUATED');
});

test('AC-20: wrong ID penalizes tool decision independently of correct final category', async () => {
  const dataset = await candidate();
  const results = perfectResults(dataset);
  results[20]!.observation.toolDecisionCorrect = false;
  results[20]!.observation.requestedIds = ['INC-999'];
  const metrics = calculateMetrics(dataset, results);
  assert.equal(metrics.precision.numerator, 32);
  assert.equal(metrics.precision.denominator, 33);
  assert.equal(metrics.recall.numerator, 32);
  assert.equal(metrics.classification.numerator, 50);
  assert.equal(metrics.counterfactual.numerator, 9);
});

test('AC-20: multiple/additional requests contribute one case; policy rejection is not abstention', async () => {
  const dataset = await candidate();
  const results = perfectResults(dataset);
  const result = results[40]!;
  result.outcome = 'POLICY_VIOLATION';
  result.final = null;
  result.error = 'invalid_tool_call';
  result.failurePhase = 'classification';
  result.phases.classification.status = 'POLICY_REJECTED';
  result.observation.toolDecisionCorrect = false;
  result.observation.toolRequestValid = false;
  result.observation.requestCount = 3;
  result.observation.violations = ['INVALID_MULTIPLE_OR_ADDITIONAL_REQUEST'];
  const report = buildReport(dataset, identity, results, new Date().toISOString());
  assert.equal(report.metrics.precision.denominator, 33);
  assert.equal(report.metrics.precision.numerator, 32);
  assert.equal(report.metrics.abstention.numerator, 59);
  assert.equal(report.metrics.evaluable, 60);
});

test('AC-20: wrong category can preserve classify/abstain accuracy; wrong abstention cannot', async () => {
  const dataset = await candidate();
  const results = perfectResults(dataset);
  results[0]!.final = { status: 'CLASSIFIED', category: 'FEATURE' };
  results[1]!.final = { status: 'INSUFFICIENT_CONTEXT', category: null, toolUnavailable: false };
  const metrics = calculateMetrics(dataset, results);
  assert.equal(metrics.classification.numerator, 48);
  assert.equal(metrics.abstention.numerator, 59);
});

test('AC-21/23: technical and absent cases remain visible, exclude incomplete pairs and block gate', async () => {
  const dataset = await candidate();
  const results = perfectResults(dataset).slice(0, 22);
  const failed = results[21]!;
  failed.outcome = 'TECHNICAL_ERROR';
  failed.final = null;
  failed.error = 'timeout';
  failed.failurePhase = 'classification';
  failed.phases.classification.status = 'TECHNICAL_ERROR';
  failed.observation.toolDecisionCorrect = null;
  const report = buildReport(dataset, identity, results, new Date().toISOString());
  assert.equal(report.status, 'INCOMPLETE');
  assert.equal(report.metrics.evaluable, 21);
  assert.equal(report.metrics.technicalErrors, 1);
  assert.equal(report.metrics.notAttempted, 38);
  assert.equal(report.metrics.counterfactual.denominator, 0);
  assert.equal(report.metrics.counterfactual.percentage, null);
  assert.equal(report.metrics.excludedPairs, 10);
});

test('AC-20/23: threshold boundary uses exact counts, not display rounding', async () => {
  const dataset = await candidate();
  const results = perfectResults(dataset);
  // 9/10 pairs reaches 90%; 8/10 does not. Nine incorrect categories leave at most 41/50 <85%.
  results[20]!.final = { status: 'CLASSIFIED', category: 'QUESTION' };
  assert.equal(calculateMetrics(dataset, results).counterfactual.passed, true);
  results[22]!.final = { status: 'CLASSIFIED', category: 'FEATURE' };
  assert.equal(calculateMetrics(dataset, results).counterfactual.passed, false);
  for (const result of results.slice(0, 9)) {
    result.final = { status: 'INSUFFICIENT_CONTEXT', category: null, toolUnavailable: false };
  }
  const report = buildReport(dataset, identity, results, new Date().toISOString());
  assert.equal(report.status, 'COMPLETE_FAILED');
  assert.equal(report.experimentalGate, 'FAILED');
});

test('AC-21/26: zero denominators and invalid prefixes cannot masquerade as complete evaluations', async () => {
  const dataset = await candidate();
  const metrics = calculateMetrics(dataset, []);
  assert.equal(metrics.precision.percentage, null);
  assert.equal(metrics.recall.passed, false);
  assert.throws(() => calculateMetrics(dataset, perfectResults(dataset).reverse()));
  assert.throws(() =>
    calculateMetrics(dataset, [...perfectResults(dataset), perfectResults(dataset)[0]!]),
  );
});
