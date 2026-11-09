import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pairResults } from '../../src/evaluation/paired-results.js';
import { result } from '../evaluation/helpers.js';
import {
  loadManifest,
  loadInputs,
  models,
} from '../../src/evaluation/model-comparison/protocol.js';
import { validateLedger, withLedger } from '../../src/evaluation/model-comparison/budget.js';
import { project } from './helpers.js';

test('I004-AC-05 emparejamiento puro independiente del orden, IDs, etiquetas y soporte', () => {
  const baseline = [result('BUG', 'BUG', 'one'), result('FEATURE', null, 'two')];
  const candidate = [result('FEATURE', 'FEATURE', 'two'), result('BUG', 'FEATURE', 'one')];
  const paired = pairResults(baseline, candidate);
  assert.equal(paired.transitions.correct.incorrect, 1);
  assert.equal(paired.transitions.error.correct, 1);
  assert.equal(paired.pairs[0]!.id, 'two');
  assert.throws(() => pairResults(baseline, [candidate[0]!, candidate[0]!]));
  assert.throws(() => pairResults(baseline, [candidate[0]!]));
  assert.throws(() =>
    pairResults(baseline, [{ ...candidate[0]!, expectedCategory: 'QUESTION' }, candidate[1]!]),
  );
  assert.throws(() =>
    pairResults(baseline, [{ ...candidate[0]!, tags: ['changed'] }, candidate[1]!]),
  );
});

test('I004-AC-10 ledger persistente no permite corrupción, duplicados, quinto brazo o concurrencia', async (t) => {
  const f = await project(t);
  await f.compatibilityRuns();
  const directory = join(f.root, 'evals/reports/i004');
  const ledger = JSON.parse(await readFile(join(directory, 'budget.json'), 'utf8'));
  validateLedger(ledger);
  const changed = structuredClone(ledger);
  changed.attempts[0]!.attempted = 4;
  assert.throws(() => validateLedger(changed));
  const repeated = structuredClone(ledger);
  repeated.attempts.push(repeated.attempts[1]!);
  assert.throws(() => validateLedger(repeated));
  const excess = structuredClone(ledger);
  excess.attempts = [...excess.attempts, ...excess.attempts, excess.attempts[0]!];
  assert.throws(() => validateLedger(excess));
  const lock = join(directory, 'budget.lock');
  await writeFile(lock, 'fixture', { flag: 'wx' });
  assert.equal((await f.run('benchmark', models[0])).exitCode, 1);
  assert.equal(f.counters().calls, 6);
});

test('I004-AC-01 I004-AC-02 inputs congelados y compatibilidad independiente, versión/propiedades estrictas', async (t) => {
  const f = await project(t);
  const source = await loadManifest(f.root);
  const inputs = await loadInputs(f.root, source.manifest);
  assert.equal(new Set(inputs.compatibility.examples.map((e) => e.expectedCategory)).size, 3);
  await writeFile(
    join(f.root, source.manifest.benchmark.path),
    JSON.stringify({ ...inputs.benchmark.dataset, version: 3 }),
  );
  await assert.rejects(loadInputs(f.root, source.manifest));
});

test('I004-AC-10 fallo de escritura conserva reserva y resultados sin permitir repetición', async (t) => {
  const f = await project(t);
  const directory = join(f.root, 'evals/reports/i004');
  let injected = false;
  const dependencies = { ...f.dependencies };
  const observer = f.dependencies.observer(f.manifest);
  observer.residency = async () => {
    if (!injected) {
      injected = true;
      // Rename of the next progress update will fail, leaving the preceding reservation intact.
      const { rename } = await import('node:fs/promises');
      await rename(join(directory, 'budget.json'), join(directory, 'budget-recovery.json'));
      await mkdir(join(directory, 'budget.json'));
    }
    return { recordedAt: new Date().toISOString(), models: [] };
  };
  dependencies.observer = () => observer;
  const { executeModelEvaluation } =
    await import('../../src/evaluation/model-comparison/execute.js');
  const response = await executeModelEvaluation(f.root, 'compatibility', models[0], dependencies);
  assert.equal(response.exitCode, 1);
  assert.equal(f.counters().calls, 1);
  const saved = JSON.parse(await readFile(join(directory, 'budget-recovery.json'), 'utf8'));
  assert.equal(saved.attempts[0].attempted, 1);
  assert.equal(saved.attempts[0].results.length, 1);
  assert.equal(saved.attempts[0].status, 'reserved');
  assert.equal((await f.run('compatibility', models[0])).exitCode, 1);
});
