import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDataset } from '../../src/evaluation/tool-calling/dataset.js';
import { getIncidentById } from '../../src/application/get-incident-by-id.js';
import { fixtureRepository } from '../../src/evaluation/tool-calling/fixture-repository.js';
import { IncidentRepositoryError } from '../../src/application/tool-calling-errors.js';
import { candidate } from './helpers.js';

test('AC-22: candidate has exact quotas, ten annotated pairs, six attacks and four ambiguous cases', async () => {
  const dataset = await candidate();
  assert.equal(dataset.examples.length, 60);
  assert.deepEqual(
    [...new Set(dataset.examples.map((example) => example.group))].map(
      (group) => dataset.examples.filter((example) => example.group === group).length,
    ),
    [10, 10, 20, 10, 10],
  );
  assert.equal(dataset.counterfactualPairs.length, 10);
  assert.equal(dataset.examples.filter((example) => example.adversarial).length, 6);
  assert.equal(dataset.examples.filter((example) => example.tags.includes('ambiguous')).length, 4);
  assert.equal(dataset.reviewStatus, 'CANDIDATE');
});

test('AC-22: strict schema rejects coercion, extra fields, duplicate IDs, invalid quotas and tool mismatches', async () => {
  for (const mutate of [
    (data: any) => {
      data.examples[0].extra = true;
    },
    (data: any) => {
      data.examples[0].id += '\n';
    },
    (data: any) => {
      data.examples[40].expectedTool.incidentId += '\n';
    },
    (data: any) => {
      data.examples[0].toolExpected = 'false';
    },
    (data: any) => {
      data.examples[0].id = data.examples[1].id;
    },
    (data: any) => {
      data.examples[0].group = 'lookup_required';
    },
    (data: any) => {
      data.examples[20].expectedTool = null;
    },
    (data: any) => {
      data.examples[20].fixture.incidents[0].id += '\n';
    },
    (data: any) => {
      data.examples[20].fixture.unavailableIds = [data.examples[20].fixture.incidents[0].id];
    },
    (data: any) => {
      data.examples[40].fixture.unavailableIds = [data.examples[40].expectedTool.incidentId];
    },
    (data: any) => {
      data.examples[50].adversarial = null;
    },
  ]) {
    const data = await candidate();
    mutate(data);
    assert.throws(() => parseDataset(JSON.stringify(data)));
  }
});

test('AC-22: pair integrity rejects missing, repeated, orphaned or unannotated members', async () => {
  for (const mutate of [
    (data: any) => {
      data.counterfactualPairs[0].caseIds[0] = 'I006-999';
    },
    (data: any) => {
      data.counterfactualPairs[1].id = data.counterfactualPairs[0].id;
    },
    (data: any) => {
      data.examples[0].counterfactualPairId = 'orphan';
    },
    (data: any) => {
      data.examples[20].counterfactualPairId = null;
    },
    (data: any) => {
      data.counterfactualPairs[1].caseIds = data.counterfactualPairs[0].caseIds;
    },
  ]) {
    const data = await candidate();
    mutate(data);
    assert.throws(() => parseDataset(JSON.stringify(data)));
  }
});

test('AC-22: fixtures return only the actual ID, are isolated and simulate controlled unavailability', async () => {
  const dataset = await candidate();
  const example = dataset.examples[20]!;
  const repo = fixtureRepository(example.fixture);
  const options = { timeoutMs: 5000 };
  assert.equal(await repo.getById('INC-999999', options), null);
  const found = await repo.getById(example.expectedTool!.incidentId, options);
  assert.deepEqual(found, example.fixture.incidents[0]);
  found!.title = 'changed';
  assert.notEqual(
    (await repo.getById(example.expectedTool!.incidentId, options))!.title,
    'changed',
  );
  const unavailable = dataset.examples[45]!;
  await assert.rejects(
    fixtureRepository(unavailable.fixture).getById(unavailable.expectedTool!.incidentId, options),
    IncidentRepositoryError,
  );
  assert.equal(
    await fixtureRepository({ incidents: [], unavailableIds: [] }).getById(
      unavailable.expectedTool!.incidentId,
      options,
    ),
    null,
  );
});

test('AC-05/06/22: approved conditional fixtures yield NOT_FOUND and UNAVAILABLE with explicit category expectations', async () => {
  const dataset = await candidate();
  for (const [id, outcome, category] of [
    ['I006-041', 'NOT_FOUND', 'FEATURE'],
    ['I006-047', 'UNAVAILABLE', 'QUESTION'],
  ] as const) {
    const example = dataset.examples.find((item) => item.id === id)!;
    const result = await getIncidentById(
      fixtureRepository(example.fixture),
      {
        name: example.expectedTool!.name,
        arguments: { incidentId: example.expectedTool!.incidentId },
      },
      { timeoutMs: 5000 },
    );
    assert.equal(result.status, outcome);
    assert.deepEqual(example.expectedFinal, { status: 'CLASSIFIED', category });
    assert.equal(example.toolExpected, true);
  }
});
