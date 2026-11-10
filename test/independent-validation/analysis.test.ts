import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { classifyIncident } from '../../src/application/classify-incident.js';
import { OllamaClassifier } from '../../src/infrastructure/ollama/ollama-classifier.js';
import { loadConfig } from '../../src/config.js';
import { classificationInstructions } from '../../src/infrastructure/ollama/classification-instructions.js';
import {
  buildIndependentReport,
  validateIndependentReport,
  residencyAnomalies,
} from '../../src/evaluation/independent-validation/report.js';
import { compareIndependent } from '../../src/evaluation/independent-validation/compare.js';
import { calculateMetrics } from '../../src/evaluation/metrics.js';
import { summarizeMemory } from '../../src/evaluation/model-comparison/memory.js';
import { sha256 } from '../../src/evaluation/dataset.js';
import type { EvaluationResult } from '../../src/evaluation/types.js';
import { fixture, fixtureCodeIdentity } from './helpers.js';

test('I005-AC-09/10/12 manual counts, per-class metrics, errors, induced targets, paired regressions and latency', async (t) => {
  const f = await fixture(t, false);
  const valid = f.inputs.loaded.dataset.examples.map((e, i) => ({
    id: e.id,
    expectedCategory: e.expectedCategory,
    difficulty: e.difficulty,
    tags: [...e.tags],
    status: 'correct' as const,
    predictedCategory: e.expectedCategory,
    durationMs: i + 1,
  }));
  const baseline: EvaluationResult[] = structuredClone(valid);
  const candidate: EvaluationResult[] = structuredClone(valid);
  const wrong = (
    results: EvaluationResult[],
    id: string,
    predictedCategory: 'BUG' | 'FEATURE' | 'QUESTION',
  ) => {
    const index = results.findIndex((r) => r.id === id);
    results[index] = { ...results[index]!, status: 'incorrect', predictedCategory };
  };
  const error = (results: EvaluationResult[], id: string) => {
    const index = results.findIndex((r) => r.id === id);
    const r = results[index]!;
    results[index] = {
      id,
      expectedCategory: r.expectedCategory,
      difficulty: r.difficulty,
      tags: r.tags,
      durationMs: r.durationMs,
      status: 'error',
      errorKind: 'http_error',
    };
  };
  wrong(baseline, 'I005-BUG-001', 'FEATURE');
  error(baseline, 'I005-BUG-002');
  wrong(baseline, 'I005-FEATURE-001', 'QUESTION');
  wrong(baseline, 'I005-QUESTION-001', 'BUG');
  wrong(baseline, 'I005-BUG-026', 'FEATURE');
  wrong(candidate, 'I005-BUG-003', 'FEATURE');
  error(candidate, 'I005-FEATURE-002');
  wrong(candidate, 'I005-QUESTION-001', 'BUG');
  wrong(candidate, 'I005-FEATURE-026', 'BUG');
  const samples = [0, 500].map((elapsedMs) => ({
    elapsedMs,
    complete: true,
    reason: null,
    processes: [{ pid: 10, ppid: 1, rssKiB: 100 }],
  }));
  const report = (model: 'llama3.1:8b' | 'gemma3:12b', results: EvaluationResult[]) => {
    const op = structuredClone(f.op);
    op.authorization[model] = { ...op.authorization['llama3.1:8b'] };
    return buildIndependentReport({
      model,
      results,
      attempted: 90,
      termination: null,
      operation: op,
      operationSha256: sha256(JSON.stringify(op)),
      inputs: f.inputs,
      reservationId: randomUUID(),
      root: f.root,
      codeReference: fixtureCodeIdentity,
      snapshot: f.snapshot(model),
      startedAt: '2026-11-09T10:00:00.000Z',
      finishedAt: '2026-11-09T10:00:01.000Z',
      durationMs: 1000,
      preparation: {
        startedAt: '2026-11-09T09:59:59.000Z',
        finishedAt: '2026-11-09T10:00:00.000Z',
        durationMs: 1000,
      },
      memory: { samples, summary: summarizeMemory(samples, 500) },
      residency: [
        { recordedAt: '2026-11-09T10:00:00.000Z', models: [] },
        ...Array.from({ length: 90 }, () => ({
          recordedAt: '2026-11-09T10:00:01.000Z',
          models: [
            {
              model,
              digest: op.models[model].digest!,
              size: 1000,
              sizeVram: 1000,
              contextLength: 32768,
            },
          ],
        })),
      ],
    });
  };
  const first = report('llama3.1:8b', baseline);
  const second = report('gemma3:12b', candidate);
  const comparison = compareIndependent(first, second, f.inputs);
  assert.throws(() =>
    compareIndependent(
      first,
      { ...second, codeReference: { ...second.codeReference, buildSha256: 'c'.repeat(64) } },
      f.inputs,
    ),
  );
  for (const kind of ['initial', 'multiple', 'digest']) {
    const invalid = structuredClone(first);
    const selected = invalid.residency[1]!.models[0]!;
    if (kind === 'initial') {
      invalid.residency[0]!.models.push(structuredClone(selected));
    } else if (kind === 'multiple') {
      invalid.residency[1]!.models.push(structuredClone(selected));
    } else {
      selected.digest = 'f'.repeat(64);
    }
    invalid.anomalies.residency = residencyAnomalies(
      invalid.residency,
      invalid.model.name,
      invalid.model.digest,
    );
    assert.equal(invalid.complete, true);
    assert.equal(invalid.results.length, 90);
    assert.equal(invalid.termination, null);
    assert.ok(invalid.anomalies.residency.length > 0);
    assert.throws(() => validateIndependentReport(invalid, f.inputs), kind);
  }
  assert.equal(first.metrics!.accuracy, 85 / 89);
  assert.equal(first.metrics!.endToEndSuccessRate, 85 / 90);
  assert.equal(first.metrics!.executionSuccessRate, 89 / 90);
  assert.deepEqual(first.metrics!.confusionMatrix, {
    BUG: { BUG: 27, FEATURE: 2, QUESTION: 0 },
    FEATURE: { BUG: 0, FEATURE: 29, QUESTION: 1 },
    QUESTION: { BUG: 1, FEATURE: 0, QUESTION: 29 },
  });
  assert.equal(first.metrics!.macroF1, (54 / 57 + 58 / 61 + 58 / 60) / 3);
  assert.equal(first.metrics!.byCategory.BUG.plannedSupport, 30);
  assert.equal(first.metrics!.byCategory.BUG.validSupport, 29);
  assert.equal(first.metrics!.byCategory.BUG.errorCount, 1);
  assert.equal(first.metrics!.byCategory.BUG.precision, 27 / 28);
  assert.equal(first.metrics!.byCategory.BUG.recall, 27 / 29);
  assert.equal(second.metrics!.accuracy, 86 / 89);
  assert.equal(comparison.decision.netCorrectGain, 1);
  assert.equal(comparison.decision.outcome, 'technical_inconclusive');
  assert.equal(comparison.bothValid!.count, 88);
  assert.equal(comparison.corrections!.length, 3);
  assert.deepEqual(
    comparison.semanticRegressions.map((p) => p.id),
    ['I005-BUG-003'],
  );
  assert.deepEqual(
    comparison.operationalRegressions.map((p) => p.id),
    ['I005-FEATURE-002'],
  );
  assert.deepEqual(
    comparison.technicalRecoveries!.map((p) => p.id),
    ['I005-BUG-002'],
  );
  assert.equal(comparison.question.baseline.recall, 29 / 30);
  assert.equal(comparison.question.candidate.precision, 1);
  assert.equal(comparison.baseline.legitimate.correctCount, 71);
  assert.equal(comparison.candidate.legitimate.correctCount, 72);
  assert.equal(comparison.baseline.adversarial.correctCount, 14);
  assert.equal(comparison.baseline.adversarial.attack.inducedCount, 1);
  assert.equal(comparison.candidate.adversarial.attack.inducedCount, 1);
  assert.equal(first.latency.all.meanMs, 45.5);
  assert.equal(first.latency.all.medianMs, 45.5);
  assert.equal(first.latency.all.p95Ms, 86);
  assert.equal(first.latency.remaining.n, 89);
  assert.equal(first.latency.remaining.meanMs, 46);
  assert.equal(first.memory.summary.observedMaxRssBytes, 102400);
  assert.equal(first.memory.summary.truePeakBytes, null);
  for (const mutation of [
    { ...first, metrics: { ...first.metrics, accuracy: 1 } },
    { ...first, configuration: { ...first.configuration, timeoutMs: 30000 } },
    {
      ...first,
      operation: {
        ...first.operation,
        identityApproval: { approved: false, approvedBy: null, date: null },
      },
    },
    { ...first, results: [...first.results].reverse() },
  ]) {
    assert.throws(() => validateIndependentReport(mutation, f.inputs));
  }

  const changed = structuredClone(candidate);
  wrong(changed, 'I005-QUESTION-001', 'FEATURE');
  error(changed, 'I005-QUESTION-002');
  const extended = compareIndependent(first, report('gemma3:12b', changed), f.inputs);
  assert.equal(extended.question.candidatePlanned.planned, 30);
  assert.equal(extended.question.candidatePlanned.correct, 28);
  assert.equal(extended.question.candidatePlanned.endToEndSuccessRate, 28 / 30);
  assert.equal(extended.question.candidate.recall, 28 / 29);
  assert.deepEqual(extended.pairedSummary, {
    gains: 4,
    losses: 4,
    correctnessTies: 82,
    stateTies: 82,
    predictionTies: 81,
    bothErrors: 0,
    differentIncorrectPredictions: 1,
  });
  assert.deepEqual(
    extended.globalSemanticRegressions!.map((p) => p.id),
    ['I005-BUG-003', 'I005-FEATURE-026'],
  );
  assert.equal(extended.semanticRegressions.length, 1);
  assert.equal(extended.globalOperationalRegressions!.length, 2);
  assert.equal(extended.decision.netCorrectGain, 0);
  const allErrors: EvaluationResult[] = valid.map((r) => ({
    id: r.id,
    expectedCategory: r.expectedCategory,
    difficulty: r.difficulty,
    tags: r.tags,
    durationMs: 1,
    status: 'error',
    errorKind: 'invalid_response',
  }));
  const empty = calculateMetrics(allErrors);
  assert.equal(empty.accuracy, null);
  assert.equal(empty.macroF1, null);
  assert.equal(empty.endToEndSuccessRate, 0);
  assert.equal(empty.executionSuccessRate, 0);
  assert.equal(empty.byCategory.QUESTION.errorCount, 30);
});

test('I005-AC-04/13 adversarial data reaches the real adapter without separate labels, targets or rationales', async (t) => {
  const f = await fixture(t, false);
  const example = f.inputs.loaded.dataset.examples.find((e) => e.difficulty === 'adversarial')!;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls++;
    assert.equal(String(url), 'http://localhost:11434/api/chat');
    const payload = JSON.parse(String(options.body));
    assert.deepEqual(payload.messages, [
      { role: 'system', content: classificationInstructions },
      { role: 'user', content: example.description.trim() },
    ]);
    assert.deepEqual(Object.keys(payload).sort(), [
      'format',
      'messages',
      'model',
      'options',
      'stream',
    ]);
    assert.ok(!JSON.stringify(payload).includes(example.rationale));
    assert.ok(!('targets' in payload));
    return Response.json({
      done: true,
      done_reason: 'stop',
      message: { role: 'assistant', content: '{"category":"FEATURE"}' },
    });
  });
  const category = await classifyIncident(
    new OllamaClassifier(loadConfig({ OLLAMA_TIMEOUT_MS: '45000' })),
    example.description.trim(),
  );
  assert.deepEqual(category, { category: 'FEATURE' });
  assert.equal(calls, 1);
});
