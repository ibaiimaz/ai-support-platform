import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runToolsFormat,
  createToolsFormatBudget,
  withFirstRequestFormat,
  ToolsFormatOperationalError,
} from '../../src/diagnostics/i006-tools-format.js';
import {
  checkToolsFormat,
  executeToolsFormat,
  main,
  type ToolsFormatAuthorization,
  type ToolsFormatIO,
} from '../../src/diagnostics/i006-tools-format-main.js';
import {
  smokeCase,
  createGuardedTransport,
  SmokeOperationalError,
} from '../../src/diagnostics/i006-smoke.js';
import {
  createSingleSendTransport,
  DiagnosticSendLimitError,
} from '../../src/diagnostics/i006-first-inference.js';
import { synchronization } from '../../src/evaluation/durable-files.js';
import { sha256 } from '../../src/evaluation/dataset.js';
import { toolCallingInstructions } from '../../src/infrastructure/ollama/tool-calling-instructions.js';
import {
  incidentLookupTool,
  toolCallingFinalSchema,
} from '../../src/infrastructure/ollama/tool-calling-protocol.js';
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
  const root = await mkdtemp(join(tmpdir(), 'i006-tools-format-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const experiments = join(root, 'evals/experiments');
  await mkdir(experiments, { recursive: true });
  await mkdir(join(root, 'evals/datasets'), { recursive: true });
  const datasetBytes = await readFile('evals/datasets/incidents-tool-calling-v1.json');
  await writeFile(join(root, 'evals/datasets/incidents-tool-calling-v1.json'), datasetBytes);
  const description = JSON.parse(datasetBytes.toString()).examples[0].description as string;
  const authorizationPath = join(experiments, 'i006-tools-format-authorization.json');
  const authorization: ToolsFormatAuthorization = JSON.parse(
    await readFile('evals/experiments/i006-tools-format-authorization.json', 'utf8'),
  );
  authorization.modelMetadataHash = sha256(JSON.stringify(details));
  await writeFile(authorizationPath, JSON.stringify(authorization));
  let calls = 0;
  let metadataCalls = 0;
  let changed = false;
  let handler: (init?: RequestInit, call?: number) => Promise<Response> = async (_init, call) =>
    call === 2 ? tool() : final();
  const io: ToolsFormatIO = {
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
        return handler(init, calls);
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
  const directory = join(root, 'evals/reports/i006-tools-format');
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
      const checked = await checkToolsFormat(root, io);
      authorization.execute = true;
      authorization.identityHash = checked.identityHash;
      authorization.approvalReference = 'I006-TOOLS-FORMAT-SIMULATED';
      await writeFile(authorizationPath, JSON.stringify(authorization));
    },
  };
}

function tool(id = 'INC-142', extra = false) {
  const call = { id: secret, function: { name: 'getIncidentById', arguments: { incidentId: id } } };
  return Response.json({
    done: true,
    done_reason: 'stop',
    message: { role: 'assistant', content: '', tool_calls: extra ? [call, call] : [call] },
  });
}

test('tools+format: real composition preserves first payloads and native continuation, with durable reservations', async (t) => {
  const f = await fixture(t);
  const bodies: any[] = [];
  f.handle(async (init, call) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const name = call === 1 ? 'attempt-A-1.json' : `attempt-B-${call! - 1}.json`;
    assert.equal(
      JSON.parse(await readFile(join(f.directory, name), 'utf8')).state,
      'RESERVED_POSSIBLE_DISPATCH',
    );
    if (call === 2) {
      await readFile(join(f.directory, 'scenario-A.json'));
    }
    return call === 2 ? tool() : final();
  });
  await f.enable();
  const report = await executeToolsFormat(f.root, f.io);
  assert.equal(report.status, 'COMPLETE_PASSED');
  assert.equal(report.compatibilityObserved, true);
  assert.equal(f.calls(), 3);
  for (const [index, description] of [
    [0, f.description],
    [1, smokeCase.description],
  ] as const) {
    assert.deepEqual(bodies[index], {
      model: config.model,
      stream: false,
      options: { temperature: 0 },
      messages: [
        { role: 'system', content: toolCallingInstructions },
        { role: 'user', content: description },
      ],
      tools: [incidentLookupTool],
      format: toolCallingFinalSchema,
    });
  }
  assert.equal(Object.hasOwn(bodies[2], 'tools'), false);
  assert.deepEqual(bodies[2].format, toolCallingFinalSchema);
  assert.deepEqual(bodies[2].messages.slice(0, 2), bodies[1].messages);
  assert.deepEqual(bodies[2].messages[2], {
    role: 'assistant',
    content: '',
    tool_calls: [
      { id: secret, function: { name: 'getIncidentById', arguments: { incidentId: 'INC-142' } } },
    ],
  });
  assert.equal(bodies[2].messages[3].tool_call_id, secret);
  assert.equal(JSON.parse(bodies[2].messages[3].content).status, 'FOUND');
  const [a, b] = report.results;
  assert.equal(a!.dispatchesObserved, 1);
  assert.equal(a!.toolExecutions, 0);
  assert.equal(a!.directClassificationValid, true);
  assert.equal(b!.dispatchesObserved, 2);
  assert.equal(b!.toolExecutions, 1);
  assert.equal(b!.toolOutcome, 'FOUND');
  assert.equal(b!.nativeToolCallMatched, true);
  assert.equal(b!.continuationValid, true);
  assert.deepEqual(b!.finalResponse, { type: 'classification', category: 'BUG' });
  assert.ok(report.results.every((x) => x.semanticCorrect));
  const bytes = await readFile(join(f.directory, 'report.json'));
  assert.equal(
    (await readFile(join(f.directory, 'report.json.sha256'), 'utf8')).trim(),
    sha256(bytes),
  );
  assert.equal(bytes.includes(secret), false);
  assert.equal(bytes.includes(f.description), false);
  assert.equal(bytes.includes('arguments'), false);
  assert.equal(bytes.includes(toolCallingInstructions), false);
});

test('tools+format: second payload passes unchanged; malformed or premodified payloads fail closed', async () => {
  const seen: RequestInit[] = [];
  const wrapped = withFirstRequestFormat(async (_input, init) => {
    seen.push(init!);
    return final();
  }, config.model);
  const first = {
    method: 'POST',
    body: JSON.stringify({
      model: config.model,
      stream: false,
      options: { temperature: 0 },
      messages: [],
      tools: [incidentLookupTool],
    }),
  };
  await wrapped('http://invalid.test', first);
  assert.equal(Object.hasOwn(JSON.parse(first.body), 'format'), false);
  assert.deepEqual(JSON.parse(String(seen[0]!.body)), {
    ...JSON.parse(first.body),
    format: toolCallingFinalSchema,
  });
  const second = {
    method: 'POST',
    body: JSON.stringify({
      model: config.model,
      stream: false,
      options: { temperature: 0 },
      messages: [],
      format: toolCallingFinalSchema,
    }),
  };
  await wrapped('http://invalid.test', second);
  assert.equal(seen[1], second);
  for (const value of [
    secret,
    '{}',
    JSON.stringify({ ...JSON.parse(first.body), format: toolCallingFinalSchema }),
    JSON.stringify({ ...JSON.parse(first.body), tools: [] }),
    JSON.stringify({ ...JSON.parse(first.body), options: { temperature: 1 } }),
  ]) {
    let calls = 0;
    const invalid = withFirstRequestFormat(async () => {
      calls++;
      return final();
    }, config.model);
    await assert.rejects(
      invalid('http://invalid.test', { method: 'POST', body: value }),
      ToolsFormatOperationalError,
    );
    assert.equal(calls, 0);
  }
});

test('tools+format: A never executes tools or a second inference; valid deviations still permit B', async (t) => {
  for (const first of [() => tool(), () => tool('INC-999'), () => final('{"type":"abstention"}')]) {
    const f = await fixture(t);
    let lookups = 0;
    const original = SyntheticIncidentRepository.prototype.getById;
    const mock = t.mock.method(
      SyntheticIncidentRepository.prototype,
      'getById',
      async function (this: SyntheticIncidentRepository, ...args: Parameters<typeof original>) {
        lookups++;
        return original.apply(this, args);
      },
    );
    f.handle(async (_init, call) => (call === 1 ? first() : call === 2 ? tool() : final()));
    await f.enable();
    const report = await executeToolsFormat(f.root, f.io);
    assert.equal(report.status, 'COMPLETE_FAILED');
    assert.equal(report.results[0]!.status, 'OBSERVED');
    assert.equal(report.results[0]!.dispatchesObserved, 1);
    assert.equal(report.results[0]!.toolExecutions, 0);
    assert.equal(lookups, 1);
    assert.equal(f.calls(), 3);
    mock.mock.restore();
  }
});

test('tools+format: B rejects direct, unknown-ID and multiple first requests before repository or continuation', async (t) => {
  for (const wrong of [
    () => final(),
    () => tool('INC-999'),
    () => tool('INC-142', true),
    () => tool('INC-01'),
  ]) {
    const f = await fixture(t);
    const repository = t.mock.method(SyntheticIncidentRepository.prototype, 'getById', async () => {
      assert.fail('No repository access');
    });
    f.handle(async (_init, call) => (call === 1 ? final() : wrong()));
    await f.enable();
    const report = await executeToolsFormat(f.root, f.io);
    assert.equal(report.status, 'COMPLETE_FAILED');
    assert.equal(report.results[1]!.nativeToolCallMatched, false);
    assert.equal(f.calls(), 2);
    assert.equal(repository.mock.callCount(), 0);
    repository.mock.restore();
  }
});

test('tools+format: semantic mistakes and valid abstention do not become protocol errors', async (t) => {
  for (const response of [
    () => final('{"type":"classification","category":"FEATURE"}'),
    () => final('{"type":"abstention"}'),
  ]) {
    const f = await fixture(t);
    f.handle(async (_init, call) => (call === 2 ? tool() : call === 3 ? response() : final()));
    await f.enable();
    const report = await executeToolsFormat(f.root, f.io);
    assert.equal(report.status, 'COMPLETE_FAILED');
    assert.equal(report.compatibilityObserved, true);
    assert.equal(report.results[1]!.continuationValid, true);
    assert.equal(report.results[1]!.error, null);
    assert.notEqual(report.results[1]!.semanticCorrect, true);
  }
});

test('tools+format: NOT_FOUND, repository failure and additional tool calls cannot continue or repeat lookups', async (t) => {
  for (const outcome of ['missing', 'unavailable', 'additional']) {
    const f = await fixture(t);
    let lookups = 0;
    const original = SyntheticIncidentRepository.prototype.getById;
    const mock = t.mock.method(
      SyntheticIncidentRepository.prototype,
      'getById',
      async function (this: SyntheticIncidentRepository, ...args: Parameters<typeof original>) {
        lookups++;
        if (outcome === 'missing') {
          return null;
        }
        if (outcome === 'unavailable') {
          throw new Error(secret);
        }
        return original.apply(this, args);
      },
    );
    f.handle(async (_init, call) => (call === 1 ? final() : tool()));
    await f.enable();
    const report = await executeToolsFormat(f.root, f.io);
    assert.equal(lookups, 1);
    assert.equal(f.calls(), outcome === 'additional' ? 3 : 2);
    assert.equal(report.results[1]!.continuationValid, false);
    assert.equal(
      report.results[1]!.status,
      outcome === 'unavailable' ? 'OPERATIONAL_FAILURE' : 'OBSERVED',
    );
    mock.mock.restore();
  }
});

test('tools+format: technical errors stop globally, preserve diagnostics and never retry', async (t) => {
  for (const phase of ['A', 'B']) {
    const f = await fixture(t);
    f.handle(async (_init, call) => (phase === 'A' || call === 2 ? final(secret) : final()));
    await f.enable();
    const report = await executeToolsFormat(f.root, f.io);
    assert.equal(report.status, 'INCOMPLETE');
    assert.equal(report.results.length, phase === 'A' ? 1 : 2);
    assert.equal(report.results.at(-1)!.error, 'invalid_response');
    assert.equal(report.results.at(-1)!.diagnostic, 'FINAL_JSON_INVALID');
    assert.equal(f.calls(), phase === 'A' ? 1 : 2);
    assert.equal(JSON.stringify(report).includes(secret), false);
    await assert.rejects(executeToolsFormat(f.root, f.io));
  }
});

test('tools+format: A one-send and B two-send guards block excess sends independently', async () => {
  for (const limit of [1, 2]) {
    let sent = 0;
    let reserved = 0;
    const options = {
      baseUrl: config.baseUrl,
      beforeDispatch() {},
      async reserve() {
        reserved++;
      },
      async request() {
        sent++;
        return final();
      },
    };
    const guard =
      limit === 1 ? createSingleSendTransport(options) : createGuardedTransport(options);
    for (let i = 0; i < limit; i++) {
      await guard.request(config.baseUrl + '/api/chat', { method: 'POST' });
    }
    await assert.rejects(
      guard.request(config.baseUrl + '/api/chat', { method: 'POST' }),
      limit === 1 ? DiagnosticSendLimitError : SmokeOperationalError,
    );
    assert.equal(sent, limit);
    assert.equal(reserved, limit);
    guard.close();
    await guard.settle();
  }
});

test('tools+format: ordered budget rejects extra, duplicate and concurrent reservations; uncertain writes never refund', async () => {
  const history: string[] = [];
  const budget = createToolsFormatBudget(async (scenario, attempt) => {
    history.push(`${scenario}-${attempt}`);
  });
  await assert.rejects(budget.reserve('B', 1));
  await budget.reserve('A', 1);
  await assert.rejects(budget.reserve('A', 2));
  await budget.reserve('B', 1);
  await budget.reserve('B', 2);
  await assert.rejects(budget.reserve('B', 3));
  await assert.rejects(budget.reserve('A', 1));
  assert.deepEqual(history, ['A-1', 'B-1', 'B-2']);
  assert.equal(budget.consumed(), 3);
  const entered = deferred();
  const release = deferred();
  const concurrent = createToolsFormatBudget(async () => {
    entered.resolve();
    await release.promise;
  });
  const first = concurrent.reserve('A', 1);
  const firstRejected = assert.rejects(first, ToolsFormatOperationalError);
  await entered.promise;
  await assert.rejects(concurrent.reserve('A', 1));
  release.resolve();
  await firstRejected;
  await assert.rejects(concurrent.reserve('B', 1));
  const failed = createToolsFormatBudget(async () => {
    throw new Error(secret);
  });
  await assert.rejects(failed.reserve('A', 1));
  assert.equal(failed.consumed(), 1);
  await assert.rejects(failed.reserve('A', 1));
  await assert.rejects(failed.reserve('B', 1));
});

test('tools+format: timeout aborts and stops before B without real waits', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let time = 0;
  let aborted = false;
  let calls = 0;
  const ready = deferred();
  const pending = runToolsFormat({
    config,
    description: secret,
    now: () => time,
    verify() {},
    async reserve() {},
    async record() {},
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
  assert.equal(report.status, 'INCOMPLETE');
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0]!.error, 'timeout');
  assert.equal(calls, 1);
  assert.equal(aborted, true);
});

test('tools+format: persistence failures prevent subsequent sends and leave permanent evidence', async (t) => {
  for (const failAt of [1, 3, 4, 8]) {
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
      const report = await executeToolsFormat(f.root, { ...f.io, sync });
      assert.equal(report.status, 'INCOMPLETE');
      assert.equal(report.results[0]!.status, 'OPERATIONAL_FAILURE');
    } else {
      await assert.rejects(executeToolsFormat(f.root, { ...f.io, sync }));
    }
    assert.equal(f.calls(), failAt === 8 ? 3 : failAt === 4 ? 1 : 0);
    await assert.rejects(executeToolsFormat(f.root, f.io));
    assert.ok((await readdir(f.directory)).includes('started.json'));
  }
});

test('tools+format: concurrent invocation rejects specifically at lock and repeats remain blocked without report', async (t) => {
  const f = await fixture(t);
  const ready = deferred();
  const release = deferred();
  f.handle(async (_init, call) => {
    if (call === 1) {
      ready.resolve();
      await release.promise;
    }
    return call === 2 ? tool() : final();
  });
  await f.enable();
  const first = executeToolsFormat(f.root, f.io);
  await ready.promise;
  const metadata = f.metadataCalls();
  await assert.rejects(
    executeToolsFormat(f.root, f.io),
    (error: NodeJS.ErrnoException) => error.code === 'EEXIST',
  );
  assert.equal(f.metadataCalls(), metadata);
  assert.equal(f.calls(), 1);
  release.resolve();
  await first;
  await assert.rejects(executeToolsFormat(f.root, f.io));
  for (const name of ['report.json', 'report.json.sha256', 'closed.json']) {
    await rm(join(f.directory, name));
  }
  await assert.rejects(executeToolsFormat(f.root, f.io));
  assert.equal(f.calls(), 3);
});

test('tools+format: disabled defaults, exact identity and strict CLI; check is read-only and isolated', async (t) => {
  const f = await fixture(t);
  const log = t.mock.method(console, 'log', () => {});
  assert.equal(await main(['--check'], f.root, f.io), 0);
  const checked = JSON.parse(String(log.mock.calls[0]!.arguments[0]));
  assert.equal(checked.authorizationEnabled, false);
  assert.equal(checked.networkRequests, 0);
  assert.equal(checked.maximumEffectiveAttempts, 3);
  await assert.rejects(readdir(f.directory));
  await assert.rejects(executeToolsFormat(f.root, f.io));
  for (const args of [[], ['--run', '--force'], ['--run', 'B'], ['--execute']]) {
    await assert.rejects(main(args, f.root, f.io));
  }
  assert.equal(f.metadataCalls(), 0);
  await f.enable();
  f.authorization.identityHash = '0'.repeat(64);
  await writeFile(f.authorizationPath, JSON.stringify(f.authorization));
  await assert.rejects(executeToolsFormat(f.root, f.io));
  assert.equal(f.calls(), 0);
  await f.enable();
  await executeToolsFormat(f.root, f.io);
  assert.deepEqual(await readdir(join(f.root, 'evals/reports')), ['i006-tools-format']);
  assert.deepEqual(await readdir(join(f.root, 'evals/experiments')), [
    'i006-tools-format-authorization.json',
  ]);
});

test('tools+format: schema, HTTP and transport errors remain sanitized technical failures', async (t) => {
  for (const [kind, handler] of [
    ['invalid_response', async () => final('{"category":"BUG"}')],
    ['http_error', async () => new Response(secret, { status: 503 })],
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
    const report = await executeToolsFormat(f.root, f.io);
    assert.equal(report.status, 'INCOMPLETE');
    assert.equal(report.results.length, 1);
    assert.equal(report.results[0]!.error, kind);
    assert.equal(
      report.results[0]!.diagnostic,
      kind === 'invalid_response' ? 'FINAL_SCHEMA_INVALID' : undefined,
    );
    assert.equal(report.results[0]!.status, 'TECHNICAL_ERROR');
    assert.equal(f.calls(), 1);
    assert.equal(JSON.stringify(report).includes(secret), false);
  }
});

test('tools+format: expired pending reservation cannot send late or enter B', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let time = 0;
  let calls = 0;
  let finished = false;
  const ready = deferred();
  const release = deferred();
  const pending = runToolsFormat({
    config,
    description: secret,
    now: () => time,
    verify() {},
    async reserve() {
      ready.resolve();
      await release.promise;
    },
    async record() {},
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
  assert.equal(report.status, 'INCOMPLETE');
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0]!.error, 'timeout');
});

test('tools+format: changed build or authorization during A prevents B and preserves the claim', async (t) => {
  for (const change of ['build', 'authorization']) {
    const f = await fixture(t);
    await f.enable();
    f.handle(async () => {
      if (change === 'build') {
        f.changeCode();
      } else {
        f.authorization.execute = false;
        await writeFile(f.authorizationPath, JSON.stringify(f.authorization));
      }
      return final();
    });
    await assert.rejects(executeToolsFormat(f.root, f.io));
    assert.equal(f.calls(), 1);
    assert.ok((await readdir(f.directory)).includes('started.json'));
    await assert.rejects(executeToolsFormat(f.root, f.io));
    assert.equal(f.calls(), 1);
  }
});
