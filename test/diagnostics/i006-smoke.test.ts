import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runSmoke,
  createGuardedTransport,
  smokeCase,
  SmokeOperationalError,
} from '../../src/diagnostics/i006-smoke.js';
import {
  checkSmoke,
  executeSmoke,
  main,
  type SmokeAuthorization,
  type SmokeIO,
} from '../../src/diagnostics/i006-smoke-main.js';
import { synchronization } from '../../src/evaluation/durable-files.js';
import { sha256 } from '../../src/evaluation/dataset.js';
import { ClassificationError } from '../../src/application/classification-errors.js';
import { GlobalDeadlineExceededError } from '../../src/application/tool-calling-errors.js';

const config = { baseUrl: 'http://localhost:11434', model: 'llama3.1:8b' };
const details = { capabilities: ['completion', 'tools'], parameters: 'SIMULATED_METADATA' };

function final(category = 'BUG') {
  return Response.json({
    done: true,
    done_reason: 'stop',
    message: { role: 'assistant', content: JSON.stringify({ type: 'classification', category }) },
  });
}

function abstention() {
  return Response.json({
    done: true,
    done_reason: 'stop',
    message: { role: 'assistant', content: '{"type":"abstention"}' },
  });
}

function tool(id = 'INC-142') {
  return Response.json({
    done: true,
    done_reason: 'stop',
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'CORRELATION', function: { name: 'getIncidentById', arguments: { incidentId: id } } },
      ],
    },
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'i006-smoke-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'evals/reports/i006-smoke');
  const authorizationPath = join(root, 'evals/experiments/i006-smoke-authorization.json');
  await mkdir(join(root, 'evals/experiments'), { recursive: true });
  const authorization: SmokeAuthorization = JSON.parse(
    await readFile('evals/experiments/i006-smoke-authorization.json', 'utf8'),
  );
  authorization.modelMetadataHash = sha256(JSON.stringify(details));
  await writeFile(authorizationPath, JSON.stringify(authorization));
  const requests: { path: string; body: unknown }[] = [];
  let chatCalls = 0;
  let codeChanged = false;
  let handler: (body: any, call: number, init?: RequestInit) => Promise<Response> = async (
    _body,
    call,
  ) => (call === 1 ? tool() : final());
  const io: SmokeIO = {
    env: {},
    code: () => ({
      identity: {
        commit: null,
        method: 'typescript_emit_exact',
        compilerVersion: 'simulated',
        sourceSha256: 'a'.repeat(64),
        buildSha256: 'b'.repeat(64),
      },
      verify() {
        if (codeChanged) {
          throw new Error('PRIVATE_CODE_ERROR');
        }
      },
    }),
    request: async (input, init) => {
      const path = new URL(String(input)).pathname;
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ path, body });
      if (path === '/api/version') {
        return Response.json({ version: '0.40.14' });
      }
      if (path === '/api/tags') {
        return Response.json({
          models: [{ name: config.model, digest: authorization.modelDigest }],
        });
      }
      if (path === '/api/show') {
        return Response.json(details);
      }
      assert.equal(path, '/api/chat');
      chatCalls++;
      return handler(body, chatCalls, init);
    },
  };
  const enable = async () => {
    const checked = await checkSmoke(root, io);
    authorization.identityHash = checked.identityHash;
    authorization.execute = true;
    authorization.approvalReference = 'I006-SMOKE-SIMULATED-AUTHORIZATION';
    await writeFile(authorizationPath, JSON.stringify(authorization));
  };
  return {
    root,
    directory,
    authorizationPath,
    authorization,
    requests,
    io,
    enable,
    calls: () => chatCalls,
    changeCode() {
      codeChanged = true;
    },
    handle(value: typeof handler) {
      handler = value;
    },
  };
}

test('smoke: complete native path uses production composition and durable attempts before either dispatch', async (t) => {
  const f = await fixture(t);
  await f.enable();
  f.handle(async (body, call) => {
    const attempt = JSON.parse(await readFile(join(f.directory, `attempt-${call}.json`), 'utf8'));
    assert.equal(attempt.attempt, call);
    assert.equal(attempt.state, 'RESERVED_POSSIBLE_DISPATCH');
    assert.equal(body.model, config.model);
    assert.deepEqual(body.options, { temperature: 0 });
    assert.equal(body.stream, false);
    if (call === 1) {
      assert.equal(body.messages[1].content, smokeCase.description);
      assert.equal(body.tools[0].function.name, 'getIncidentById');
      assert.equal('format' in body, false);
      return tool();
    }
    assert.equal('tools' in body, false);
    assert.equal(body.format.oneOf.length, 2);
    assert.equal(body.messages[2].tool_calls[0].id, 'CORRELATION');
    assert.equal(body.messages[3].role, 'tool');
    assert.equal(body.messages[3].tool_call_id, 'CORRELATION');
    const found = JSON.parse(body.messages[3].content);
    assert.equal(found.status, 'FOUND');
    assert.equal(found.incident.id, 'INC-142');
    assert.equal(found.incident.category, 'BUG');
    assert.equal(found.incident.title, 'Error al guardar un informe');
    return final();
  });
  const report = await executeSmoke(f.root, f.io);
  assert.equal(report.scenarioStatus, 'PASSED');
  assert.equal(report.technicalStatus, 'VALID_OBSERVED');
  assert.equal(report.operationalStatus, 'OK');
  assert.equal(report.toolExecutions, 1);
  assert.deepEqual(report.accounting, {
    scope: 'I006_SMOKE_COMPATIBILITY',
    maximumAttempts: 2,
    reservedAttempts: 2,
    dispatchesObserved: 2,
    validatedResponses: 2,
    notDispatched: 0,
    uncertainDispatches: 0,
    experimentalBudgetTouched: false,
    maximumExperimentalAttempts: 120,
    maximumCombinedAttempts: 122,
  });
  const bytes = await readFile(join(f.directory, 'report.json'));
  assert.equal(
    (await readFile(join(f.directory, 'report.json.sha256'), 'utf8')).trim(),
    sha256(bytes),
  );
  assert.equal(
    JSON.parse(await readFile(join(f.directory, 'closed.json'), 'utf8')).reportHash,
    sha256(bytes),
  );
});

test('smoke: a direct classification or abstention uses one call and never forces a tool', async (t) => {
  for (const response of [final, abstention]) {
    const f = await fixture(t);
    await f.enable();
    f.handle(async () => response());
    const report = await executeSmoke(f.root, f.io);
    assert.equal(f.calls(), 1);
    assert.equal(report.scenarioStatus, 'NOT_EXERCISED');
    assert.equal(report.technicalStatus, 'VALID_OBSERVED');
    assert.equal(report.reason, 'TOOL_NOT_REQUESTED');
    assert.equal(report.toolExecutions, 0);
  }
});

test('smoke: valid wrong category or wrong ID remains a semantic failure, without repair', async (t) => {
  for (const wrongId of [false, true]) {
    const f = await fixture(t);
    await f.enable();
    f.handle(async (body, call) => {
      if (call === 1) {
        return tool(wrongId ? 'INC-201' : 'INC-142');
      }
      if (wrongId) {
        assert.equal(JSON.parse(body.messages[3].content).incident.id, 'INC-201');
      }
      return final('FEATURE');
    });
    const report = await executeSmoke(f.root, f.io);
    assert.equal(report.technicalStatus, 'VALID_OBSERVED');
    assert.equal(report.scenarioStatus, 'FAILED');
    assert.equal(report.reason, wrongId ? 'WRONG_TOOL_DECISION' : 'WRONG_FINAL_RESULT');
    assert.equal(report.accounting.dispatchesObserved, 2);
  }
});

test('smoke: unknown tools, invalid arguments, empty and multiple requests are policy failures', async (t) => {
  for (const calls of [
    [{ function: { name: 'PRIVATE_TOOL_NAME', arguments: {} } }],
    [
      {
        function: {
          name: 'getIncidentById',
          arguments: { incidentId: 'INC-01', private: 'ARGUMENT_SECRET' },
        },
      },
    ],
    [],
    [
      { function: { name: 'getIncidentById', arguments: { incidentId: 'INC-142' } } },
      { function: { name: 'getIncidentById', arguments: { incidentId: 'INC-142' } } },
    ],
  ]) {
    const f = await fixture(t);
    await f.enable();
    f.handle(async () =>
      Response.json({
        done: true,
        done_reason: 'stop',
        message: { role: 'assistant', content: '', tool_calls: calls },
      }),
    );
    const report = await executeSmoke(f.root, f.io);
    assert.equal(report.reason, 'POLICY_VIOLATION');
    assert.equal(report.technicalStatus, 'VALID_OBSERVED');
    assert.equal(report.scenarioStatus, 'FAILED');
    assert.equal(report.toolExecutions, 0);
    assert.equal(f.calls(), 1);
    const text = await readFile(join(f.directory, 'report.json'), 'utf8');
    assert.equal(text.includes('PRIVATE_TOOL_NAME'), false);
    assert.equal(text.includes('ARGUMENT_SECRET'), false);
  }
});

test('smoke: additional tool requests stop after two calls without a second execution', async (t) => {
  const f = await fixture(t);
  await f.enable();
  f.handle(async () => tool());
  const report = await executeSmoke(f.root, f.io);
  assert.equal(report.reason, 'POLICY_VIOLATION');
  assert.equal(report.toolExecutions, 1);
  assert.equal(f.calls(), 2);
});

test('smoke: malformed protocol, HTTP and connection errors are distinct from semantics', async (t) => {
  for (const kind of ['protocol', 'http', 'connection'] as const) {
    const f = await fixture(t);
    await f.enable();
    f.handle(async () => {
      if (kind === 'protocol') {
        return new Response('PRIVATE_RAW_OUTPUT');
      }
      if (kind === 'http') {
        return new Response('PRIVATE_HTTP_ERROR', { status: 503 });
      }
      throw new TypeError('PRIVATE_CONNECTION_ERROR', {
        cause: Object.assign(new Error('PRIVATE_CAUSE'), { code: 'ECONNRESET' }),
      });
    });
    const report = await executeSmoke(f.root, f.io);
    assert.equal(
      report.technicalStatus,
      kind === 'protocol' ? 'PROTOCOL_ERROR' : kind === 'http' ? 'HTTP_ERROR' : 'TRANSPORT_ERROR',
    );
    assert.equal(report.scenarioStatus, 'INCOMPLETE');
    assert.equal(f.calls(), 1);
    assert.equal(report.accounting.uncertainDispatches, 1);
    assert.equal(JSON.stringify(report).includes('PRIVATE_'), false);
  }
});

test('smoke: timeout aborts the actual adapter transport without retries', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ready = deferred();
  let time = 0;
  let calls = 0;
  let aborted = false;
  const result = runSmoke({
    config,
    now: () => time,
    verify() {},
    async reserve() {},
    request: async (_input, init) => {
      calls++;
      ready.resolve();
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(init.signal!.reason);
          },
          { once: true },
        );
      });
    },
  });
  await ready.promise;
  time = 45000;
  t.mock.timers.tick(45000);
  const report = await result;
  assert.equal(report.technicalStatus, 'TIMEOUT');
  assert.equal(report.scenarioStatus, 'INCOMPLETE');
  assert.equal(aborted, true);
  assert.equal(calls, 1);
  assert.equal(report.accounting.dispatchesObserved, 1);
});

test('smoke: delayed persistence cannot dispatch after application timeout and closure waits for it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const entered = deferred();
  const release = deferred();
  let time = 0;
  let calls = 0;
  let finished = false;
  const result = runSmoke({
    config,
    now: () => time,
    verify() {},
    async reserve() {
      entered.resolve();
      await release.promise;
    },
    request: async () => {
      calls++;
      return final();
    },
  });
  void result.then(() => {
    finished = true;
  });
  await entered.promise;
  time = 45000;
  t.mock.timers.tick(45000);
  await Promise.resolve();
  assert.equal(finished, false);
  release.resolve();
  const report = await result;
  assert.equal(calls, 0);
  assert.equal(report.technicalStatus, 'TIMEOUT');
  assert.equal(report.accounting.reservedAttempts, 1);
  assert.equal(report.accounting.notDispatched, 1);
});

test('smoke: signal cancellation and monotonic global deadline are rechecked after reservation', async () => {
  for (const globalExpired of [false, true]) {
    const signal = new AbortController();
    let expired = false;
    let calls = 0;
    const transport = createGuardedTransport({
      baseUrl: config.baseUrl,
      async reserve() {
        expired = true;
        signal.abort();
      },
      beforeDispatch() {
        if (globalExpired && expired) {
          throw new GlobalDeadlineExceededError();
        }
      },
      request: async () => {
        calls++;
        return final();
      },
    });
    await assert.rejects(
      transport.request(new URL('/api/chat', config.baseUrl), {
        method: 'POST',
        signal: signal.signal,
      }),
      globalExpired ? GlobalDeadlineExceededError : ClassificationError,
    );
    assert.equal(calls, 0);
    assert.equal(transport.accounting(0).notDispatched, 1);
  }
});

test('smoke: absolute third-send barrier and endpoint restriction preserve original responses and arguments', async () => {
  const response = final();
  const init = { method: 'POST', body: 'ORIGINAL_BODY' };
  let calls = 0;
  let reservations = 0;
  const transport = createGuardedTransport({
    baseUrl: config.baseUrl,
    async reserve(attempt) {
      assert.equal(attempt, ++reservations);
    },
    beforeDispatch() {},
    request: async (input, settings) => {
      calls++;
      assert.equal(String(input), 'http://localhost:11434/api/chat');
      assert.equal(settings, init);
      return response;
    },
  });
  assert.equal(await transport.request('http://localhost:11434/api/chat', init), response);
  assert.equal(await transport.request('http://localhost:11434/api/chat', init), response);
  await assert.rejects(
    transport.request('http://localhost:11434/api/chat', init),
    SmokeOperationalError,
  );
  assert.equal(calls, 2);
  assert.equal(reservations, 2);
  const restricted = createGuardedTransport({
    baseUrl: config.baseUrl,
    async reserve() {
      assert.fail('Wrong endpoint');
    },
    beforeDispatch() {},
    request: async () => {
      assert.fail('No fetch');
    },
  });
  await assert.rejects(
    restricted.request('http://localhost:11434/api/generate', init),
    SmokeOperationalError,
  );
});

test('smoke: check is strictly read-only and disabled authorization makes no requests', async (t) => {
  const f = await fixture(t);
  const bytes = await readFile(f.authorizationPath);
  const output: string[] = [];
  t.mock.method(console, 'log', (value: string) => {
    output.push(value);
  });
  assert.equal(await main(['--check'], f.root, f.io), 0);
  assert.equal(JSON.parse(output[0]!).networkRequests, 0);
  assert.equal(JSON.parse(output[0]!).authorizationEnabled, false);
  assert.equal(f.requests.length, 0);
  await assert.rejects(access(f.directory));
  assert.deepEqual(await readFile(f.authorizationPath), bytes);
  await assert.rejects(executeSmoke(f.root, f.io), SmokeOperationalError);
  assert.equal(f.requests.length, 0);
  await assert.rejects(main([], f.root, f.io), SmokeOperationalError);
  await assert.rejects(main(['--check', '--force'], f.root, f.io), SmokeOperationalError);
});

test('smoke: case, budget, identity, environment and approval cannot be bypassed', async (t) => {
  for (const patch of [
    { maximumAttempts: 3 },
    { force: true },
    { caseId: 'ANOTHER_CASE' },
    { identityHash: '0'.repeat(64) },
    { approvalReference: null },
    { promptHash: '0'.repeat(64) },
    { model: 'gemma3:12b' },
  ]) {
    const f = await fixture(t);
    await f.enable();
    await writeFile(f.authorizationPath, JSON.stringify({ ...f.authorization, ...patch }));
    await assert.rejects(executeSmoke(f.root, f.io));
    assert.equal(f.requests.length, 0);
    await assert.rejects(access(f.directory));
  }
  const f = await fixture(t);
  await f.enable();
  await assert.rejects(executeSmoke(f.root, { ...f.io, env: { OLLAMA_MODEL: 'gemma3:12b' } }));
  assert.equal(f.requests.length, 0);
});

test('smoke: metadata mismatch blocks before a claim or inference', async (t) => {
  const f = await fixture(t);
  await f.enable();
  const original = f.io.request!;
  await assert.rejects(
    executeSmoke(f.root, {
      ...f.io,
      request: async (input, init) =>
        new URL(String(input)).pathname === '/api/version'
          ? Response.json({ version: 'unexpected' })
          : original(input, init),
    }),
    SmokeOperationalError,
  );
  assert.equal(f.calls(), 0);
  assert.deepEqual(await readdir(f.directory), []);
});

test('smoke: second execution remains blocked despite historical authorization or missing final report', async (t) => {
  for (const removeFinal of [false, true]) {
    const f = await fixture(t);
    await f.enable();
    f.handle(async () => final());
    await executeSmoke(f.root, f.io);
    const requests = f.requests.length;
    if (removeFinal) {
      await rm(join(f.directory, 'report.json'));
      await rm(join(f.directory, 'closed.json'));
    }
    await assert.rejects(executeSmoke(f.root, f.io), SmokeOperationalError);
    assert.equal(f.requests.length, requests);
    assert.equal(f.calls(), 1);
  }
});

test('smoke: prior corrupt evidence or incomplete claim cannot silently initialize a new case', async (t) => {
  for (const name of ['started.json', 'attempt-1.json', 'report.json', 'budget.lock']) {
    const f = await fixture(t);
    await f.enable();
    await mkdir(f.directory, { recursive: true });
    await writeFile(join(f.directory, name), '{corrupt');
    await assert.rejects(executeSmoke(f.root, f.io), SmokeOperationalError);
    assert.equal(f.requests.length, 0);
  }
});

test('smoke: a concurrent invocation cannot enter while the first diagnostic holds the lock', async (t) => {
  const f = await fixture(t);
  await f.enable();
  const entered = deferred();
  const release = deferred();
  f.handle(async () => {
    entered.resolve();
    await release.promise;
    return final();
  });
  const first = executeSmoke(f.root, f.io);
  await entered.promise;
  assert.ok((await readdir(f.directory)).includes('budget.lock'));
  await assert.rejects(executeSmoke(f.root, f.io), SmokeOperationalError);
  assert.equal(f.calls(), 1);
  assert.ok((await readdir(f.directory)).includes('budget.lock'));
  release.resolve();
  await first;
  assert.equal((await readdir(f.directory)).includes('budget.lock'), false);
});

test('smoke: concurrent transport entry fails closed before a pending reservation can dispatch', async () => {
  const entered = deferred();
  const release = deferred();
  let calls = 0;
  const transport = createGuardedTransport({
    baseUrl: config.baseUrl,
    async reserve() {
      entered.resolve();
      await release.promise;
    },
    beforeDispatch() {},
    request: async () => {
      calls++;
      return final();
    },
  });
  const first = transport.request(new URL('/api/chat', config.baseUrl), { method: 'POST' });
  const rejected = assert.rejects(first, SmokeOperationalError);
  await entered.promise;
  await assert.rejects(
    transport.request(new URL('/api/chat', config.baseUrl), { method: 'POST' }),
    SmokeOperationalError,
  );
  release.resolve();
  await rejected;
  assert.equal(calls, 0);
});

test('smoke: failed durable claim prevents dispatch and cannot be retried', async (t) => {
  const f = await fixture(t);
  await f.enable();
  await assert.rejects(
    executeSmoke(f.root, {
      ...f.io,
      sync: {
        ...synchronization,
        async file() {
          throw new Error('PRIVATE_DISK_ERROR');
        },
      },
    }),
  );
  assert.equal(f.calls(), 0);
  assert.ok((await readdir(f.directory)).includes('started.json'));
  await assert.rejects(executeSmoke(f.root, f.io), SmokeOperationalError);
});

test('smoke: failed attempt persistence is operational, with no dispatch or budget refund', async (t) => {
  const f = await fixture(t);
  await f.enable();
  let writes = 0;
  const report = await executeSmoke(f.root, {
    ...f.io,
    sync: {
      ...synchronization,
      async file(handle) {
        writes++;
        if (writes === 3) {
          throw new Error('PRIVATE_ATTEMPT_ERROR');
        }
        await handle.sync();
      },
    },
  });
  assert.equal(f.calls(), 0);
  assert.equal(report.operationalStatus, 'FAILED');
  assert.equal(report.accounting.reservedAttempts, 1);
  assert.equal(report.accounting.notDispatched, 1);
  assert.equal(JSON.stringify(report).includes('PRIVATE_ATTEMPT_ERROR'), false);
  await assert.rejects(executeSmoke(f.root, f.io), SmokeOperationalError);
});

test('smoke: losing final persistence leaves a claim and attempt, never permission to repeat', async (t) => {
  const f = await fixture(t);
  await f.enable();
  f.handle(async () => final());
  let writes = 0;
  await assert.rejects(
    executeSmoke(f.root, {
      ...f.io,
      sync: {
        ...synchronization,
        async file(handle) {
          writes++;
          if (writes === 4) {
            throw new Error('PRIVATE_FINAL_ERROR');
          }
          await handle.sync();
        },
      },
    }),
  );
  assert.equal(f.calls(), 1);
  assert.equal(
    JSON.parse(await readFile(join(f.directory, 'attempt-1.json'), 'utf8')).state,
    'RESERVED_POSSIBLE_DISPATCH',
  );
  await assert.rejects(access(join(f.directory, 'closed.json')));
  await assert.rejects(executeSmoke(f.root, f.io), SmokeOperationalError);
});

test('smoke: changed authorization or code during the case prevents the second send', async (t) => {
  for (const change of ['authorization', 'code', 'marker'] as const) {
    const f = await fixture(t);
    await f.enable();
    f.handle(async () => {
      if (change === 'authorization') {
        await writeFile(
          f.authorizationPath,
          JSON.stringify({ ...f.authorization, execute: false }),
        );
      } else if (change === 'code') {
        f.changeCode();
      } else {
        await rm(join(f.directory, 'started.json'));
      }
      return tool();
    });
    await assert.rejects(executeSmoke(f.root, f.io), SmokeOperationalError);
    assert.equal(f.calls(), 1);
    await assert.rejects(executeSmoke(f.root, f.io));
    assert.equal(f.calls(), 1);
  }
});

test('smoke: report privacy and filesystem isolation preserve experimental evidence and authorization', async (t) => {
  const f = await fixture(t);
  const experimental = join(f.root, 'evals/reports/i006');
  const dataset = join(f.root, 'evals/datasets/incidents-tool-calling-v1.json');
  const manifest = join(f.root, 'evals/experiments/i006-manifest.json');
  await mkdir(experimental, { recursive: true });
  await mkdir(join(f.root, 'evals/datasets'), { recursive: true });
  const protectedFiles = [join(experimental, 'budget.json'), dataset, manifest];
  for (const path of protectedFiles) {
    await writeFile(path, 'EXPERIMENTAL_SENTINEL');
  }
  await f.enable();
  const report = await executeSmoke(f.root, f.io);
  for (const path of protectedFiles) {
    assert.equal(await readFile(path, 'utf8'), 'EXPERIMENTAL_SENTINEL');
  }
  const raw = await readFile(join(f.directory, 'report.json'), 'utf8');
  assert.equal(raw.includes(smokeCase.description), false);
  assert.equal(raw.includes('CORRELATION'), false);
  assert.equal(raw.includes('Error al guardar un informe'), false);
  assert.equal(raw.includes('arguments'), false);
  assert.equal(raw.includes('Clasifica la intención'), false);
  assert.equal(report.accounting.experimentalBudgetTouched, false);
  assert.equal(report.accounting.maximumCombinedAttempts, 122);
});

test('smoke: directory sync failure preserves the claim and blocks every dispatch', async (t) => {
  const f = await fixture(t);
  await f.enable();
  await assert.rejects(
    executeSmoke(f.root, {
      ...f.io,
      sync: {
        ...synchronization,
        async directory() {
          throw new Error('PRIVATE_DIRECTORY_SYNC');
        },
      },
    }),
  );
  assert.equal(f.calls(), 0);
  await assert.rejects(executeSmoke(f.root, f.io), SmokeOperationalError);
  assert.ok((await readdir(f.directory)).includes('started.json'));
});

test('smoke: wrong live digest, missing tools or changed model metadata block before inference', async (t) => {
  for (const change of ['digest', 'capability', 'metadata']) {
    const f = await fixture(t);
    await f.enable();
    const original = f.io.request!;
    await assert.rejects(
      executeSmoke(f.root, {
        ...f.io,
        request: async (input, init) => {
          const path = new URL(String(input)).pathname;
          if (path === '/api/tags' && change === 'digest') {
            return Response.json({ models: [{ name: config.model, digest: '0'.repeat(64) }] });
          }
          if (path === '/api/show' && change !== 'digest') {
            return Response.json(
              change === 'capability'
                ? { ...details, capabilities: ['completion'] }
                : { ...details, parameters: 'CHANGED' },
            );
          }
          return original(input, init);
        },
      }),
      SmokeOperationalError,
    );
    assert.equal(f.calls(), 0);
    assert.deepEqual(await readdir(f.directory), []);
  }
});
