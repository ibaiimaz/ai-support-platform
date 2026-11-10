import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import ts from 'typescript';
import { fixture, fixtureCodeIdentity } from './helpers.js';
import { ClassificationError } from '../../src/application/classification-errors.js';
import {
  readLedger,
  effectiveAuthorization,
} from '../../src/evaluation/independent-validation/budget.js';
import { validateIndependentReport } from '../../src/evaluation/independent-validation/report.js';
import {
  snapshotBuild,
  captureCodeIdentity,
} from '../../src/evaluation/independent-validation/code-state.js';
import { synchronization } from '../../src/evaluation/durable-files.js';
import { sha256 } from '../../src/evaluation/dataset.js';
import { executeCli } from '../../src/evaluation/independent-validation/main.js';

test('I005 B1 AC-08 delivered request with interrupted connection stops without second call or Gemma', async (t) => {
  const f = await fixture(t);
  let providerMayBeActive = false;
  f.setClassifier(async () => {
    providerMayBeActive = true;
    throw new ClassificationError('connection_error');
  });
  const result = await f.run('llama3.1:8b');
  const report = await f.report(result.output);
  assert.equal(providerMayBeActive, true);
  assert.equal(result.exitCode, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(report.termination, 'transport_not_quiescent');
  assert.equal(report.results[0]!.status, 'error');
  assert.equal(report.execution.attemptedCount, 1);
  assert.equal(report.execution.unattemptedCount, 89);
  const ledger = (await readLedger(f.directory)).ledger;
  assert.equal(ledger.attempts[0]!.reserved, 90);
  assert.equal(ledger.attempts[0]!.permissionClosed, true);
  await f.approveGemma(ledger.attempts[0]!.reportSha256!);
  assert.equal((await f.run('gemma3:12b')).exitCode, 1);
  assert.equal((await f.run('llama3.1:8b')).exitCode, 1);
  assert.equal(f.calls.length, 1);
});

test('I005 I1 AC-06/13 missing, corrupt, substituted and unlinked snapshots block Gemma before effects', async (t) => {
  const f = await fixture(t);
  const first = await f.run('llama3.1:8b');
  assert.equal(first.exitCode, 0, first.output);
  const a = (await readLedger(f.directory)).ledger.attempts[0]!;
  await f.approveGemma(a.reportSha256!);
  const path = join(f.directory, a.operationSha256 + '.operation.json');
  const bytes = await readFile(path);
  const extraBytes = JSON.stringify(f.op) + '\n';
  const extraPath = join(f.directory, sha256(extraBytes) + '.operation.json');
  for (const damage of ['missing', 'corrupt', 'substitute', 'unlinked']) {
    if (damage === 'missing') {
      await unlink(path);
    } else if (damage === 'corrupt') {
      await writeFile(path, '{');
    } else if (damage === 'substitute') {
      await writeFile(path, extraBytes);
    } else {
      await writeFile(extraPath, extraBytes);
    }
    const observers = f.counters().observerCreations;
    assert.equal((await f.run('gemma3:12b')).exitCode, 1, damage);
    assert.equal(f.counters().observerCreations, observers);
    assert.equal(f.calls.length, 90);
    await assert.rejects(readLedger(f.directory));
    if (damage === 'unlinked') {
      await unlink(extraPath);
    } else {
      await writeFile(path, bytes);
    }
  }
  await readLedger(f.directory);
});

test('I005 I2 AC-06/15 closure rejects a second process specifically at the lock until final persistence', async (t) => {
  const f = await fixture(t);
  const checkpoints = new Set<string>();
  const probeLock = async (checkpoint: string) => {
    const moduleUrl = new URL('../../src/evaluation/durable-files.js', import.meta.url).href;
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { access, stat } from 'node:fs/promises';
      import { constants } from 'node:fs';
      import { locked } from ${JSON.stringify(moduleUrl)};
      const directory = ${JSON.stringify(f.directory)};
      await new Promise(resolve => process.once('message', resolve));
      if (!(await stat(directory)).isDirectory()) { throw new Error('Invalid test directory'); }
      await access(directory, constants.R_OK | constants.W_OK);
      process.send({ stage: 'attempting_lock', directory });
      let callbackEntered = false;
      try {
        await locked(directory, async () => { callbackEntered = true; });
        process.send({ stage: 'lock_result', outcome: 'acquired', callbackEntered });
      } catch (error) {
        process.send({ stage: 'lock_result', outcome: 'rejected', code: error.code,
          syscall: error.syscall, path: error.path, callbackEntered });
      }
      process.disconnect();
    `,
      ],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    );
    t.after(() => {
      child.kill();
    });
    const messages: unknown[] = [];
    child.on('message', (message) => {
      messages.push(message);
    });
    const finished = once(child, 'exit');
    child.send('probe');
    const [code] = await finished;
    assert.equal(code, 0, checkpoint);
    assert.deepEqual(
      messages,
      [
        { stage: 'attempting_lock', directory: f.directory },
        {
          stage: 'lock_result',
          outcome: 'rejected',
          code: 'EEXIST',
          syscall: 'open',
          path: join(f.directory, 'budget.lock'),
          callbackEntered: false,
        },
      ],
      checkpoint,
    );
  };
  f.dependencies.synchronization = {
    file: synchronization.file,
    async directory(path) {
      await synchronization.directory(path);
      if (path !== f.directory || f.calls.length !== 90) {
        return;
      }
      const entries = await readdir(path);
      if (!entries.some((name) => /^[a-f0-9-]{36}\.json$/.test(name))) {
        return;
      }
      const budgetBytes = await readFile(join(path, 'budget.json'));
      const ledger = JSON.parse(budgetBytes.toString('utf8'));
      const attempt = ledger.attempts[0];
      const marker = JSON.parse(await readFile(join(path, 'budget-initialization.json'), 'utf8'));
      const checkpoint = !attempt.permissionClosed
        ? 'report_persisted'
        : marker.revision === ledger.revision && marker.ledgerSha256 === sha256(budgetBytes)
          ? 'closure_durable'
          : null;
      if (checkpoint === null || checkpoints.has(checkpoint)) {
        return;
      }
      checkpoints.add(checkpoint);
      if (checkpoint === 'closure_durable') {
        assert.equal(attempt.status, 'completed');
        assert.equal(attempt.permissionClosed, true);
        assert.ok(entries.includes('budget-persistence.pending'));
      }
      await probeLock(checkpoint);
      if (checkpoint === 'report_persisted') {
        f.op.authorization['gemma3:12b'].approvedBy = 'Concurrent reviewer';
        await f.saveOperation();
      }
    },
  };
  const result = await f.run('llama3.1:8b');
  assert.equal(result.exitCode, 0, result.output);
  assert.deepEqual([...checkpoints], ['report_persisted', 'closure_durable']);
  const declarations = JSON.parse(
    await readFile(join(f.root, 'evals/experiments/i005-operation.json'), 'utf8'),
  );
  assert.equal(declarations.authorization['gemma3:12b'].approvedBy, 'Concurrent reviewer');
  const state = (await readLedger(f.directory)).ledger;
  assert.equal(state.attempts[0]!.permissionClosed, true);
  assert.equal(effectiveAuthorization(declarations, state)['llama3.1:8b']!.approved, false);
  assert.equal(f.calls.length, 90);
  assert.ok(!(await readdir(f.directory)).includes('budget.lock'));
});

test('I005 I2 AC-06 failures at report, closure sentinel, ledger, marker and unlink retain durable blocking', async (t) => {
  for (const stage of [
    'report-file',
    'report-directory',
    'sentinel',
    'ledger',
    'marker',
    'unlink',
  ]) {
    const f = await fixture(t);
    let closing = false;
    let writes = 0;
    let failed = false;
    f.dependencies.synchronization = {
      async file(handle) {
        await handle.sync();
        const reportExists = (await readdir(f.directory)).some((n) =>
          /^[a-f0-9-]{36}\.json$/.test(n),
        );
        if (f.calls.length === 90 && reportExists) {
          closing = true;
        }
        if (!closing) {
          return;
        }
        writes++;
        const at = { 'report-file': 1, sentinel: 2, ledger: 3, marker: 4 }[stage];
        if (at === writes) {
          failed = true;
          throw new Error('Simulated closure durability failure');
        }
      },
      async directory(path) {
        await synchronization.directory(path);
        if (!closing || path !== f.directory) {
          return;
        }
        if (stage === 'report-directory' && writes === 1) {
          failed = true;
          throw new Error('Simulated report directory failure');
        }
        if (stage === 'unlink' && writes === 4) {
          // Make unlink fail after both controls are durable; keep a blocking sentinel directory.
          const sentinel = join(f.directory, 'budget-persistence.pending');
          await unlink(sentinel);
          await mkdir(sentinel);
          failed = true;
        }
      },
    };
    const result = await f.run('llama3.1:8b');
    assert.equal(failed, true, stage);
    assert.equal(result.exitCode, 1, stage);
    assert.equal(f.calls.length, 90);
    assert.equal((await f.run('llama3.1:8b')).exitCode, 1);
    assert.equal((await f.run('gemma3:12b')).exitCode, 1);
    assert.equal(f.calls.length, 90);
    const ledger = JSON.parse(await readFile(join(f.directory, 'budget.json'), 'utf8'));
    assert.equal(ledger.attempts[0].attempted, 90);
    assert.equal(ledger.attempts[0].reserved, 90);
    await assert.rejects(readLedger(f.directory));
  }
});

test('I005 I3 AC-08/13 runtime residency anomalies and observation failures persist partial evidence', async (t) => {
  for (const kind of ['multiple', 'digest', 'observation']) {
    const f = await fixture(t);
    f.observer.residency = async () => {
      if (kind === 'observation') {
        throw new Error('Private transport details must not leak');
      }
      const model = 'llama3.1:8b';
      const resident = {
        model,
        digest: kind === 'digest' ? 'f'.repeat(64) : f.op.models[model].digest!,
        size: 1,
        sizeVram: 1,
        contextLength: null,
      };
      return {
        recordedAt: new Date().toISOString(),
        models:
          kind === 'multiple'
            ? [
                resident,
                {
                  ...resident,
                  model: 'foreign-model:tag',
                  digest: 'e'.repeat(64),
                },
              ]
            : [resident],
      };
    };
    const result = await f.run('llama3.1:8b');
    assert.equal(result.exitCode, 1);
    const report = await f.report(result.output);
    assert.equal(report.complete, false);
    assert.equal(
      report.termination,
      kind === 'observation' ? 'observation_error' : 'residency_anomaly',
    );
    assert.equal(report.execution.attemptedCount, 1);
    assert.equal(f.calls.length, 1);
    assert.equal(report.metrics, null);
    validateIndependentReport(report, f.inputs);
    assert.ok(!JSON.stringify(report).includes('Private transport details'));
    assert.throws(() =>
      validateIndependentReport({ ...report, complete: true, termination: null }, f.inputs),
    );
    if (kind !== 'observation') {
      validateIndependentReport({ ...report, termination: 'observation_error' }, f.inputs);
      assert.equal(report.anomalies.residency[0]!.observationIndex, 1);
      assert.equal(report.residency.length, 2);
    }
    assert.equal((await readLedger(f.directory)).ledger.attempts[0]!.permissionClosed, true);
    assert.equal((await f.run('gemma3:12b')).exitCode, 1);
  }
});

async function sourceFixture(root: string) {
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'dist/src'), { recursive: true });
  const source = 'export const value = 1;\n';
  await writeFile(join(root, 'src/entry.ts'), source);
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await writeFile(join(root, 'package-lock.json'), '{}');
  await writeFile(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        target: 'ES2022',
        strict: true,
        rootDir: '.',
        outDir: 'dist',
        skipLibCheck: true,
      },
      include: ['src/**/*.ts'],
    }),
  );
  await writeFile(
    join(root, 'dist/src/entry.js'),
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  );
  return snapshotBuild(join(root, 'dist'));
}

test('I005 I4 AC-13 source/build correspondence rejects stale or replaced build before inference', async (t) => {
  for (const change of ['source', 'build']) {
    const f = await fixture(t);
    const startup = await sourceFixture(f.root);
    const verified = captureCodeIdentity(f.root, startup);
    verified.verify();
    if (change === 'source') {
      await writeFile(join(f.root, 'src/entry.ts'), 'export const value = 2;\n');
    } else {
      await writeFile(join(f.root, 'dist/src/entry.js'), 'export const value = 2;\n');
    }
    f.dependencies.code = (root) => captureCodeIdentity(root, startup);
    assert.equal((await f.run('llama3.1:8b')).exitCode, 1);
    assert.equal(f.calls.length, 0);
    assert.equal((await readLedger(f.directory)).ledger.attempts.length, 0);
  }
});

test('I005 I4 AC-08/13 source or executable changes during an arm preserve startup identity and stop', async (t) => {
  for (const change of ['source', 'build', 'configuration']) {
    const f = await fixture(t);
    const startup = await sourceFixture(f.root);
    let original: ReturnType<typeof captureCodeIdentity>['identity'] | undefined;
    f.dependencies.code = (root) => {
      const verified = captureCodeIdentity(root, startup);
      original = structuredClone(verified.identity);
      return verified;
    };
    f.setClassifier(async () => {
      const path =
        change === 'source'
          ? 'src/entry.ts'
          : change === 'build'
            ? 'dist/src/entry.js'
            : 'package-lock.json';
      await writeFile(join(f.root, path), 'changed during inference');
      return { category: 'BUG' };
    });
    const result = await f.run('llama3.1:8b');
    const report = await f.report(result.output);
    assert.equal(report.termination, 'code_changed');
    assert.equal(report.complete, false);
    assert.deepEqual(report.codeReference, original);
    assert.equal(f.calls.length, 1);
    assert.equal((await f.run('llama3.1:8b')).exitCode, 1);
    assert.equal((await f.run('gemma3:12b')).exitCode, 1);
  }
});

test('I005 I2 AC-05/13 effective permission validation is read only after consumption', async (t) => {
  const f = await fixture(t);
  f.setClassifier(async () => {
    throw new ClassificationError('timeout');
  });
  await f.run('llama3.1:8b');
  const paths = await readdir(f.directory);
  const before = await Promise.all(
    paths.map(async (name) => [name, sha256(await readFile(join(f.directory, name)))]),
  );
  const config = await readFile(join(f.root, 'evals/experiments/i005-operation.json'));
  const result = await executeCli(f.root, ['--validate'], f.dependencies);
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.output).executionAuthorized[0].approved, false);
  assert.equal(f.op.authorization['llama3.1:8b'].approved, true);
  assert.deepEqual(
    await Promise.all(
      paths.map(async (name) => [name, sha256(await readFile(join(f.directory, name)))]),
    ),
    before,
  );
  assert.deepEqual(await readFile(join(f.root, 'evals/experiments/i005-operation.json')), config);
});

test('I005 I4 AC-04/13 changed executable between arms blocks Gemma before provider or observer', async (t) => {
  const f = await fixture(t);
  const first = await f.run('llama3.1:8b');
  assert.equal(first.exitCode, 0, first.output);
  const a = (await readLedger(f.directory)).ledger.attempts[0]!;
  await f.approveGemma(a.reportSha256!);
  const observers = f.counters().observerCreations;
  f.dependencies.code = () => ({
    identity: { ...fixtureCodeIdentity, buildSha256: 'c'.repeat(64) },
    verify() {},
  });
  assert.equal((await f.run('gemma3:12b')).exitCode, 1);
  assert.equal(f.calls.length, 90);
  assert.equal(f.counters().observerCreations, observers);
  assert.equal((await readLedger(f.directory)).ledger.attempts.length, 1);
});

for (const cause of [
  'residency_anomaly',
  'transport_not_quiescent',
  'timeout_not_quiescent',
  'unexpected_error',
] as const) {
  test(`I005 I3 AC-08/13 partial persists residency anomaly independently of ${cause}`, async (t) => {
    for (const kind of ['multiple', 'digest']) {
      const f = await fixture(t);
      f.setClassifier(async () => {
        if (cause === 'transport_not_quiescent') {
          throw new ClassificationError('connection_error');
        }
        if (cause === 'timeout_not_quiescent') {
          throw new ClassificationError('timeout');
        }
        if (cause === 'unexpected_error') {
          throw new Error('Private exception content');
        }
        return { category: 'BUG' };
      });
      f.observer.residency = async () => {
        const resident = {
          model: 'llama3.1:8b',
          digest: kind === 'digest' ? 'f'.repeat(64) : f.op.models['llama3.1:8b'].digest!,
          size: 1,
          sizeVram: 1,
          contextLength: null,
        };
        return {
          recordedAt: new Date().toISOString(),
          models:
            kind === 'multiple'
              ? [
                  resident,
                  { ...resident, model: 'gemma3:12b', digest: f.op.models['gemma3:12b'].digest! },
                ]
              : [resident],
        };
      };
      const result = await f.run('llama3.1:8b');
      assert.equal(result.exitCode, 1, result.output);
      const report = await f.report(result.output);
      assert.equal(report.complete, false);
      assert.equal(report.termination, cause);
      assert.equal(report.metrics, null);
      assert.deepEqual(report.anomalies.residency, [
        {
          observationIndex: 1,
          reasons:
            kind === 'multiple'
              ? ['multiple_models', 'unexpected_identity']
              : ['unexpected_identity'],
        },
      ]);
      validateIndependentReport(report, f.inputs);
      assert.throws(() =>
        validateIndependentReport({ ...report, anomalies: { residency: [] } }, f.inputs),
      );
      const malformed = structuredClone(report);
      Object.assign(malformed.residency[1]!.models[0]!, { rawResponse: 'not allowed' });
      assert.throws(() => validateIndependentReport(malformed, f.inputs));
      assert.equal(report.execution.attemptedCount, 1);
      assert.equal(report.execution.persistedCount, 1);
      assert.equal(report.execution.unattemptedCount, 89);
      assert.equal(report.execution.reservedCount, 90);
      assert.equal(f.calls.length, 1);
      const ledger = (await readLedger(f.directory)).ledger;
      const attempt = ledger.attempts[0]!;
      assert.equal(attempt.reserved, 90);
      assert.equal(attempt.attempted, 1);
      assert.equal(attempt.status, 'incomplete');
      assert.equal(attempt.permissionClosed, true);
      assert.deepEqual(attempt.results, report.results);
      const bytes = await readFile(join(f.directory, attempt.reportId + '.json'));
      assert.equal(sha256(bytes), attempt.reportSha256);
      assert.ok(!bytes.toString('utf8').includes('Private exception content'));
      assert.ok(
        Object.values(effectiveAuthorization(f.op, ledger)).every(
          (permission) => !permission.approved,
        ),
      );
      assert.equal((await f.run('gemma3:12b')).exitCode, 1);
      await f.approveGemma(attempt.reportSha256!);
      assert.equal((await f.run('gemma3:12b')).exitCode, 1);
      assert.equal((await f.run('llama3.1:8b')).exitCode, 1);
      assert.equal(f.calls.length, 1);
    }
  });
}
