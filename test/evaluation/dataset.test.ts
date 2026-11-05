import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { categories } from '../../src/domain/classification.js';
import { parseDataset, loadDataset, sha256 } from '../../src/evaluation/dataset.js';
import { fixtureDataset } from './helpers.js';

test('I002-AC-01 dataset oficial completo: 60 casos, 20 por categoría, 10/7/3', async () => {
  const path = 'evals/datasets/incidents-v1.json';
  const loaded = await loadDataset(path, path);
  assert.equal(loaded.dataset.examples.length, 60);
  assert.equal(loaded.sha256, sha256(await readFile(path)));

  for (const category of categories) {
    const examples = loaded.dataset.examples.filter(
      (example) => example.expectedCategory === category,
    );
    assert.equal(examples.length, 20);
    assert.deepEqual(
      ['obvious', 'complex', 'adversarial'].map(
        (difficulty) => examples.filter((example) => example.difficulty === difficulty).length,
      ),
      [10, 7, 3],
    );
    assert.ok(examples.every((example) => example.rationale.trim().length > 0));
  }
});

test('I002-AC-02 validación estricta sin coerción ni modificaciones', () => {
  const dataset = fixtureDataset();
  const original = JSON.stringify(dataset);
  assert.deepEqual(parseDataset(original), dataset);
  assert.equal(JSON.stringify(dataset), original);
  assert.throws(() => parseDataset('{'));

  for (const invalid of [
    null,
    [],
    {},
    { ...dataset, extra: true },
    { ...dataset, schemaVersion: '1' },
    { ...dataset, version: 0 },
    { ...dataset, id: '  ' },
    { ...dataset, examples: dataset.examples.slice(1) },
  ]) {
    assert.throws(() => parseDataset(JSON.stringify(invalid)));
  }

  for (const patch of [
    { id: '' },
    { description: 1 },
    { description: ' \n\t' },
    { description: 'x'.repeat(4001) },
    { description: '😀'.repeat(4001) },
    { expectedCategory: 'bug' },
    { difficulty: 'hard' },
    { tags: [] },
    { tags: ['a', 'a'] },
    { tags: [' '] },
    { rationale: '' },
    { extra: true },
  ]) {
    const changed = fixtureDataset();
    Object.assign(changed.examples[0]!, patch);
    assert.throws(() => parseDataset(JSON.stringify(changed)), JSON.stringify(patch));
  }

  for (const field of [
    'id',
    'description',
    'expectedCategory',
    'difficulty',
    'tags',
    'rationale',
  ]) {
    const changed = fixtureDataset();
    delete (changed.examples[0] as unknown as Record<string, unknown>)[field];
    assert.throws(() => parseDataset(JSON.stringify(changed)));
  }
});

test('I002-AC-02 cuotas, IDs, duplicados normalizados y límite Unicode', () => {
  for (const kind of ['id', 'description', 'category', 'difficulty']) {
    const dataset = fixtureDataset();
    const first = dataset.examples[0]!;
    const second = dataset.examples[1]!;

    if (kind === 'id') {
      second.id = first.id;
    } else if (kind === 'description') {
      second.description = first.description.trim();
    } else if (kind === 'category') {
      first.expectedCategory = 'FEATURE';
    } else {
      first.difficulty = 'complex';
    }

    assert.throws(() => parseDataset(JSON.stringify(dataset)));
  }

  const dataset = fixtureDataset();
  dataset.examples[0]!.description = '😀'.repeat(4000);
  assert.equal(parseDataset(JSON.stringify(dataset)).examples[0]!.description, '😀'.repeat(4000));
});
