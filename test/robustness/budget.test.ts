import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { baselinePrompt, findPrompt, type RegisteredPrompt } from '../../src/evaluation/prompts.js';
import {
  reserveAttempt,
  validateLedger,
  withExperimentLedger,
  type ExperimentLedger,
} from '../../src/evaluation/experiment-budget.js';
import { executeExperiment } from '../../src/evaluation/experiment.js';
import { sha256 } from '../../src/evaluation/dataset.js';
import { ClassificationError } from '../../src/application/classification-errors.js';
import { experimentProject } from './helpers.js';

const devHash = 'a'.repeat(64);
const valHash = 'b'.repeat(64);
const protocolHash = sha256('fixture protocol');

function fakePrompt(index: number): RegisteredPrompt {
  return { ...findPrompt('h1'), id: `fixture-${index}`, sha256: sha256(`fixture-${index}`) };
}

function finish(
  ledger: ExperimentLedger,
  prompt: RegisteredPrompt,
  phase: 'development' | 'validation',
  hash: string,
) {
  const attempt = reserveAttempt(ledger, prompt, phase, hash, protocolHash);
  attempt.status = 'completed';
  attempt.reportRunId = `fixture-${ledger.attempts.length}`;
  return attempt;
}

test('I003-AC-04 máximo cinco candidatos, ocho runs y 480 inferencias previstas', () => {
  const ledger: ExperimentLedger = { schemaVersion: 1, attempts: [] };
  finish(ledger, baselinePrompt, 'development', devHash);
  for (let index = 1; index <= 5; index++) {
    finish(ledger, fakePrompt(index), 'development', devHash);
  }
  finish(ledger, baselinePrompt, 'validation', valHash);
  finish(ledger, fakePrompt(1), 'validation', valHash);
  assert.equal(ledger.attempts.length, 8);
  assert.equal(
    ledger.attempts.reduce((sum, item) => sum + item.plannedInferences, 0),
    480,
  );
  validateLedger(ledger);
  assert.throws(() => reserveAttempt(ledger, fakePrompt(6), 'development', devHash, protocolHash));
  assert.throws(() => reserveAttempt(ledger, fakePrompt(2), 'validation', valHash, protocolHash));
});

test('I003-AC-04 I003-AC-12 reservas, interrupciones, versiones y alias no permiten reintentos', () => {
  const ledger: ExperimentLedger = { schemaVersion: 1, attempts: [] };
  assert.throws(() => reserveAttempt(ledger, fakePrompt(1), 'development', devHash, protocolHash));
  finish(ledger, baselinePrompt, 'development', devHash);
  const candidate = reserveAttempt(ledger, fakePrompt(1), 'development', devHash, protocolHash);
  assert.throws(() => reserveAttempt(ledger, fakePrompt(2), 'development', devHash, protocolHash));
  candidate.status = 'incomplete';
  assert.throws(() => reserveAttempt(ledger, fakePrompt(1), 'development', devHash, protocolHash));
  assert.throws(() =>
    reserveAttempt(ledger, { ...fakePrompt(1), id: 'alias' }, 'development', devHash, protocolHash),
  );
  assert.throws(() =>
    reserveAttempt(
      ledger,
      { ...fakePrompt(1), version: 2, sha256: sha256('changed') },
      'development',
      devHash,
      protocolHash,
    ),
  );
  assert.throws(() => reserveAttempt(ledger, baselinePrompt, 'development', devHash, protocolHash));
  finish(ledger, baselinePrompt, 'validation', valHash);
  assert.throws(() => reserveAttempt(ledger, fakePrompt(1), 'validation', valHash, protocolHash));
  assert.throws(() => validateLedger({ schemaVersion: 1, attempts: [{ id: 'incomplete' }] }));
});

test('I003-AC-04 un protocolo distinto no reutiliza el control de fase', () => {
  const ledger: ExperimentLedger = { schemaVersion: 1, attempts: [] };
  finish(ledger, baselinePrompt, 'development', devHash);
  assert.throws(() =>
    reserveAttempt(ledger, fakePrompt(1), 'development', devHash, sha256('changed protocol')),
  );
  assert.equal(ledger.attempts.length, 1);
});

test('I003-AC-04 bloqueo exclusivo y persistencia de reserva conservadora', async (t) => {
  const { root } = await experimentProject(t);
  const directory = join(root, 'budget');
  await assert.rejects(
    withExperimentLedger(directory, async (ledger, save) => {
      reserveAttempt(ledger, baselinePrompt, 'development', devHash, protocolHash);
      await save();
      await assert.rejects(
        withExperimentLedger(directory, async () => undefined),
        { code: 'EEXIST' },
      );
      throw new Error('fallo simulado');
    }),
  );
  const saved = JSON.parse(await readFile(join(directory, 'i003-budget.json'), 'utf8'));
  validateLedger(saved);
  assert.equal(saved.attempts[0]!.status, 'reserved');
  await assert.rejects(
    withExperimentLedger(directory, async (ledger) =>
      reserveAttempt(ledger, baselinePrompt, 'development', devHash, protocolHash),
    ),
  );
});

test('I003-AC-12 error conocido continúa; inesperado deja informe parcial sin reintento', async (t) => {
  const { root } = await experimentProject(t);
  let calls = 0;
  const baseline = await executeExperiment(root, 'development', 'i001-original', {}, () => ({
    async classify() {
      return { category: 'BUG' };
    },
  }));
  assert.equal(baseline.exitCode, 0);
  const response = await executeExperiment(root, 'development', 'h1', {}, () => ({
    async classify() {
      calls++;
      throw new TypeError('PROGRAMMING_SECRET');
    },
  }));
  assert.equal(response.exitCode, 1);
  assert.equal(calls, 1);
  const output = JSON.parse(response.output);
  const report = JSON.parse(await readFile(join(root, output.reportPath), 'utf8'));
  assert.equal(report.complete, false);
  assert.equal(report.metrics, null);
  assert.equal(report.results[0].errorKind, 'unexpected_error');
  assert.ok(!response.output.includes('PROGRAMMING_SECRET'));
  const again = await executeExperiment(root, 'development', 'h1', {}, () => ({
    async classify() {
      calls++;
      return { category: 'BUG' };
    },
  }));
  assert.equal(again.exitCode, 1);
  assert.equal(calls, 1);
  const ledger = JSON.parse(await readFile(join(root, 'evals/reports/i003-budget.json'), 'utf8'));
  assert.equal(ledger.attempts.length, 2);
  assert.equal(ledger.attempts[1].status, 'incomplete');
  await writeFile(join(root, 'evals/reports/i003-budget.json'), '{bad');
  assert.equal(
    (
      await executeExperiment(root, 'development', 'h2', {}, () => ({
        async classify() {
          calls++;
          return { category: 'BUG' };
        },
      }))
    ).exitCode,
    1,
  );
  assert.equal(calls, 1);
});

test('I003-AC-12 errores conocidos se registran sin reintentos ni falsa resistencia', async (t) => {
  const { root } = await experimentProject(t);
  let calls = 0;
  const response = await executeExperiment(root, 'development', 'i001-original', {}, () => ({
    async classify() {
      calls++;
      throw new ClassificationError('timeout');
    },
  }));
  assert.equal(response.exitCode, 0);
  assert.equal(calls, 60);
  const summary = JSON.parse(response.output);
  const report = JSON.parse(await readFile(join(root, summary.reportPath), 'utf8'));
  assert.equal(report.execution.errorCount, 60);
  assert.equal(report.metrics.accuracy, null);
  assert.ok(
    report.results.every(
      (result: { status: string; errorKind: string }) =>
        result.status === 'error' && result.errorKind === 'timeout',
    ),
  );
});
