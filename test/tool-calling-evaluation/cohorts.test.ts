import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../../src/evaluation/dataset.js';
import { loadDataset, parseDataset } from '../../src/evaluation/tool-calling/dataset.js';
import {
  cohortSettings,
  plannedPhases,
  type EvaluationCohort,
} from '../../src/evaluation/tool-calling/protocol.js';
import { extractIncidentReferences } from '../../src/application/incident-references.js';
import { getIncidentById } from '../../src/application/get-incident-by-id.js';
import { fixtureRepository } from '../../src/evaluation/tool-calling/fixture-repository.js';
import {
  readAuthorization,
  requireAuthorization,
  withControl,
  type Authorization,
} from '../../src/evaluation/tool-calling/control.js';
import { buildReport, saveReport } from '../../src/evaluation/tool-calling/report.js';
import {
  effectiveIdentity,
  main,
  runControlledEvaluation,
} from '../../src/evaluation/tool-calling/main.js';
import { identity, perfectResults } from './helpers.js';

const holdoutPath = 'evals/datasets/incidents-tool-calling-holdout-v1.json';
const holdoutIdentity = {
  ...identity,
  cohort: 'INDEPENDENT_HOLDOUT' as const,
  maximumInferences: 105,
};

async function holdout() {
  return (await loadDataset(holdoutPath)).dataset;
}

test('AC-22/26 both frozen cohorts have unique namespaces, strict quotas, hashes, and independently derived budgets', async () => {
  for (const [cohort, withoutIds, withIds, budget] of [
    ['KNOWN_REGRESSION', 16, 44, 104],
    ['INDEPENDENT_HOLDOUT', 15, 45, 105],
  ] as const) {
    const settings = cohortSettings(cohort);
    const { dataset, hash } = await loadDataset(join('evals/datasets', settings.datasetFile));
    assert.equal(dataset.id, settings.datasetId);
    const auth = await readAuthorization(join('evals/experiments', settings.authorizationFile));
    assert.equal(auth.datasetHash, hash);
    assert.equal(auth.cohort, cohort);
    assert.equal(auth.initialize, false);
    assert.equal(auth.execute, false);
    assert.equal(auth.identityHash, null);
    assert.equal(auth.approvalReference, null);
    assert.equal(
      dataset.examples.filter((e) => plannedPhases(e.description).length === 1).length,
      withoutIds,
    );
    assert.equal(
      dataset.examples.filter((e) => plannedPhases(e.description).length === 2).length,
      withIds,
    );
    assert.equal(
      dataset.examples.reduce((n, e) => n + plannedPhases(e.description).length, 0),
      budget,
    );
    assert.equal(settings.maximumInferences, budget);
    assert.equal(auth.maximumInferences, budget);
    assert.equal(dataset.examples.length, 60);
    assert.equal(new Set(dataset.examples.map((e) => e.id)).size, 60);
    for (const example of dataset.examples) {
      if (example.expectedTool) {
        assert.ok(
          extractIncidentReferences(example.description).includes(example.expectedTool.incidentId),
        );
      }
    }
  }
  const { hash } = await loadDataset(holdoutPath);
  assert.equal((await readFile(`${holdoutPath}.sha256`, 'utf8')).trim(), hash);
  assert.equal(
    (await loadDataset('evals/datasets/incidents-tool-calling-v1.json')).hash,
    'fa5b19d7783417220d2b852eabe9260352ba808a4307676f6a20fa86a4562490',
  );
});

test('AC-22 holdout expectations, availability, multiple and invalid references, and controlled pairs are consistent', async () => {
  const dataset = await holdout();
  const counts = {
    BUG: 0,
    FEATURE: 0,
    QUESTION: 0,
    abstention: 0,
    FOUND: 0,
    NOT_FOUND: 0,
    UNAVAILABLE: 0,
  };
  for (const e of dataset.examples) {
    if (e.expectedFinal.category) {
      counts[e.expectedFinal.category]++;
    } else {
      counts.abstention++;
    }
    if (e.expectedTool) {
      const tool = await getIncidentById(
        fixtureRepository(e.fixture),
        { name: e.expectedTool.name, arguments: { incidentId: e.expectedTool.incidentId } },
        { timeoutMs: 5000 },
      );
      counts[tool.status]++;
      if (tool.status === 'FOUND') {
        assert.equal(tool.incident.category, e.expectedFinal.category);
      }
    }
  }
  assert.deepEqual(counts, {
    BUG: 17,
    FEATURE: 17,
    QUESTION: 16,
    abstention: 10,
    FOUND: 23,
    NOT_FOUND: 5,
    UNAVAILABLE: 5,
  });
  assert.equal(
    dataset.examples.filter((e) => extractIncidentReferences(e.description).length > 1).length,
    5,
  );
  assert.equal(
    dataset.examples.filter((e) => e.tags.includes('invalid_id') || e.tags.includes('partial_id'))
      .length,
    3,
  );
  for (const [index, pair] of dataset.counterfactualPairs.entries()) {
    const a = dataset.examples.find((e) => e.id === pair.caseIds[0])!;
    const b = dataset.examples.find((e) => e.id === pair.caseIds[1])!;
    if (index < 5) {
      assert.equal(a.description, b.description);
      assert.deepEqual(a.expectedTool, b.expectedTool);
      assert.notEqual(a.expectedFinal.category, b.expectedFinal.category);
    } else {
      assert.deepEqual(a.fixture, b.fixture);
      assert.deepEqual(a.expectedFinal, b.expectedFinal);
      assert.equal(a.toolExpected, false);
      assert.equal(b.toolExpected, true);
      assert.deepEqual(
        extractIncidentReferences(a.description),
        extractIncidentReferences(b.description),
      );
    }
  }
  const known = (await loadDataset('evals/datasets/incidents-tool-calling-v1.json')).dataset;
  assert.ok(
    dataset.examples.every(
      (e) => !known.examples.some((k) => k.description === e.description || k.id === e.id),
    ),
  );
  const crossed = structuredClone(dataset);
  crossed.examples[0]!.id = 'I006-001';
  assert.throws(() => parseDataset(JSON.stringify(crossed)), /case ID/);
});

test('AC-23/26 serialized cohort results stay separate, require both cohorts and never grant acceptance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'i006-cohort-reports-'));
  try {
    for (const cohort of ['KNOWN_REGRESSION', 'INDEPENDENT_HOLDOUT'] as const) {
      const settings = cohortSettings(cohort);
      const { dataset } = await loadDataset(join('evals/datasets', settings.datasetFile));
      const runIdentity = cohort === 'KNOWN_REGRESSION' ? identity : holdoutIdentity;
      const report = buildReport(
        dataset,
        runIdentity,
        perfectResults(dataset),
        new Date().toISOString(),
      );
      const path = await saveReport(root, report);
      const serialized = JSON.parse(await readFile(path, 'utf8'));
      assert.equal(serialized.results.length, 60);
      assert.equal(serialized.dataset.cohort, cohort);
      assert.equal(serialized.thresholdGate, 'PASSED');
      assert.equal(
        serialized.experimentalGate,
        cohort === 'KNOWN_REGRESSION' ? 'NOT_EVALUATED' : 'PASSED',
      );
      assert.equal(
        serialized.assessment.scope,
        cohort === 'KNOWN_REGRESSION' ? 'COHORT_THRESHOLDS_ONLY' : 'SYNTHETIC_HOLDOUT_ONLY',
      );
      assert.deepEqual(serialized.assessment.requiredCohorts, [
        'KNOWN_REGRESSION',
        'INDEPENDENT_HOLDOUT',
      ]);
      assert.equal(serialized.assessment.iterationAcceptance, 'NOT_GRANTED');
      assert.equal(serialized.deterministicGate, 'NOT_EVALUATED');
      assert.equal(serialized.segments.LLM.bindingThresholds, false);
      assert.equal(serialized.segments.CODE.interpretation, 'DESCRIPTIVE_ONLY');
    }
    const dataset = await holdout();
    assert.throws(
      () => buildReport(dataset, identity, perfectResults(dataset), new Date().toISOString()),
      /Incompatible/,
    );
    assert.notEqual(
      cohortSettings('KNOWN_REGRESSION').reportsDirectory,
      cohortSettings('INDEPENDENT_HOLDOUT').reportsDirectory,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function simulatedAuthorization(cohort: EvaluationCohort): Authorization {
  const selected = cohort === 'KNOWN_REGRESSION' ? identity : holdoutIdentity;
  return {
    schemaVersion: 3,
    cohort,
    protocolId: identity.protocolId,
    experiment: 'I006',
    datasetReview: 'APPROVED_FROZEN',
    datasetHash: selected.datasetHash,
    identityHash: sha256(JSON.stringify(selected)),
    approvalReference: 'SIMULATED',
    initialize: true,
    execute: true,
    maximumInferences: selected.maximumInferences,
  };
}

test('AC-12/26 cross-cohort, wrong-budget and unreviewed-holdout permissions fail before creating controls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'i006-cohort-auth-'));
  try {
    const dataset = await holdout();
    const directory = join(root, 'holdout-controls');
    const authPath = join(root, 'permission.json');
    for (const auth of [
      simulatedAuthorization('KNOWN_REGRESSION'),
      { ...simulatedAuthorization('INDEPENDENT_HOLDOUT'), maximumInferences: 104 },
      {
        ...simulatedAuthorization('INDEPENDENT_HOLDOUT'),
        datasetReview: 'FROZEN_PENDING_HUMAN_REVIEW' as const,
      },
    ]) {
      assert.throws(() => requireAuthorization(auth, holdoutIdentity, 'execute'), /not authorized/);
      await writeFile(authPath, JSON.stringify(auth));
      await assert.rejects(
        withControl(directory, dataset, holdoutIdentity, authPath, true, async () =>
          assert.fail('No operation'),
        ),
      );
      await assert.rejects(readdir(directory), { code: 'ENOENT' });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('AC-12/21/26 independent ledger durably caps holdout at 105 without affecting another cohort', async () => {
  const root = await mkdtemp(join(tmpdir(), 'i006-holdout-ledger-'));
  try {
    const dataset = await holdout();
    const directory = join(root, 'holdout');
    const authPath = join(root, 'permission.json');
    await writeFile(authPath, JSON.stringify(simulatedAuthorization('INDEPENDENT_HOLDOUT')));
    await withControl(directory, dataset, holdoutIdentity, authPath, true, async () =>
      assert.fail('No init inference'),
    );
    const results = perfectResults(dataset);
    await withControl(directory, dataset, holdoutIdentity, authPath, false, async (control) => {
      for (const [index, example] of dataset.examples.entries()) {
        await control.reserve(example);
        for (const phase of plannedPhases(example.description)) {
          await control.attempt(example, phase);
          control.dispatch(example);
        }
        await control.record(results[index]!);
      }
      await assert.rejects(control.reserve(dataset.examples[0]!));
    });
    const ledger = JSON.parse(await readFile(join(directory, 'budget.json'), 'utf8'));
    assert.equal(ledger.observedAttempts, 105);
    assert.equal(ledger.reservedSlots, 105);
    assert.equal(ledger.phase, 'CLOSED');
    await assert.rejects(
      withControl(directory, dataset, holdoutIdentity, authPath, false, async () =>
        assert.fail('No repeat'),
      ),
    );
    await assert.rejects(readdir(join(root, 'known')), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('AC-26 offline identities never consult Ollama; differ by cohort and preserve frozen behavior', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('Ollama access prohibited'));
  const frozen = JSON.parse(await readFile('evals/experiments/i006-r7-system-freeze.json', 'utf8'));
  for (const [path, hash] of Object.entries(frozen.files)) {
    assert.equal(sha256(await readFile(path)), hash);
  }
  const results = [];
  for (const cohort of ['KNOWN_REGRESSION', 'INDEPENDENT_HOLDOUT'] as const) {
    const settings = cohortSettings(cohort);
    const { hash } = await loadDataset(join('evals/datasets', settings.datasetFile));
    const calculated = await effectiveIdentity(
      process.cwd(),
      hash,
      { identity: identity.codeIdentity, verify() {} },
      cohort,
      true,
    );
    assert.equal(calculated.cohort, cohort);
    assert.equal(calculated.maximumInferences, settings.maximumInferences);
    assert.equal(calculated.model, 'qwen3:8b');
    assert.equal(calculated.think, false);
    results.push(sha256(JSON.stringify(calculated)));
    await assert.rejects(main(process.cwd(), ['--initialize', '--cohort', cohort]), /disabled/);
    await assert.rejects(main(process.cwd(), ['--execute', '--cohort', cohort]), /disabled/);
  }
  assert.notEqual(results[0], results[1]);
  for (const args of [
    ['--identity', '--cohort', 'UNKNOWN'],
    ['--execute', '--force'],
    ['--execute', '--cohort', 'INDEPENDENT_HOLDOUT', '--resume'],
  ]) {
    await assert.rejects(main(process.cwd(), args), /explicit/);
  }
});

test('AC-21/26 holdout technical failure persists the prior result and partial report without retry or cross-cohort effects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'i006-holdout-partial-'));
  try {
    const dataset = await holdout();
    const directory = join(root, 'holdout-controls');
    const reports = join(root, 'holdout-reports');
    await mkdir(reports);
    const authPath = join(root, 'permission.json');
    await writeFile(authPath, JSON.stringify(simulatedAuthorization('INDEPENDENT_HOLDOUT')));
    await withControl(directory, dataset, holdoutIdentity, authPath, true, async () =>
      assert.fail('No init inference'),
    );
    let sends = 0;
    const results = await withControl(
      directory,
      dataset,
      holdoutIdentity,
      authPath,
      false,
      (control) =>
        runControlledEvaluation(dataset, control, {
          config: { baseUrl: 'http://simulated.invalid', model: 'simulated' },
          async request() {
            sends++;
            const ledger = JSON.parse(await readFile(join(directory, 'budget.json'), 'utf8'));
            assert.equal(
              ledger.observedAttempts,
              sends,
              'attempt is durable before provider dispatch',
            );
            if (sends === 2) {
              throw new Error('PRIVATE simulated connection detail');
            }
            return Response.json({
              done: true,
              done_reason: 'stop',
              message: { role: 'assistant', content: '{"type":"classification","category":"BUG"}' },
            });
          },
          async verifyCase() {},
          verifyDispatch() {},
          async checkpoint(prefix) {
            await saveReport(
              reports,
              buildReport(dataset, holdoutIdentity, prefix, new Date().toISOString()),
            );
          },
        }),
    );
    assert.equal(sends, 2);
    assert.equal(results?.length, 2);
    assert.equal(results![0]!.outcome, 'COMPLETED');
    assert.equal(results![1]!.outcome, 'TECHNICAL_ERROR');
    const files = (await readdir(reports)).filter((file) => file.endsWith('.json'));
    assert.equal(files.length, 2);
    const partial = JSON.parse(
      await readFile(
        join(
          reports,
          files.find((file) => file.includes('-2-INCOMPLETE'))!,
        ),
        'utf8',
      ),
    );
    assert.equal(partial.dataset.cohort, 'INDEPENDENT_HOLDOUT');
    assert.equal(partial.experimentalGate, 'INCOMPLETE');
    assert.equal(partial.assessment.iterationAcceptance, 'NOT_GRANTED');
    assert.equal(JSON.stringify(partial).includes('PRIVATE'), false);
    const ledger = JSON.parse(await readFile(join(directory, 'budget.json'), 'utf8'));
    assert.equal(ledger.reservedSlots, 2);
    assert.equal(ledger.observedAttempts, 2);
    assert.equal(ledger.phase, 'CLOSED');
    await assert.rejects(
      withControl(directory, dataset, holdoutIdentity, authPath, false, async () =>
        assert.fail('No retry'),
      ),
    );
    await assert.rejects(readdir(join(root, 'known')), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('AC-26 retained metadata and simulated live metadata produce identical identities despite private FROM paths', async (t) => {
  const retained = JSON.parse(
    await readFile('evals/experiments/i006-r7-model-metadata.json', 'utf8'),
  );
  assert.equal(JSON.stringify(retained).includes('/Users/'), false);
  const show = structuredClone(retained.show);
  show.modelfile = show.modelfile.replace(/^FROM\s+.+$/gm, 'FROM /private/PRIVATE_ACCOUNT/blob');
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    switch (new URL(String(input)).pathname) {
      case '/api/tags':
        return Response.json(retained.tags);
      case '/api/version':
        return Response.json(retained.version);
      case '/api/show':
        return Response.json(show);
      default:
        return assert.fail('No inference request');
    }
  });
  const { hash } = await loadDataset(holdoutPath);
  const code = { identity: identity.codeIdentity, verify() {} };
  const offline = await effectiveIdentity(process.cwd(), hash, code, 'INDEPENDENT_HOLDOUT', true);
  const simulatedLive = await effectiveIdentity(
    process.cwd(),
    hash,
    code,
    'INDEPENDENT_HOLDOUT',
    false,
  );
  assert.deepEqual(simulatedLive, offline);
  assert.equal(JSON.stringify(offline).includes('PRIVATE_ACCOUNT'), false);
});
