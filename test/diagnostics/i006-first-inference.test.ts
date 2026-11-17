import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runFirstInference,
  createSingleSendTransport,
  DiagnosticSendLimitError,
} from '../../src/diagnostics/i006-first-inference.js';
import {
  checkFirstInference,
  executeFirstInference,
  main,
  type FirstInferenceAuthorization,
  type FirstInferenceIO,
} from '../../src/diagnostics/i006-first-inference-main.js';
import { synchronization } from '../../src/evaluation/durable-files.js';
import { sha256 } from '../../src/evaluation/dataset.js';
import { toolCallingInstructions } from '../../src/infrastructure/ollama/tool-calling-instructions.js';
import { incidentLookupTool } from '../../src/infrastructure/ollama/tool-calling-protocol.js';
import { SyntheticIncidentRepository } from '../../src/infrastructure/incidents/synthetic-incident-repository.js';

const config = { baseUrl: 'http://localhost:11434', model: 'llama3.1:8b' };
const secret = 'PRIVATE_DIAGNOSTIC_SECRET';
const details = { capabilities: ['completion', 'tools'], parameters: secret };
const final = (content = '{"type":"classification","category":"BUG"}') =>
  Response.json({
    done: true,
    done_reason: 'stop',
    message: { role: 'assistant', content },
  });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'i006-first-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const experiments = join(root, 'evals/experiments');
  await mkdir(experiments, { recursive: true });
  await mkdir(join(root, 'evals/datasets'), { recursive: true });
  const datasetBytes = await readFile('evals/datasets/incidents-tool-calling-v1.json');
  await writeFile(join(root, 'evals/datasets/incidents-tool-calling-v1.json'), datasetBytes);
  const description = JSON.parse(datasetBytes.toString()).examples[0].description as string;
  const authorizationPath = join(experiments, 'i006-first-inference-authorization.json');
  const authorization: FirstInferenceAuthorization = JSON.parse(
    await readFile('evals/experiments/i006-first-inference-authorization.json', 'utf8'),
  );
  authorization.modelMetadataHash = sha256(JSON.stringify(details));
  await writeFile(authorizationPath, JSON.stringify(authorization));
  let calls = 0;
  let metadataCalls = 0;
  let changed = false;
  let handler: (init?: RequestInit) => Promise<Response> = async () => final();
  const io: FirstInferenceIO = {
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
        if (changed) {
          throw new Error(secret);
        }
      },
    }),
    request: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/chat') {
        calls++;
        return handler(init);
      }
      metadataCalls++;
      if (path === '/api/version') {
        return Response.json({ version: '0.40.14' });
      }
      if (path === '/api/tags') {
        return Response.json({
          models: [{ name: config.model, digest: authorization.modelDigest }],
        });
      }
      assert.equal(path, '/api/show');
      return Response.json(details);
    },
  };
  const directory = join(root, 'evals/reports/i006-first-inference');
  return {
    root,
    directory,
    authorizationPath,
    authorization,
    description,
    io,
    calls: () => calls,
    metadataCalls: () => metadataCalls,
    changeCode() {
      changed = true;
    },
    handle(value: typeof handler) {
      handler = value;
    },
    async enable() {
      const checked = await checkFirstInference(root, io);
      authorization.execute = true;
      authorization.identityHash = checked.identityHash;
      authorization.approvalReference = 'I006-FIRST-INFERENCE-SIMULATED';
      await writeFile(authorizationPath, JSON.stringify(authorization));
    },
  };
}

test('first inference: exact frozen input and production payload, durable reservation, no repository or second inference', async (t) => {
  const f = await fixture(t);
  const repository = t.mock.method(SyntheticIncidentRepository.prototype, 'getById', async () => {
    assert.fail('Repository execution forbidden');
  });
  f.handle(async (init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), {
      model: config.model,
      stream: false,
      options: { temperature: 0 },
      messages: [
        { role: 'system', content: toolCallingInstructions },
        { role: 'user', content: f.description },
      ],
      tools: [incidentLookupTool],
    });
    assert.equal(
      JSON.parse(await readFile(join(f.directory, 'attempt-1.json'), 'utf8')).state,
      'RESERVED_POSSIBLE_DISPATCH',
    );
    return final();
  });
  await f.enable();
  const report = await executeFirstInference(f.root, f.io);
  assert.equal(report.status, 'FIRST_RESPONSE_OBSERVED');
  assert.deepEqual(report.firstResponse, { type: 'classification', category: 'BUG' });
  assert.equal(f.calls(), 1);
  assert.equal(repository.mock.callCount(), 0);
  assert.deepEqual(report.accounting, {
    scope: 'I006_FIRST_INFERENCE',
    maximumAttempts: 1,
    reservedAttempts: 1,
    dispatchesObserved: 1,
    validatedResponses: 1,
    uncertainDispatches: 0,
    experimentalBudgetTouched: false,
  });
  const bytes = await readFile(join(f.directory, 'report.json'));
  assert.equal(
    (await readFile(join(f.directory, 'report.json.sha256'), 'utf8')).trim(),
    sha256(bytes),
  );
});

test('first inference: abstention and every tool list stop before repository or policy evaluation', async (t) => {
  const repository = t.mock.method(SyntheticIncidentRepository.prototype, 'getById', async () => {
    assert.fail('No tool execution');
  });
  for (const calls of [
    null,
    [],
    [{ function: { name: secret, arguments: { secret } }, id: secret }],
    [
      { function: { name: 'getIncidentById', arguments: {} } },
      { function: { name: secret, arguments: secret } },
    ],
  ]) {
    const f = await fixture(t);
    f.handle(async () =>
      calls === null
        ? final('{"type":"abstention"}')
        : Response.json({
            done: true,
            done_reason: 'stop',
            message: { role: 'assistant', content: '', tool_calls: calls },
          }),
    );
    await f.enable();
    const report = await executeFirstInference(f.root, f.io);
    assert.equal(report.status, 'FIRST_RESPONSE_OBSERVED');
    assert.deepEqual(
      report.firstResponse,
      calls === null ? { type: 'abstention' } : { type: 'tool_calls', callCount: calls.length },
    );
    assert.equal(f.calls(), 1);
    assert.equal(repository.mock.callCount(), 0);
    const bytes = await readFile(join(f.directory, 'report.json'), 'utf8');
    assert.equal(bytes.includes(secret), false);
    assert.equal(bytes.includes('arguments'), false);
    assert.equal(bytes.includes(f.description), false);
    assert.equal(bytes.includes(toolCallingInstructions), false);
  }
});

test('first inference: provider errors remain distinct from deliberate and operational stops', async (t) => {
  for (const [kind, handler] of [
    ['invalid_response', async () => final(secret)],
    ['http_error', async () => new Response(secret, { status: 500 })],
    [
      'connection_error',
      async () => {
        throw Object.assign(new Error(secret), { code: 'ECONNRESET' });
      },
    ],
    [
      'unexpected_error',
      async () => {
        throw new Error(secret);
      },
    ],
  ] as const) {
    const f = await fixture(t);
    f.handle(handler);
    await f.enable();
    const report = await executeFirstInference(f.root, f.io);
    assert.equal(report.status, 'TECHNICAL_ERROR');
    assert.equal(report.error, kind);
    assert.equal(report.diagnostic, kind === 'invalid_response' ? 'FINAL_JSON_INVALID' : undefined);
    assert.equal(report.firstResponse, null);
    assert.equal(f.calls(), 1);
    assert.equal(report.accounting.uncertainDispatches, 1);
    assert.equal(JSON.stringify(report).includes(secret), false);
    await assert.rejects(executeFirstInference(f.root, f.io));
    assert.equal(f.calls(), 1);
  }
});

test('first inference: second send blocked specifically, even concurrent with pending reservation or after failure', async () => {
  const entered = deferred();
  const release = deferred();
  let sends = 0;
  let reservations = 0;
  const transport = createSingleSendTransport({
    baseUrl: config.baseUrl,
    beforeDispatch() {},
    async reserve() {
      reservations++;
      entered.resolve();
      await release.promise;
    },
    async request() {
      sends++;
      return final();
    },
  });
  const first = transport.request(new URL('/api/chat', config.baseUrl), { method: 'POST' });
  await entered.promise;
  await assert.rejects(
    transport.request(new URL('/api/chat', config.baseUrl), { method: 'POST' }),
    DiagnosticSendLimitError,
  );
  assert.equal(sends, 0);
  release.resolve();
  await first;
  await assert.rejects(
    transport.request(new URL('/api/chat', config.baseUrl), { method: 'POST' }),
    DiagnosticSendLimitError,
  );
  assert.equal(sends, 1);
  assert.equal(reservations, 1);
  assert.equal(transport.blocked(), true);
  transport.close();
  await transport.settle();
  const failed = createSingleSendTransport({
    baseUrl: config.baseUrl,
    beforeDispatch() {},
    async reserve() {
      throw new Error(secret);
    },
    async request() {
      assert.fail('Persistence failure cannot dispatch');
    },
  });
  await assert.rejects(failed.request(new URL('/api/chat', config.baseUrl), { method: 'POST' }));
  await assert.rejects(
    failed.request(new URL('/api/chat', config.baseUrl), { method: 'POST' }),
    DiagnosticSendLimitError,
  );
});

test('first inference: timeout aborts transport without retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let time = 0;
  let aborted = false;
  let calls = 0;
  const ready = deferred();
  const pending = runFirstInference({
    config,
    description: secret,
    now: () => time,
    verify() {},
    async reserve() {},
    async request(_input, init) {
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
  const report = await pending;
  assert.equal(report.status, 'TECHNICAL_ERROR');
  assert.equal(report.error, 'timeout');
  assert.equal(aborted, true);
  assert.equal(calls, 1);
});

test('first inference: late reservation cannot dispatch after timeout and closure waits for persistence', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let time = 0;
  let calls = 0;
  let finished = false;
  const ready = deferred();
  const release = deferred();
  const pending = runFirstInference({
    config,
    description: secret,
    now: () => time,
    verify() {},
    async reserve() {
      ready.resolve();
      await release.promise;
    },
    async request() {
      calls++;
      return final();
    },
  });
  void pending.then(() => {
    finished = true;
  });
  await ready.promise;
  time = 45000;
  t.mock.timers.tick(45000);
  await Promise.resolve();
  assert.equal(finished, false);
  release.resolve();
  const report = await pending;
  assert.equal(calls, 0);
  assert.equal(report.status, 'TECHNICAL_ERROR');
  assert.equal(report.error, 'timeout');
  assert.equal(report.accounting.reservedAttempts, 1);
});

test('first inference: repeated invocation and missing final reports cannot reopen the claim', async (t) => {
  const f = await fixture(t);
  await f.enable();
  await executeFirstInference(f.root, f.io);
  await assert.rejects(executeFirstInference(f.root, f.io));
  for (const name of ['report.json', 'report.json.sha256', 'closed.json']) {
    await rm(join(f.directory, name));
  }
  await assert.rejects(executeFirstInference(f.root, f.io));
  assert.equal(f.calls(), 1);
});

test('first inference: concurrent invocation rejects at lock before metadata or inference', async (t) => {
  const f = await fixture(t);
  const ready = deferred();
  const release = deferred();
  f.handle(async () => {
    ready.resolve();
    await release.promise;
    return final();
  });
  await f.enable();
  const first = executeFirstInference(f.root, f.io);
  await ready.promise;
  const metadata = f.metadataCalls();
  await assert.rejects(
    executeFirstInference(f.root, f.io),
    (error: NodeJS.ErrnoException) => error.code === 'EEXIST',
  );
  assert.equal(f.metadataCalls(), metadata);
  assert.equal(f.calls(), 1);
  release.resolve();
  await first;
});

test('first inference: persistence failures before send and after send retain evidence and block repetition', async (t) => {
  for (const failAt of [1, 3, 4]) {
    const f = await fixture(t);
    await f.enable();
    let writes = 0;
    const sync = {
      ...synchronization,
      async file(handle: Parameters<typeof synchronization.file>[0]) {
        writes++;
        await synchronization.file(handle);
        if (writes === failAt) {
          throw new Error(secret);
        }
      },
    };
    if (failAt === 3) {
      const report = await executeFirstInference(f.root, { ...f.io, sync });
      assert.equal(report.status, 'OPERATIONAL_FAILURE');
      assert.equal(report.accounting.dispatchesObserved, 0);
    } else {
      await assert.rejects(executeFirstInference(f.root, { ...f.io, sync }));
    }
    assert.equal(f.calls(), failAt === 4 ? 1 : 0);
    await assert.rejects(executeFirstInference(f.root, f.io));
    assert.ok((await readdir(f.directory)).includes('started.json'));
  }
});

test('first inference: changed authorization, dataset, model or build fail closed', async (t) => {
  for (const changed of ['authorization', 'dataset', 'model', 'build']) {
    const f = await fixture(t);
    await f.enable();
    if (changed === 'authorization') {
      f.authorization.maximumAttempts = 2 as 1;
      await writeFile(f.authorizationPath, JSON.stringify(f.authorization));
    }
    if (changed === 'dataset') {
      await writeFile(join(f.root, 'evals/datasets/incidents-tool-calling-v1.json'), secret);
    }
    if (changed === 'model') {
      f.authorization.model = 'gemma3:12b' as 'llama3.1:8b';
      await writeFile(f.authorizationPath, JSON.stringify(f.authorization));
    }
    if (changed === 'build') {
      f.changeCode();
    }
    await assert.rejects(executeFirstInference(f.root, f.io));
    assert.equal(f.calls(), 0);
  }
});

test('first inference: readonly check, disabled default, no CLI bypass and no historical writes', async (t) => {
  const f = await fixture(t);
  const log = t.mock.method(console, 'log', () => {});
  assert.equal(await main(['--check'], f.root, f.io), 0);
  assert.equal(f.metadataCalls(), 0);
  assert.equal(f.calls(), 0);
  await assert.rejects(readdir(f.directory));
  assert.equal(JSON.parse(String(log.mock.calls[0]!.arguments[0])).authorizationEnabled, false);
  await assert.rejects(executeFirstInference(f.root, f.io));
  for (const args of [[], ['--run', '--force'], ['--run', 'I006-002'], ['--execute']]) {
    await assert.rejects(main(args, f.root, f.io));
  }
  await f.enable();
  await executeFirstInference(f.root, f.io);
  assert.deepEqual(await readdir(join(f.root, 'evals/reports')), ['i006-first-inference']);
  assert.deepEqual(await readdir(join(f.root, 'evals/experiments')), [
    'i006-first-inference-authorization.json',
  ]);
});
