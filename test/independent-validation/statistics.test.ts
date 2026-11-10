import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrozenInputs } from '../../src/evaluation/independent-validation/protocol.js';
import {
  xorshift32,
  pairedBootstrap,
  practicalDecision,
} from '../../src/evaluation/independent-validation/statistics.js';
import { calculateMetrics } from '../../src/evaluation/metrics.js';
import { pairResults } from '../../src/evaluation/paired-results.js';
import type { EvaluationResult } from '../../src/evaluation/types.js';

test('I005-AC-11 xorshift32 pinned sequence, unsigned values and fixed seed', () => {
  const random = xorshift32();
  const values = Array.from({ length: 5 }, () => random() * 2 ** 32);
  assert.deepEqual(values, [1279779861, 2825294487, 1019067949, 3832752561, 2850843507]);
  assert.throws(() => xorshift32(0));
});

test('I005-AC-09/10/11 synthetic paired bootstrap reproducible, sign, strata, degeneracy and incomplete rejection', async () => {
  const { loaded } = await loadFrozenInputs(process.cwd());
  const results = loaded.dataset.examples.map((e) => ({
    id: e.id,
    expectedCategory: e.expectedCategory,
    difficulty: e.difficulty,
    tags: [...e.tags],
    durationMs: 1,
    status: 'correct' as const,
    predictedCategory: e.expectedCategory,
  }));
  const baseline: EvaluationResult[] = structuredClone(results);
  for (let i = 0; i < 9; i++) {
    const ref = baseline[i]!;
    baseline[i] = { ...ref, status: 'incorrect', predictedCategory: 'FEATURE' };
  }
  const estimate = pairedBootstrap(baseline, results);
  assert.equal(estimate.estimate, 9 / 90);
  assert.equal(estimate.resamples, 10000);
  assert.equal(estimate.seed, 5005);
  // Independently calculated from the pinned xorshift32 procedure and these nine corrections.
  assert.equal(estimate.lower, 5 / 90);
  assert.equal(estimate.upper, 13 / 90);
  assert.equal(estimate.lowerIndex, 249);
  assert.equal(estimate.upperIndex, 9749);
  assert.deepEqual(pairedBootstrap([...baseline].reverse(), [...results].reverse()), estimate);
  const swapped = pairedBootstrap(results, baseline);
  assert.equal(swapped.estimate, -9 / 90);
  assert.equal(pairedBootstrap(results, results).degenerate, true);
  assert.equal(pairedBootstrap(results, results).lower, 0);
  assert.throws(() => pairedBootstrap(results.slice(1), baseline.slice(1)));
  const pairs = pairResults(baseline, results);
  assert.equal(pairs.transitions.incorrect.correct, 9);
  assert.equal(calculateMetrics(baseline).endToEndSuccessRate, 81 / 90);
});

test('I005-AC-11 practical outcomes:8/9/10, ties, losses, known errors and uncertainty', () => {
  assert.equal(practicalDecision(8, true, 0, 0).outcome, 'improvement_below_threshold');
  for (const gain of [9, 10]) {
    assert.equal(
      practicalDecision(gain, true, 0, 0).outcome,
      'practical_confirmation_on_this_dataset',
    );
  }
  assert.equal(practicalDecision(0, true, 0, 0).outcome, 'net_tie');
  assert.equal(practicalDecision(-1, true, 0, 0).outcome, 'gemma_worse');
  assert.equal(practicalDecision(9, true, 1, 0).outcome, 'technical_inconclusive');
  assert.equal(practicalDecision(null, false, 0, 0).outcome, 'incomplete_or_uncertain');
  assert.equal(practicalDecision(9, true, 0, 1).outcome, 'incomplete_or_uncertain');
  assert.equal(practicalDecision(9, true, 0, 0).promotionAuthorized, false);
});

test('I005 I5 AC-11 independent mixed-sign oracle covers all nine strata', async () => {
  const { loaded } = await loadFrozenInputs(process.cwd());
  const perfect: EvaluationResult[] = loaded.dataset.examples.map((e) => ({
    id: e.id,
    expectedCategory: e.expectedCategory,
    difficulty: e.difficulty,
    tags: [...e.tags],
    durationMs: 1,
    status: 'correct',
    predictedCategory: e.expectedCategory,
  }));
  const baseline = structuredClone(perfect);
  const candidate = structuredClone(perfect);
  for (const category of ['BUG', 'FEATURE', 'QUESTION']) {
    for (const difficulty of ['obvious', 'complex', 'adversarial']) {
      const indexes = perfect
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.expectedCategory === category && r.difficulty === difficulty)
        .map(({ i }) => i);
      for (const [index, i] of indexes.entries()) {
        const r = perfect[i]!;
        const predictedCategory = r.expectedCategory === 'BUG' ? 'FEATURE' : 'BUG';
        if (index < 3) {
          baseline[i] = { ...r, status: 'incorrect', predictedCategory };
        } else if (index < 5) {
          candidate[i] = { ...r, status: 'incorrect', predictedCategory };
        }
      }
    }
  }
  const actual = pairedBootstrap(baseline, candidate);
  assert.equal(actual.estimate, 9 / 90);
  // Oracle computed independently with integer uint32 operations, not this TS implementation.
  assert.equal(actual.lower, -0.044444444444444446);
  assert.equal(actual.upper, 0.24444444444444444);
  assert.equal(actual.degenerate, false);
  assert.deepEqual(pairedBootstrap([...baseline].reverse(), [...candidate].reverse()), actual);
});
