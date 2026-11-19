import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sha256 } from '../../src/evaluation/dataset.js';
import { buildReport, saveReport } from '../../src/evaluation/tool-calling/report.js';
import { candidate, identity, perfectResults } from './helpers.js';

test('AC-26: private report is hash-verifiable, no overwrite, no descriptions, fixtures or raw output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'i006-report-'));
  try {
    const dataset = await candidate();
    const report = buildReport(
      dataset,
      identity,
      perfectResults(dataset),
      new Date().toISOString(),
    );
    const path = await saveReport(directory, report);
    const bytes = await readFile(path);
    assert.equal((await readFile(`${path}.sha256`, 'utf8')).trim(), sha256(bytes));
    const serialized = JSON.parse(bytes.toString());
    assert.equal(serialized.results.length, 60);
    assert.equal(serialized.dataset.cohort, 'KNOWN_REGRESSION');
    assert.equal(serialized.status, 'COMPLETE_PASSED');
    assert.equal(serialized.thresholdGate, 'PASSED');
    assert.equal(serialized.experimentalGate, 'NOT_EVALUATED');
    assert.equal(serialized.deterministicGate, 'NOT_EVALUATED');
    assert.deepEqual(serialized.assessment, {
      scope: 'COHORT_THRESHOLDS_ONLY',
      requiredCohorts: ['KNOWN_REGRESSION', 'INDEPENDENT_HOLDOUT'],
      independentValidation: 'NOT_EVALUATED',
      iterationAcceptance: 'NOT_GRANTED',
    });
    for (const metric of Object.values(report.metrics)) {
      if (typeof metric === 'object' && metric !== null && 'passed' in metric) {
        assert.equal(metric.passed, true);
      }
    }
    for (const source of ['CODE', 'LLM']) {
      assert.equal(serialized.segments[source].interpretation, 'DESCRIPTIVE_ONLY');
      assert.equal(serialized.segments[source].bindingThresholds, false);
    }
    // A segment with no requests has undefined precision, without vetoing global thresholds.
    assert.equal(serialized.segments.CODE.metrics.precision.percentage, null);
    assert.equal(serialized.segments.CODE.metrics.precision.passed, false);
    assert.deepEqual(JSON.parse(bytes.toString()).diagnostics, report.diagnostics);
    assert.equal(bytes.includes(dataset.examples[0]!.description), false);
    assert.equal(bytes.includes('rationale'), false);
    assert.equal(bytes.includes('arguments'), false);
    assert.equal(bytes.includes('toolCallingInstructions'), false);
    await assert.rejects(
      saveReport(directory, report),
      (error: NodeJS.ErrnoException) => error.code === 'EEXIST',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('AC-26: unsafe result fields, raw errors and contradictory outcomes cannot enter reports', async () => {
  const dataset = await candidate();
  for (const mutate of [
    (results: any) => {
      results[0].raw = 'sensitive';
    },
    (results: any) => {
      results[0].error = 'private error';
    },
    (results: any) => {
      results[0].observation.rawArguments = {};
    },
    (results: any) => {
      results[0].outcome = 'TECHNICAL_ERROR';
    },
    (results: any) => {
      results[0].observation.requestedIds = ['secret\n'];
    },
  ]) {
    const results = perfectResults(dataset);
    mutate(results);
    assert.throws(() => buildReport(dataset, identity, results, new Date().toISOString()));
  }
});

test('AC-21/23/26 known regression scope persists for failed and incomplete threshold results', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'i006-report-scope-'));
  try {
    const dataset = await candidate();
    for (const complete of [true, false]) {
      const results = perfectResults(dataset);
      if (complete) {
        for (const result of results) {
          if (result.final?.status === 'CLASSIFIED') {
            result.final.category = result.final.category === 'BUG' ? 'FEATURE' : 'BUG';
          }
        }
      } else {
        results.splice(1);
        const first = results[0]!;
        first.outcome = 'TECHNICAL_ERROR';
        first.error = 'timeout';
        first.failurePhase = 'classification';
        first.phases.classification.status = 'TECHNICAL_ERROR';
        first.final = null;
        first.observation.toolDecisionCorrect = null;
      }
      const report = buildReport(dataset, identity, results, new Date().toISOString());
      const path = await saveReport(directory, report);
      const bytes = await readFile(path);
      const serialized = JSON.parse(bytes.toString());
      assert.equal((await readFile(`${path}.sha256`, 'utf8')).trim(), sha256(bytes));
      assert.equal(serialized.dataset.cohort, 'KNOWN_REGRESSION');
      assert.equal(serialized.status, complete ? 'COMPLETE_FAILED' : 'INCOMPLETE');
      assert.equal(serialized.thresholdGate, complete ? 'FAILED' : 'INCOMPLETE');
      assert.equal(serialized.experimentalGate, 'NOT_EVALUATED');
      assert.equal(serialized.assessment.independentValidation, 'NOT_EVALUATED');
      assert.equal(serialized.assessment.iterationAcceptance, 'NOT_GRANTED');
      assert.equal(serialized.segments.CODE.bindingThresholds, false);
      assert.equal(serialized.segments.LLM.bindingThresholds, false);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
