import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ClassificationError,
  type ProviderFailure,
} from '../../src/application/classification-errors.js';
import { runEvaluation } from '../../src/evaluation/run-evaluation.js';
import { fixtureDataset } from './helpers.js';

test('I002-AC-03 secuencial, orden estable y solo descripción normalizada', async () => {
  const examples = fixtureDataset().examples.slice(0, 3);
  const seen: string[] = [];
  let active = 0;
  let maximumActive = 0;
  const run = await runEvaluation(examples, {
    async classify(...args) {
      assert.equal(args.length, 1);
      active++;
      maximumActive = Math.max(maximumActive, active);
      seen.push(args[0]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active--;
      return { category: 'BUG' };
    },
  });

  assert.deepEqual(
    seen,
    examples.map((example) => example.description.trim()),
  );
  assert.deepEqual(
    run.results.map((entry) => entry.id),
    examples.map((example) => example.id),
  );
  assert.equal(maximumActive, 1);
  assert.equal(run.complete, true);
  assert.ok(run.results.every((entry) => entry.durationMs >= 0));
});

test('I002-AC-04 causas conocidas continúan sin reintentos y conservan estados', async () => {
  const kinds: ProviderFailure[] = [
    'timeout',
    'connection_error',
    'http_error',
    'invalid_response',
  ];
  const examples = fixtureDataset().examples.slice(0, 6);
  let calls = 0;
  const run = await runEvaluation(examples, {
    async classify() {
      const index = calls++;

      if (index < 4) {
        throw new ClassificationError(kinds[index]!);
      }

      return { category: index === 4 ? 'BUG' : 'FEATURE' };
    },
  });

  assert.equal(calls, 6);
  assert.equal(run.complete, true);
  assert.equal(run.termination, null);
  assert.deepEqual(
    run.results.map((entry) => entry.status),
    ['error', 'error', 'error', 'error', 'correct', 'incorrect'],
  );
  assert.deepEqual(
    run.results.slice(0, 4).map((entry) => entry.status === 'error' && entry.errorKind),
    kinds,
  );
});

test('I002-AC-10 I002-AC-11 excepción inesperada detiene y no filtra el error', async () => {
  let calls = 0;
  const run = await runEvaluation(fixtureDataset().examples, {
    async classify() {
      calls++;

      if (calls === 2) {
        throw new TypeError('PROVIDER_SECRET');
      }

      return { category: 'BUG' };
    },
  });

  assert.equal(calls, 2);
  assert.equal(run.complete, false);
  assert.equal(run.termination, 'unexpected_error');
  assert.equal(run.results.at(-1)?.status, 'error');
  assert.ok(!JSON.stringify(run).includes('PROVIDER_SECRET'));
  assert.ok(!JSON.stringify(run).includes('DESCRIPTION_SECRET'));
  assert.ok(!JSON.stringify(run).includes('REFERENCE_SECRET'));
});
