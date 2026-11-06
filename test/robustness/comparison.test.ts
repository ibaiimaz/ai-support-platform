import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { analyzeResults } from '../../src/evaluation/analysis.js';
import { compareReports } from '../../src/evaluation/comparison.js';
import { assessCandidate, rankCandidates } from '../../src/evaluation/decisions.js';
import { buildExperimentReport } from '../../src/evaluation/report.js';
import { compareFiles } from '../../src/evaluation/compare-main.js';
import { findPrompt } from '../../src/evaluation/prompts.js';
import { fixturePair } from './helpers.js';
import { result } from '../evaluation/helpers.js';

test('I003-AC-06 pares por ID, orden independiente y matriz de transiciones', async (t) => {
  const fixture = await fixturePair(t);
  fixture.candidate.results.reverse();
  const comparison = compareReports(fixture.baseline, fixture.candidate, fixture.targets);
  assert.equal(comparison.pairs.length, 60);
  assert.equal(comparison.transitions.correct.correct, 51);
  assert.equal(comparison.transitions.incorrect.correct, 3);
  assert.equal(comparison.transitions.incorrect.incorrect, 6);
  assert.equal(comparison.bothValid.count, 60);
  assert.equal(comparison.legitimate.netLossOfCorrect, 0);
  assert.equal(comparison.baseline.adversarial.attack.inducedCount, 9);
  assert.equal(comparison.candidate.adversarial.attack.inducedCount, 6);
});

test('I003-AC-06 rechaza informes incompletos, metadatos divergentes y referencias alteradas', async (t) => {
  const fixture = await fixturePair(t);
  for (const field of [
    'model',
    'configuration',
    'dataset',
    'phase',
    'protocol',
    'prompt',
    'id',
    'expected',
    'difficulty',
    'tags',
    'incomplete',
  ]) {
    const candidate = structuredClone(fixture.candidate);
    if (field === 'model') {
      candidate.model.name = 'otro';
    }
    if (field === 'configuration') {
      candidate.configuration.timeoutMs++;
    }
    if (field === 'dataset') {
      candidate.dataset.sha256 = 'f'.repeat(64);
    }
    if (field === 'phase') {
      candidate.experiment.phase = 'validation';
    }
    if (field === 'protocol') {
      candidate.experiment.protocolSha256 = 'f'.repeat(64);
    }
    if (field === 'prompt') {
      candidate.prompt.sha256 = 'f'.repeat(64);
    }
    if (field === 'id') {
      candidate.results[0]!.id = 'missing';
    }
    if (field === 'expected') {
      candidate.results[0]!.expectedCategory = 'QUESTION';
    }
    if (field === 'difficulty') {
      candidate.results[0]!.difficulty = 'complex';
    }
    if (field === 'tags') {
      candidate.results[0]!.tags = ['changed'];
    }
    if (field === 'incomplete') {
      candidate.complete = false;
    }
    assert.throws(() => compareReports(fixture.baseline, candidate, fixture.targets), field);
  }
});

test('I003-AC-07 I003-AC-08 contadores absolutos, errores y objetivos inducidos', () => {
  const a = result('BUG', 'BUG', 'a');
  const b = result('FEATURE', 'BUG', 'b');
  const c = result('QUESTION', 'FEATURE', 'c');
  const d = result('BUG', null, 'd');
  for (const entry of [a, b, c, d]) {
    entry.difficulty = 'adversarial';
  }
  const targets = { a: 'FEATURE', b: 'BUG', c: 'BUG', d: 'FEATURE' } as const;
  const metrics = analyzeResults([a, b, c, d], targets);
  assert.equal(metrics.global.correctCount, 1);
  assert.equal(metrics.global.incorrectCount, 2);
  assert.equal(metrics.global.errorCount, 1);
  assert.equal(metrics.global.metrics.accuracy, 1 / 3);
  assert.equal(metrics.adversarial.metrics.endToEndSuccessRate, 1 / 4);
  assert.equal(metrics.adversarial.attack.inducedCount, 1);
  assert.equal(metrics.adversarial.attack.inducedRate, 1 / 4);
  assert.equal(metrics.adversarial.attack.validInducedRate, 1 / 3);
  assert.equal(metrics.adversarial.metrics.executionSuccessRate, 3 / 4);
  assert.equal(metrics.legitimate.plannedCount, 0);
  assert.equal(analyzeResults([d], targets).adversarial.attack.validInducedRate, null);
  assert.throws(() => analyzeResults([a], {}));
  assert.throws(() => analyzeResults([a], { a: 'BUG' }));
});

test('I003-AC-06 I003-AC-09 pérdidas netas no ocultan regresiones y correcciones individuales', async (t) => {
  const fixture = await fixturePair(t);
  const baselineRun = structuredClone(fixture.run);
  const candidateRun = structuredClone(fixture.candidateRun);
  for (const index of [0, 1]) {
    const entry = baselineRun.results[index]!;
    if (entry.status !== 'error') {
      entry.status = 'incorrect';
      entry.predictedCategory = 'FEATURE';
    }
  }
  for (const index of [2, 3]) {
    const entry = candidateRun.results[index]!;
    if (entry.status !== 'error') {
      entry.status = 'incorrect';
      entry.predictedCategory = 'FEATURE';
    }
  }
  const control = buildExperimentReport(
    fixture.loaded,
    fixture.config,
    baselineRun,
    null,
    findPrompt('i001-original'),
    fixture.reportContext,
  );
  const candidate = buildExperimentReport(
    fixture.loaded,
    fixture.config,
    candidateRun,
    null,
    findPrompt('h1'),
    fixture.reportContext,
  );
  const comparison = compareReports(control, candidate, fixture.targets);
  assert.equal(comparison.legitimate.netLossOfCorrect, 0);
  assert.equal(comparison.legitimate.semanticRegressions.length, 2);
  assert.equal(comparison.legitimate.corrections.length, 2);
  assert.equal(comparison.legitimate.operationalRegressions.length, 0);
  const pending = assessCandidate(comparison);
  assert.equal(pending.numericEligible, true);
  assert.equal(pending.reviewComplete, false);
  const review = {
    reviewer: 'Revisor',
    reviewedIds: pending.regressionIds,
    rejected: false,
    reason: null,
  };
  assert.equal(assessCandidate(comparison, review).eligible, true);
  assert.equal(
    assessCandidate(comparison, { ...review, reviewedIds: [pending.regressionIds[0]!] }).eligible,
    false,
  );
  assert.equal(
    assessCandidate(comparison, {
      ...review,
      rejected: true,
      reason: 'Regresión inaceptable en una necesidad crítica.',
    }).eligible,
    false,
  );
  assert.throws(() => assessCandidate(comparison, { ...review, rejected: true }));
  assert.throws(() =>
    assessCandidate(comparison, { ...review, reviewedIds: 'invalid' as unknown as string[] }),
  );
});

test('I003-AC-09 puertas exactas y fracaso de cada límite numérico', async (t) => {
  const fixture = await fixturePair(t);
  const base = compareReports(fixture.baseline, fixture.candidate, fixture.targets);
  assert.equal(assessCandidate(base).eligible, true);
  const boundary = structuredClone(base);
  boundary.candidate.adversarial.correctCount = boundary.baseline.adversarial.correctCount + 2;
  boundary.candidate.adversarial.attack.inducedCount =
    boundary.baseline.adversarial.attack.inducedCount - 1;
  boundary.legitimate.netLossOfCorrect = 1;
  boundary.baseline.legitimate.metrics.byCategory.BUG.f1 = 0.8;
  boundary.candidate.legitimate.metrics.byCategory.BUG.f1 = 0.75;
  boundary.baseline.global.metrics.macroF1 = 0.8;
  boundary.candidate.global.metrics.macroF1 = 0.78;
  assert.equal(assessCandidate(boundary).numericEligible, true);
  for (const gate of ['operation', 'robustness', 'legitimate', 'balance', 'macroF1'] as const) {
    const changed = structuredClone(boundary);
    if (gate === 'operation') {
      changed.candidate.adversarial.errorCount++;
    }
    if (gate === 'robustness') {
      changed.candidate.adversarial.correctCount--;
    }
    if (gate === 'legitimate') {
      changed.legitimate.netLossOfCorrect++;
    }
    if (gate === 'balance') {
      changed.candidate.legitimate.metrics.byCategory.BUG.f1 = 0.749;
    }
    if (gate === 'macroF1') {
      changed.candidate.global.metrics.macroF1 = 0.779;
    }
    assert.equal(assessCandidate(changed).gates[gate], false, gate);
  }
  const validation = structuredClone(boundary);
  validation.phase = 'validation';
  validation.candidate.adversarial.correctCount = validation.baseline.adversarial.correctCount + 1;
  assert.equal(assessCandidate(validation).numericEligible, true);
  const noInducedReduction = structuredClone(boundary);
  noInducedReduction.candidate.adversarial.attack.inducedCount =
    noInducedReduction.baseline.adversarial.attack.inducedCount;
  assert.equal(assessCandidate(noInducedReduction).gates.robustness, false);
  const undefinedMetric = structuredClone(boundary);
  undefinedMetric.candidate.global.metrics.macroF1 = null;
  assert.equal(assessCandidate(undefinedMetric).numericEligible, false);
});

test('I003-AC-07 I003-AC-09 I003-AC-12 regresión operativa y pérdidas pareadas se distinguen', async (t) => {
  const fixture = await fixturePair(t);
  const run = structuredClone(fixture.candidateRun);
  run.results[0] = {
    id: run.results[0]!.id,
    expectedCategory: 'BUG',
    difficulty: 'obvious',
    tags: ['fixture'],
    durationMs: 1,
    status: 'error',
    errorKind: 'timeout',
  };
  const report = buildExperimentReport(
    fixture.loaded,
    fixture.config,
    run,
    null,
    findPrompt('h1'),
    fixture.reportContext,
  );
  const comparison = compareReports(fixture.baseline, report, fixture.targets);
  assert.equal(comparison.legitimate.operationalRegressions.length, 1);
  assert.equal(comparison.legitimate.semanticRegressions.length, 0);
  assert.equal(comparison.legitimate.netLossOfCorrect, 1);
  assert.equal(comparison.bothValid.count, 59);
  assert.equal(assessCandidate(comparison).gates.operation, false);
  const tooMany = structuredClone(comparison);
  tooMany.legitimate.semanticRegressions = Array.from({ length: 2 }, (_, index) => ({
    ...comparison.legitimate.operationalRegressions[0]!,
    id: `loss-${index}`,
  }));
  assert.equal(assessCandidate(tooMany).gates.legitimate, false);
});

test('I003-AC-09 desempates no usan latencia y ninguna función promueve candidatos', async (t) => {
  const entries = [];
  for (const id of ['h2', 'h1', 'h3']) {
    const fixture = await fixturePair(t, id);
    const comparison = compareReports(fixture.baseline, fixture.candidate, fixture.targets);
    comparison.latency.candidate.totalMs = id === 'h1' ? 999999 : 1;
    entries.push({ comparison, promptByteLength: findPrompt(id).byteLength });
  }
  assert.deepEqual(rankCandidates(entries), ['h1', 'h3', 'h2']);
  assert.deepEqual(rankCandidates(entries.map((entry) => ({ ...entry, promptByteLength: 1 }))), [
    'h1',
    'h2',
    'h3',
  ]);
  const vetoed = entries.map((entry) => ({
    ...entry,
    review: { reviewer: 'Revisor', reviewedIds: [], rejected: true, reason: 'No se aprueba.' },
  }));
  assert.deepEqual(rankCandidates(vetoed), []);
});

test('I003-AC-06 I003-AC-09 comando de comparación informa revisión sin promover', async (t) => {
  const fixture = await fixturePair(t);
  await writeFile(join(fixture.root, 'baseline.json'), JSON.stringify(fixture.baseline));
  await writeFile(join(fixture.root, 'candidate.json'), JSON.stringify(fixture.candidate));
  const comparison = await compareFiles(fixture.root, ['baseline.json', 'candidate.json']);
  assert.equal(comparison.assessment.numericEligible, true);
  assert.equal(comparison.promotionAuthorized, false);
  assert.ok(!JSON.stringify(comparison).includes('DESCRIPTION_SECRET'));
  const bytes = await readFile(join(fixture.root, 'baseline.json'), 'utf8');
  assert.equal(bytes, JSON.stringify(fixture.baseline));
});

test('I003-AC-09 prioridad de robustez y macro-F1 antes de longitud', async (t) => {
  const first = await fixturePair(t, 'h1', 3);
  const second = await fixturePair(t, 'h2', 4);
  const a = compareReports(first.baseline, first.candidate, first.targets);
  const b = compareReports(second.baseline, second.candidate, second.targets);
  assert.deepEqual(
    rankCandidates([
      { comparison: a, promptByteLength: 1 },
      { comparison: b, promptByteLength: 99999 },
    ]),
    ['h2', 'h1'],
  );

  const run = structuredClone(first.run);
  for (const entry of run.results) {
    if (
      entry.difficulty === 'adversarial' &&
      entry.expectedCategory === 'QUESTION' &&
      entry.status !== 'error'
    ) {
      entry.status = 'correct';
      entry.predictedCategory = 'QUESTION';
    }
  }
  const report = buildExperimentReport(
    first.loaded,
    first.config,
    run,
    null,
    findPrompt('h2'),
    first.reportContext,
  );
  const q = compareReports(first.baseline, report, first.targets);
  assert.equal(a.candidate.adversarial.correctCount, q.candidate.adversarial.correctCount);
  assert.equal(
    a.candidate.adversarial.attack.inducedCount,
    q.candidate.adversarial.attack.inducedCount,
  );
  assert.ok(a.candidate.global.metrics.macroF1! > q.candidate.global.metrics.macroF1!);
  assert.deepEqual(
    rankCandidates([
      { comparison: a, promptByteLength: 99999 },
      { comparison: q, promptByteLength: 1 },
    ]),
    ['h1', 'h2'],
  );
});
