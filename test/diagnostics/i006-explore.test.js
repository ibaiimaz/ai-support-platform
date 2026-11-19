import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPlan, execute, main } from '../../scripts/i006-explore.js';

const plan = loadPlan();
const tags = { models: [{ name: plan.model, digest: plan.digest }] };

test('exploration selects six synthetic cases and changes only the system prompt in the initial paired variants', () => {
  assert.equal(plan.calls.length, 12);
  assert.equal(plan.maxCalls, 12);
  assert.deepEqual(
    [...new Set(plan.calls.map((call) => call.caseId))],
    ['I006-001', 'I006-002', 'I006-011', 'I006-012', 'I006-031', 'I006-032'],
  );
  for (let i = 0; i < 12; i += 2) {
    const first = plan.calls[i].body;
    const second = plan.calls[i + 1].body;
    assert.deepEqual(first.messages[1], second.messages[1]);
    assert.notEqual(first.messages[0].content, second.messages[0].content);
    assert.deepEqual({ ...first, messages: second.messages }, second);
    assert.equal(first.messages.length, 2);
    assert.deepEqual(Object.keys(first).sort(), [
      'messages',
      'model',
      'options',
      'stream',
      'tools',
    ]);
    assert.equal(JSON.stringify(first).includes('expectedFinal'), false);
    assert.equal(JSON.stringify(first).includes('toolExpected'), false);
    assert.equal(JSON.stringify(first).includes('rationale'), false);
  }
});

test('exploration preview is the default, never accesses the network and does not create results', async (t) => {
  const existed = existsSync('evals/reports/i006-exploration');
  let output;
  t.mock.method(console, 'log', (value) => {
    output = JSON.parse(value);
  });
  t.mock.method(globalThis, 'fetch', () => assert.fail('Preview attempted network'));
  await main([]);
  assert.equal(output.calls.length, 12);
  assert.equal(existsSync('evals/reports/i006-exploration'), existed);
});

test('direct exploration preserves complete requests and raw native tool responses without executing tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'i006-explore-'));
  try {
    let calls = 0;
    const raw =
      '{"done":true,"message":{"role":"assistant","content":"texto sintético completo","tool_calls":[{"function":{"name":"arbitrarySyntheticTool","arguments":{"incidentId":"INC-999"}}}]}}';
    const summary = await execute(
      plan,
      async (url, init) => {
        if (url.endsWith('/api/tags')) {
          return Response.json(tags);
        }
        if (url.endsWith('/api/version')) {
          return Response.json({ version: '0.40.14' });
        }
        assert.equal(url, 'http://localhost:11434/api/chat');
        assert.equal(init.method, 'POST');
        const body = JSON.parse(init.body);
        assert.deepEqual(body, plan.calls[calls].body);
        calls++;
        return new Response(raw);
      },
      root,
    );
    assert.equal(calls, 12);
    assert.equal(summary.attempted, 12);
    assert.equal(summary.status, 'RECEIVED_ALL');
    assert.equal((await readdir(summary.directory)).length, 14);
    const record = JSON.parse(await readFile(summary.results[0].file, 'utf8'));
    assert.equal(record.responseBody, raw);
    assert.deepEqual(record.request, plan.calls[0].body);
    assert.equal(record.state, 'RECEIVED');
    const again = await execute(
      { ...plan, calls: [plan.calls[0]] },
      async (url) =>
        url.endsWith('/api/tags')
          ? Response.json(tags)
          : url.endsWith('/api/version')
            ? Response.json({ version: 'test' })
            : new Response('{}'),
      root,
    );
    assert.notEqual(again.directory, summary.directory);
    assert.equal(
      await readFile(summary.results[0].file, 'utf8'),
      JSON.stringify(record, null, 2) + '\n',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('wrong model digest blocks before any inference or result directory is created', async () => {
  const root = await mkdtemp(join(tmpdir(), 'i006-explore-'));
  try {
    const output = join(root, 'not-created');
    let calls = 0;
    await assert.rejects(
      execute(
        plan,
        async (url) => {
          assert.ok(url.endsWith('/api/tags'));
          calls++;
          return Response.json({ models: [{ name: plan.model, digest: '0'.repeat(64) }] });
        },
        output,
      ),
      /digest unavailable/,
    );
    assert.equal(calls, 1);
    assert.equal(existsSync(output), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('HTTP and network failures preserve partial observations and stop without retrying', async () => {
  for (const failure of ['http', 'network']) {
    const root = await mkdtemp(join(tmpdir(), 'i006-explore-'));
    try {
      let calls = 0;
      const summary = await execute(
        plan,
        async (url) => {
          if (url.endsWith('/api/tags')) {
            return Response.json(tags);
          }
          if (url.endsWith('/api/version')) {
            return Response.json({ version: 'test' });
          }
          calls++;
          if (failure === 'network') {
            throw new Error('arbitrary local error');
          }
          return new Response('full synthetic HTTP error response', { status: 503 });
        },
        root,
      );
      assert.equal(calls, 1);
      assert.equal(summary.status, 'STOPPED');
      assert.equal(summary.attempted, 1);
      const record = JSON.parse(await readFile(summary.results[0].file, 'utf8'));
      assert.equal(record.state, failure === 'http' ? 'HTTP_ERROR' : 'NETWORK_ERROR');
      assert.equal(
        record.responseBody,
        failure === 'http' ? 'full synthetic HTTP error response' : null,
      );
      assert.equal(JSON.stringify(record).includes('arbitrary local error'), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('batch limits and synthetic declaration are mandatory; tools, schema and model parameters pass through unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'i006-explore-'));
  try {
    const batch = JSON.parse(
      await readFile('evals/experiments/i006-exploration-batch.json', 'utf8'),
    );
    const path = join(root, 'batch.json');
    for (const patch of [
      { maxCalls: 6 },
      { maxCalls: 13 },
      { synthetic: false },
      { model: 'different-model' },
    ]) {
      await writeFile(path, JSON.stringify({ ...batch, ...patch }));
      assert.throws(() => loadPlan(path));
    }
    batch.cases = [{ id: 'synthetic-custom', description: 'Texto sintético de prueba.' }];
    batch.variants = [
      {
        name: 'schema-and-tools',
        system: 'Instrucciones sintéticas.',
        tools: [
          {
            type: 'function',
            function: {
              name: 'synthetic',
              parameters: { type: 'object', properties: { incidentId: { enum: ['INC-1'] } } },
            },
          },
        ],
        format: { type: 'object', properties: { category: { enum: ['BUG'] } } },
        options: { temperature: 0.3, seed: 7, num_predict: 100 },
      },
    ];
    await writeFile(path, JSON.stringify(batch));
    const custom = loadPlan(path).calls[0].body;
    assert.deepEqual(custom.tools, batch.variants[0].tools);
    assert.deepEqual(custom.format, batch.variants[0].format);
    assert.deepEqual(custom.options, batch.variants[0].options);
    assert.equal(custom.messages[1].content, batch.cases[0].description);
    assert.equal(custom.model, 'llama3.1:8b');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
