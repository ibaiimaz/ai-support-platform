import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  runFirstInference,
  createSingleSendTransport,
  DiagnosticSendLimitError,
} from '../../src/diagnostics/i006-first-inference.js';
import {
  checkFirstInference,
  executeFirstInference,
  main,
} from '../../src/diagnostics/i006-first-inference-main.js';
import { RetiredI006DiagnosticError } from '../../src/diagnostics/retired-i006.js';

test('I006-AC-12/18 retired first-inference diagnostic blocks before reservation, provider or filesystem', async () => {
  const poison = new Proxy(
    {},
    {
      get() {
        assert.fail('Unexpected dependency access');
      },
    },
  );
  for (const invoke of [
    () => runFirstInference(poison),
    () => checkFirstInference(poison),
    () => executeFirstInference(poison),
    () => main(['--run'], poison),
    () => main(['--check'], poison),
  ]) {
    await assert.rejects(invoke(), RetiredI006DiagnosticError);
  }
});

test('I006 single-send helper remains independent and never dispatches twice, even after reservation failure', async () => {
  for (const fail of [false, true]) {
    let calls = 0;
    const guard = createSingleSendTransport({
      baseUrl: 'http://invalid.test',
      async reserve() {
        if (fail) {
          throw new Error('disk');
        }
      },
      beforeDispatch() {},
      async request() {
        calls++;
        return new Response('simulated');
      },
    });
    const first = guard.request('http://invalid.test/api/chat', { method: 'POST' });
    if (fail) {
      await assert.rejects(first);
    } else {
      await first;
    }
    await assert.rejects(
      guard.request('http://invalid.test/api/chat', { method: 'POST' }),
      DiagnosticSendLimitError,
    );
    assert.equal(calls, fail ? 0 : 1);
    guard.close();
    await guard.settle();
  }
});
