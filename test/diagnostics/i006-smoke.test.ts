import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  runSmoke,
  createGuardedTransport,
  SmokeOperationalError,
} from '../../src/diagnostics/i006-smoke.js';
import { checkSmoke, executeSmoke, main } from '../../src/diagnostics/i006-smoke-main.js';
import { RetiredI006DiagnosticError } from '../../src/diagnostics/retired-i006.js';

test('I006-AC-12/18 retired smoke blocks all entrypoints before reading dependencies or controls', async () => {
  const poisoned = new Proxy(
    {},
    {
      get() {
        assert.fail('Retired diagnostic touched a dependency');
      },
    },
  );
  for (const invoke of [
    () => runSmoke(poisoned),
    () => checkSmoke(poisoned),
    () => executeSmoke(poisoned),
    () => main(['--run'], poisoned),
    () => main(['--check'], poisoned),
  ]) {
    await assert.rejects(invoke(), RetiredI006DiagnosticError);
  }
  const process = spawnSync('node', ['dist/src/diagnostics/i006-smoke-main.js', '--run'], {
    encoding: 'utf8',
  });
  assert.equal(process.status, 1);
  assert.equal(process.stderr.trim(), 'I006_DIAGNOSTIC_RETIRED');
});

test('I006 reusable protected transport retains durable ordering, two-send cap, endpoint and concurrent-entry barriers', async () => {
  let reservations = 0;
  let sent = 0;
  const guard = createGuardedTransport({
    baseUrl: 'http://invalid.test',
    async reserve() {
      reservations++;
    },
    beforeDispatch() {
      assert.ok(reservations > sent);
    },
    async request() {
      sent++;
      return new Response('simulated');
    },
  });
  for (let i = 0; i < 2; i++) {
    await guard.request('http://invalid.test/api/chat', { method: 'POST' });
  }
  await assert.rejects(
    guard.request('http://invalid.test/api/chat', { method: 'POST' }),
    SmokeOperationalError,
  );
  assert.equal(sent, 2);
  guard.close();
  await guard.settle();
  const invalid = createGuardedTransport({
    baseUrl: 'http://invalid.test',
    async reserve() {
      assert.fail('Invalid endpoint reserved');
    },
    beforeDispatch() {},
    async request() {
      assert.fail('Invalid endpoint dispatched');
    },
  });
  await assert.rejects(
    invalid.request('http://invalid.test/api/generate', { method: 'POST' }),
    SmokeOperationalError,
  );
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const concurrent = createGuardedTransport({
    baseUrl: 'http://invalid.test',
    async reserve() {
      entered();
      await held;
    },
    beforeDispatch() {},
    async request() {
      assert.fail('Concurrent violation must prevent dispatch');
    },
  });
  const first = assert.rejects(
    concurrent.request('http://invalid.test/api/chat', { method: 'POST' }),
    SmokeOperationalError,
  );
  await ready;
  await assert.rejects(
    concurrent.request('http://invalid.test/api/chat', { method: 'POST' }),
    SmokeOperationalError,
  );
  release();
  await first;
  await concurrent.settle();
});

test('I006 protected transport never sends after failed persistence, revocation, cancellation or closure during reservation', async () => {
  for (const scenario of ['persistence', 'revocation', 'cancelled', 'closed']) {
    let sends = 0;
    let reservations = 0;
    const abort = new AbortController();
    const guard = createGuardedTransport({
      baseUrl: 'http://invalid.test',
      async reserve() {
        reservations++;
        if (scenario === 'persistence') {
          throw new Error('simulated persistence failure');
        }
        if (scenario === 'cancelled') {
          abort.abort();
        }
        if (scenario === 'closed') {
          guard.close();
        }
      },
      beforeDispatch() {
        if (scenario === 'revocation') {
          throw new Error('authorization revoked');
        }
      },
      async request() {
        sends++;
        return new Response();
      },
    });
    await assert.rejects(
      guard.request('http://invalid.test/api/chat', { method: 'POST', signal: abort.signal }),
    );
    await assert.rejects(
      guard.request('http://invalid.test/api/chat', { method: 'POST' }),
      SmokeOperationalError,
    );
    await guard.settle();
    assert.equal(sends, 0);
    assert.equal(reservations, 1);
  }
});
