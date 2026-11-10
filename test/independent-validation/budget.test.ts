import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  initializeLedger,
  readLedger,
  reserve,
  withLedger,
  validateLedger,
} from '../../src/evaluation/independent-validation/budget.js';
import { synchronization } from '../../src/evaluation/durable-files.js';
import { fixture } from './helpers.js';
import { loadOperation } from '../../src/evaluation/independent-validation/protocol.js';

test('I005-AC-05/06 explicit empty initialization, continuation and duplicate initialization', async (t) => {
  const f = await fixture(t, false);
  assert.deepEqual(await initializeLedger(f.directory), { reserved: 0, attempted: 0 });
  const first = await readLedger(f.directory);
  assert.equal(first.ledger.revision, 0);
  await withLedger(f.directory, async (_ledger, save) => save());
  assert.equal((await readLedger(f.directory)).ledger.revision, 1);
  await assert.rejects(initializeLedger(f.directory));
  assert.equal((await readLedger(f.directory)).ledger.instanceId, first.ledger.instanceId);
});

test('I005-AC-06 missing or corrupt controls never recreate budget', async (t) => {
  for (const file of ['budget.json', 'budget-initialization.json']) {
    for (const corrupt of [false, true]) {
      const f = await fixture(t);
      if (corrupt) {
        await writeFile(join(f.directory, file), '{broken');
      } else {
        await unlink(join(f.directory, file));
      }
      const before = await readdir(f.directory);
      await assert.rejects(readLedger(f.directory));
      await assert.rejects(withLedger(f.directory, async () => assert.fail('must not continue')));
      await assert.rejects(initializeLedger(f.directory));
      assert.deepEqual(await readdir(f.directory), before);
      assert.equal((await f.run('llama3.1:8b')).exitCode, 1);
      assert.equal(f.calls.length, 0);
    }
  }
});

test('I005-AC-06 orphan evidence blocks even after simultaneous control deletion', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.directory, 'original-result.json'), '{}');
  await unlink(join(f.directory, 'budget.json'));
  await unlink(join(f.directory, 'budget-initialization.json'));
  await assert.rejects(initializeLedger(f.directory));
  await assert.rejects(readLedger(f.directory));
  assert.equal((await f.run('llama3.1:8b')).exitCode, 1);
  assert.equal(f.calls.length, 0);
});

test('I005-AC-06 pending reservation or persisted unanswered attempt stays consumed and blocked', async (t) => {
  for (const attempted of [0, 1]) {
    const f = await fixture(t);
    const source = await loadOperation(f.root);
    const snapshot = { sha256: source.sha256, bytes: source.bytes.length };
    await withLedger(f.directory, async (ledger, save) => {
      await writeFile(join(f.directory, source.sha256 + '.operation.json'), source.bytes);
      const a = reserve(ledger, 'llama3.1:8b', source.protocolSha256, snapshot);
      await save();
      if (attempted) {
        a.attempted++;
        await save();
      }
    });
    const state = await readLedger(f.directory);
    assert.equal(state.ledger.attempts[0]!.reserved, 90);
    assert.equal(state.ledger.attempts[0]!.attempted, attempted);
    assert.equal(state.ledger.attempts[0]!.results.length, 0);
    await assert.rejects(withLedger(f.directory, async () => assert.fail('pending reservation')));
    assert.equal((await f.run('llama3.1:8b')).exitCode, 1);
    assert.equal(f.calls.length, 0);
  }
});

test('I005-AC-06 rollback, unknown evidence and active locks fail closed without repairs', async (t) => {
  for (const alteration of ['rollback', 'orphan', 'lock']) {
    const f = await fixture(t);
    const oldBudget = await readFile(join(f.directory, 'budget.json'));
    await withLedger(f.directory, async (_ledger, save) => save());
    if (alteration === 'rollback') {
      await writeFile(join(f.directory, 'budget.json'), oldBudget);
    } else {
      await writeFile(
        join(f.directory, alteration === 'lock' ? 'budget.lock' : 'unexplained.tmp'),
        'uncertain',
      );
    }
    const before = await readdir(f.directory);
    await assert.rejects(readLedger(f.directory));
    await assert.rejects(withLedger(f.directory, async () => assert.fail('uncertain evidence')));
    assert.deepEqual(await readdir(f.directory), before);
  }
});

test('I005-AC-06 initialization persistence failures retain evidence and prohibit recovery', async (t) => {
  for (const failFile of [true, false]) {
    const f = await fixture(t, false);
    let directories = 0;
    const disk = {
      async file(handle: Parameters<typeof synchronization.file>[0]) {
        await handle.sync();
        if (failFile) {
          throw new Error('simulated file fsync failure');
        }
      },
      async directory(path: string) {
        directories++;
        if (!failFile && directories === 3) {
          throw new Error('simulated directory fsync failure');
        }
        await synchronization.directory(path);
      },
    };
    await assert.rejects(initializeLedger(f.directory, disk));
    assert.ok((await readdir(f.directory)).length > 0);
    await assert.rejects(initializeLedger(f.directory));
    await assert.rejects(withLedger(f.directory, async () => assert.fail('fsync uncertain')));
  }
});

test('I005-AC-06 two processes cannot acquire the experiment lock simultaneously', async (t) => {
  const f = await fixture(t);
  const moduleUrl = new URL(
    '../../src/evaluation/independent-validation/budget.js',
    import.meta.url,
  ).href;
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { withLedger } from ${JSON.stringify(moduleUrl)};
    await withLedger(${JSON.stringify(f.directory)}, async () => {
      process.send('locked');
      await new Promise(resolve => process.once('message', resolve));
    });
  `,
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  t.after(() => {
    child.kill();
  });
  const [message] = await once(child, 'message');
  assert.equal(message, 'locked');
  await assert.rejects(withLedger(f.directory, async () => assert.fail('concurrent entry')));
  await assert.rejects(readLedger(f.directory));
  assert.equal((await f.run('llama3.1:8b')).exitCode, 1);
  assert.equal(f.calls.length, 0);
  child.send('release');
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
  assert.equal((await readLedger(f.directory)).ledger.attempts.length, 0);
});

test('I005-AC-06 schema and monotonic updates forbid budget inflation, duplicates and result removal', async (t) => {
  const f = await fixture(t);
  const state = (await readLedger(f.directory)).ledger;
  const source = await loadOperation(f.root);
  const snapshot = { sha256: source.sha256, bytes: source.bytes.length };
  reserve(state, 'llama3.1:8b', source.protocolSha256, snapshot);
  const tooMany = structuredClone(state);
  tooMany.attempts.push(...structuredClone(state.attempts), ...structuredClone(state.attempts));
  assert.throws(() => validateLedger(tooMany));
  const tooLarge = structuredClone(state);
  tooLarge.attempts[0]!.attempted = 91;
  assert.throws(() => validateLedger(tooLarge));
  assert.throws(() => reserve(state, 'llama3.1:8b', source.protocolSha256, snapshot));
  assert.throws(() => reserve(state, 'gemma3:12b', source.protocolSha256, snapshot));
  await assert.rejects(
    withLedger(f.directory, async (ledger, save) => {
      await writeFile(join(f.directory, source.sha256 + '.operation.json'), source.bytes);
      const a = reserve(ledger, 'llama3.1:8b', source.protocolSha256, snapshot);
      await save();
      a.attempted = 1;
      await save();
      a.attempted = 0;
      await save();
    }),
  );
  assert.equal((await readLedger(f.directory)).ledger.attempts[0]!.attempted, 1);
});
