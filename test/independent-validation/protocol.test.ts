import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseIndependentDataset,
  loadFrozenInputs,
  loadOperation,
  validateOperation,
  models,
} from '../../src/evaluation/independent-validation/protocol.js';
import { executeCli, parseArguments } from '../../src/evaluation/independent-validation/main.js';
import { parseDataset } from '../../src/evaluation/dataset.js';
import { loadConfig } from '../../src/config.js';
import { fixture } from './helpers.js';

// All providers and observers in these tests are injected; no local model endpoint is used.
test('I005-AC-01/02/03 valid frozen 90 cases and historical loader unchanged', async () => {
  const inputs = await loadFrozenInputs(process.cwd());
  assert.equal(inputs.loaded.dataset.examples.length, 90);
  assert.equal(inputs.loaded.dataset.version, 2);
  assert.equal(Object.keys(inputs.targets).length, 15);
  assert.throws(() => parseDataset(JSON.stringify(inputs.loaded.dataset)));
});

test('I005-AC-01 strict shape, quotas, IDs, categories and Unicode', async () => {
  const data = (await loadFrozenInputs(process.cwd())).loaded.dataset;
  for (const damage of [
    'schema',
    'version',
    'extra',
    'duplicate',
    'quota',
    'category',
    'empty',
    'long',
    'coercion',
  ]) {
    const d = structuredClone(data);
    if (damage === 'schema') {
      d.schemaVersion = 2 as 1;
    } else if (damage === 'version') {
      d.version = 1;
    } else if (damage === 'extra') {
      Object.assign(d.examples[0]!, { scenarioId: 'unapproved-field' });
    } else if (damage === 'duplicate') {
      d.examples[1]!.id = d.examples[0]!.id;
    } else if (damage === 'quota') {
      d.examples[0]!.difficulty = 'complex';
    } else if (damage === 'category') {
      d.examples[0]!.id = 'I005-FEATURE-001';
    } else if (damage === 'empty') {
      d.examples[0]!.description = '  ';
    } else if (damage === 'long') {
      d.examples[0]!.description = '🌙'.repeat(4001);
    } else {
      Object.assign(d.examples[0]!, { description: 123 });
    }
    assert.throws(() => parseIndependentDataset(JSON.stringify(d)), damage);
  }
  const unicode = structuredClone(data);
  unicode.examples[0]!.description = '🌙'.repeat(4000);
  assert.equal(parseIndependentDataset(JSON.stringify(unicode)).examples.length, 90);
});

test('I005-AC-03/05 every frozen artifact and sidecar are authenticated before use', async (t) => {
  for (const artifact of ['dataset', 'matrix', 'adversarialMap', 'humanReview', 'specification']) {
    const f = await fixture(t, false);
    const ref = f.inputs.artifacts[artifact as keyof typeof f.inputs.artifacts];
    await writeFile(join(f.root, ref.path), '{}');
    await assert.rejects(loadFrozenInputs(f.root));
    const response = await f.run(models[0]);
    assert.equal(response.exitCode, 1);
    assert.equal(f.calls.length, 0);
  }
  const f = await fixture(t, false);
  await writeFile(join(f.root, 'evals/experiments/i005-manifest.json.sha256'), 'bad');
  await assert.rejects(loadFrozenInputs(f.root));
});

test('I005-AC-04/05 operation rejects changed model, prompt, temperature, timeout or budget', async () => {
  const { operation } = await loadOperation(process.cwd());
  for (const key of [
    'model',
    'template',
    'prompt',
    'temperature',
    'endpoint',
    'timeout',
    'budget',
    'freeze',
  ]) {
    const op = structuredClone(operation);
    if (key === 'model') {
      op.models[models[0]].digest = 'f'.repeat(64);
    } else if (key === 'template') {
      op.models[models[1]].templateSha256 = 'f'.repeat(64);
    } else if (key === 'prompt') {
      Object.assign(op.protocol, { prompt: 'changed' });
    } else if (key === 'temperature') {
      Object.assign(op.protocol.inference.options, { temperature: 1 });
    } else if (key === 'endpoint') {
      Object.assign(op.protocol.inference, { endpoint: '/api/generate' });
    } else if (key === 'timeout') {
      Object.assign(op.protocol, { timeoutMs: 30000 });
    } else if (key === 'budget') {
      Object.assign(op.protocol, { maxInferences: 181 });
    } else {
      op.freezeManifestSha256 = 'f'.repeat(64);
    }
    assert.throws(() => validateOperation(op), key);
  }
});

test('I005-AC-05 CLI fail closed, separate initialize and no bypass or environment authorization', async (t) => {
  const f = await fixture(t, false);
  for (const a of Object.values(f.op.authorization)) {
    a.approved = false;
  }
  await f.saveOperation();
  for (const args of [
    [],
    ['--force'],
    ['--phase', 'validation', '--model', 'other'],
    ['--phase', 'validation', '--model', models[0], '--dataset', 'other'],
    ['--initialize', '--force'],
  ]) {
    assert.throws(() => parseArguments(args));
    assert.equal((await executeCli(f.root, args, f.dependencies)).exitCode, 1);
  }
  for (const model of models) {
    assert.equal((await f.run(model)).exitCode, 1);
  }
  assert.equal((await executeCli(f.root, ['--initialize'], f.dependencies)).exitCode, 1);
  assert.equal(f.counters().observerCreations, 0);
  assert.equal(f.calls.length, 0);
  await assert.rejects(readdir(join(f.root, 'evals/reports')), { code: 'ENOENT' });
  assert.equal(loadConfig({}).model, models[0]);
  assert.equal(loadConfig({}).timeoutMs, 30000);
});

test('I005-AC-05/13 validation command is read only and does not construct external effects', async (t) => {
  const f = await fixture(t, false);
  const opPath = join(f.root, 'evals/experiments/i005-operation.json');
  const bytes = await readFile(opPath);
  const result = await executeCli(f.root, ['--validate'], {
    observer() {
      assert.fail('No observation allowed');
    },
    classifier() {
      assert.fail('No inference allowed');
    },
  });
  assert.equal(result.exitCode, 0, result.output);
  assert.equal(JSON.parse(result.output).inferencesAdded, 0);
  assert.deepEqual(await readFile(opPath), bytes);
  await assert.rejects(readdir(join(f.root, 'evals/reports')), { code: 'ENOENT' });
});
