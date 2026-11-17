import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReport } from '../../src/evaluation/tool-calling/report.js';
import { candidate, identity, perfectResults } from './helpers.js';

test('AC-21/26: diagnostics count normal and UNAVAILABLE abstentions without thresholds', async () => {
  const dataset = await candidate();
  const results = perfectResults(dataset);
  assert.deepEqual(results[41]!.final, {
    status: 'INSUFFICIENT_CONTEXT',
    category: null,
    toolUnavailable: false,
  });
  assert.deepEqual(results[45]!.final, {
    status: 'INSUFFICIENT_CONTEXT',
    category: null,
    toolUnavailable: true,
  });
  const { diagnostics } = buildReport(dataset, identity, results, new Date().toISOString());
  assert.deepEqual(diagnostics.abstentionRecall, {
    numerator: 10,
    denominator: 10,
    percentage: 100,
  });
  assert.deepEqual(diagnostics.abstentionPrecision, {
    numerator: 10,
    denominator: 10,
    percentage: 100,
  });
});

test('AC-21/26: false positives and false negatives affect independent diagnostic denominators', async () => {
  const dataset = await candidate();
  const results = perfectResults(dataset);
  results[41]!.final = { status: 'CLASSIFIED', category: 'BUG' };
  results[0]!.final = { status: 'INSUFFICIENT_CONTEXT', category: null, toolUnavailable: false };
  const { diagnostics } = buildReport(dataset, identity, results, new Date().toISOString());
  assert.deepEqual(diagnostics.abstentionRecall, { numerator: 9, denominator: 10, percentage: 90 });
  assert.deepEqual(diagnostics.abstentionPrecision, {
    numerator: 9,
    denominator: 10,
    percentage: 90,
  });
});

test('AC-21/26: zero denominators remain null for no results or no expected/predicted abstentions', async () => {
  const dataset = await candidate();
  for (const results of [[], perfectResults(dataset).slice(0, 10)]) {
    const { diagnostics } = buildReport(dataset, identity, results, new Date().toISOString());
    assert.deepEqual(diagnostics.abstentionRecall, {
      numerator: 0,
      denominator: 0,
      percentage: null,
    });
    assert.deepEqual(diagnostics.abstentionPrecision, {
      numerator: 0,
      denominator: 0,
      percentage: null,
    });
  }
  const results = perfectResults(dataset).slice(0, 10);
  results[0]!.final = { status: 'INSUFFICIENT_CONTEXT', category: null, toolUnavailable: false };
  const { diagnostics } = buildReport(dataset, identity, results, new Date().toISOString());
  assert.deepEqual(diagnostics.abstentionRecall, {
    numerator: 0,
    denominator: 0,
    percentage: null,
  });
  assert.deepEqual(diagnostics.abstentionPrecision, {
    numerator: 0,
    denominator: 1,
    percentage: 0,
  });
});

test('AC-21/26: a model that never abstains gets zero recall and undefined precision', async () => {
  const dataset = await candidate();
  const results = perfectResults(dataset);
  for (const result of results) {
    if (result.final?.status === 'INSUFFICIENT_CONTEXT') {
      result.final = { status: 'CLASSIFIED', category: 'FEATURE' };
    }
  }
  const { diagnostics } = buildReport(dataset, identity, results, new Date().toISOString());
  assert.deepEqual(diagnostics.abstentionRecall, { numerator: 0, denominator: 10, percentage: 0 });
  assert.deepEqual(diagnostics.abstentionPrecision, {
    numerator: 0,
    denominator: 0,
    percentage: null,
  });
});

test('AC-21/26: policy rejection is a missed expected abstention, never a predicted abstention', async () => {
  const dataset = await candidate();
  const results = perfectResults(dataset);
  const rejected = results[41]!;
  rejected.outcome = 'POLICY_VIOLATION';
  rejected.final = null;
  rejected.error = 'invalid_tool_call';
  rejected.observation.toolDecisionCorrect = false;
  rejected.observation.toolRequestValid = false;
  const report = buildReport(dataset, identity, results, new Date().toISOString());
  assert.equal(report.metrics.evaluable, 60);
  assert.deepEqual(report.diagnostics.abstentionRecall, {
    numerator: 9,
    denominator: 10,
    percentage: 90,
  });
  assert.deepEqual(report.diagnostics.abstentionPrecision, {
    numerator: 9,
    denominator: 9,
    percentage: 100,
  });
});

test('AC-21/23/26: technical and unattempted cases are excluded but still block acceptance', async () => {
  const dataset = await candidate();
  const results = perfectResults(dataset).slice(0, 46);
  const failed = results[45]!;
  failed.outcome = 'TECHNICAL_ERROR';
  failed.final = null;
  failed.error = 'timeout';
  failed.observation.toolDecisionCorrect = null;
  const report = buildReport(dataset, identity, results, new Date().toISOString());
  // Only 042–045 are expected abstentions in the completed prefix; 046 failed technically.
  assert.deepEqual(report.diagnostics.abstentionRecall, {
    numerator: 4,
    denominator: 4,
    percentage: 100,
  });
  assert.deepEqual(report.diagnostics.abstentionPrecision, {
    numerator: 4,
    denominator: 4,
    percentage: 100,
  });
  assert.equal(report.metrics.technicalErrors, 1);
  assert.equal(report.metrics.notAttempted, 14);
  assert.equal(report.status, 'INCOMPLETE');
  assert.equal(report.experimentalGate, 'INCOMPLETE');
});

test('AC-23/26: low diagnostic recall cannot add an unapproved experimental threshold', async () => {
  const dataset = await candidate();
  const results = perfectResults(dataset);
  for (const result of results) {
    if (result.final?.status === 'INSUFFICIENT_CONTEXT' && result.id !== 'I006-042') {
      result.final = { status: 'CLASSIFIED', category: 'FEATURE' };
    }
  }
  const report = buildReport(dataset, identity, results, new Date().toISOString());
  assert.deepEqual(report.diagnostics.abstentionRecall, {
    numerator: 1,
    denominator: 10,
    percentage: 10,
  });
  assert.deepEqual(report.diagnostics.abstentionPrecision, {
    numerator: 1,
    denominator: 1,
    percentage: 100,
  });
  assert.equal(report.metrics.abstention.numerator, 51);
  assert.equal(report.metrics.abstention.percentage, 85);
  assert.equal(report.status, 'COMPLETE_PASSED');
  assert.equal(report.experimentalGate, 'PASSED');
  assert.equal(report.deterministicGate, 'NOT_EVALUATED');
});
