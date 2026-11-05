import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateMetrics } from '../../src/evaluation/metrics.js';
import { categories } from '../../src/domain/classification.js';
import { result } from './helpers.js';

test('I002-AC-05 I002-AC-06 matriz asimétrica y métricas calculadas manualmente', () => {
  const results = [
    result('BUG', 'BUG', '1'),
    result('BUG', 'BUG', '2'),
    result('BUG', 'FEATURE', '3'),
    result('FEATURE', 'FEATURE', '4'),
    result('FEATURE', 'QUESTION', '5'),
    result('QUESTION', 'BUG', '6'),
    result('BUG', null, '7'),
    result('QUESTION', null, '8'),
  ];
  const metrics = calculateMetrics(results);

  assert.deepEqual(metrics.categoryOrder, ['BUG', 'FEATURE', 'QUESTION']);
  assert.deepEqual(metrics.confusionMatrix, {
    BUG: { BUG: 2, FEATURE: 1, QUESTION: 0 },
    FEATURE: { BUG: 0, FEATURE: 1, QUESTION: 1 },
    QUESTION: { BUG: 1, FEATURE: 0, QUESTION: 0 },
  });
  assert.equal(metrics.accuracy, 3 / 6);
  assert.equal(metrics.endToEndSuccessRate, 3 / 8);
  assert.equal(metrics.executionSuccessRate, 6 / 8);
  assert.deepEqual(metrics.byCategory.BUG, {
    plannedSupport: 4,
    validSupport: 3,
    errorCount: 1,
    precision: 2 / 3,
    recall: 2 / 3,
    f1: 2 / 3,
  });
  assert.deepEqual(metrics.byCategory.FEATURE, {
    plannedSupport: 2,
    validSupport: 2,
    errorCount: 0,
    precision: 1 / 2,
    recall: 1 / 2,
    f1: 1 / 2,
  });
  assert.deepEqual(metrics.byCategory.QUESTION, {
    plannedSupport: 2,
    validSupport: 1,
    errorCount: 1,
    precision: 0,
    recall: 0,
    f1: 0,
  });
  assert.ok(Math.abs(metrics.macroF1! - 7 / 18) < 1e-15);
});

test('I002-AC-06 ejemplo aprobado de denominadores 3/4, 3/6, 4/6', () => {
  const metrics = calculateMetrics([
    result('BUG', 'BUG', '1'),
    result('FEATURE', 'FEATURE', '2'),
    result('QUESTION', 'QUESTION', '3'),
    result('BUG', 'FEATURE', '4'),
    result('FEATURE', null, '5'),
    result('QUESTION', null, '6'),
  ]);
  assert.equal(metrics.accuracy, 3 / 4);
  assert.equal(metrics.endToEndSuccessRate, 3 / 6);
  assert.equal(metrics.executionSuccessRate, 4 / 6);
});

test('I002-AC-07 todas correctas, todas incorrectas y ninguna respuesta válida', () => {
  const perfect = calculateMetrics(
    categories.map((category, index) => result(category, category, String(index))),
  );
  assert.equal(perfect.accuracy, 1);
  assert.equal(perfect.macroF1, 1);
  assert.equal(perfect.endToEndSuccessRate, 1);
  assert.equal(perfect.executionSuccessRate, 1);

  const wrong = calculateMetrics([
    result('BUG', 'FEATURE', '1'),
    result('FEATURE', 'QUESTION', '2'),
    result('QUESTION', 'BUG', '3'),
  ]);
  assert.equal(wrong.accuracy, 0);
  assert.equal(wrong.macroF1, 0);
  assert.equal(wrong.endToEndSuccessRate, 0);
  assert.equal(wrong.executionSuccessRate, 1);

  const failed = calculateMetrics(
    categories.map((category, index) => result(category, null, String(index))),
  );
  assert.equal(failed.accuracy, null);
  assert.equal(failed.macroF1, null);
  assert.equal(failed.endToEndSuccessRate, 0);
  assert.equal(failed.executionSuccessRate, 0);

  for (const category of categories) {
    assert.equal(failed.byCategory[category].precision, null);
    assert.equal(failed.byCategory[category].recall, null);
    assert.equal(failed.byCategory[category].f1, null);
    assert.deepEqual(Object.values(failed.confusionMatrix[category]), [0, 0, 0]);
  }
});

test('I002-AC-07 clase sin predicciones y clase sin respuestas válidas', () => {
  const metrics = calculateMetrics([
    result('BUG', 'BUG', '1'),
    result('FEATURE', 'BUG', '2'),
    result('QUESTION', null, '3'),
  ]);
  assert.equal(metrics.byCategory.FEATURE.precision, 0);
  assert.equal(metrics.byCategory.FEATURE.recall, 0);
  assert.equal(metrics.byCategory.QUESTION.precision, 0);
  assert.equal(metrics.byCategory.QUESTION.recall, 0);
  assert.equal(metrics.byCategory.QUESTION.validSupport, 0);
  assert.equal(metrics.macroF1, 2 / 3 / 3);
  assert.deepEqual(JSON.parse(JSON.stringify(metrics)), metrics);

  const empty = calculateMetrics([]);
  assert.equal(empty.accuracy, null);
  assert.equal(empty.executionSuccessRate, 0);
});
