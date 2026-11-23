import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { OllamaKnowledge } from '../../src/knowledge/ollama.js';
import { loadRagConfig } from '../../src/knowledge/config.js';
import { askKnowledgeQuestion } from '../../src/knowledge/use-cases.js';
import { chunk, dependencies } from './helpers.js';

const config = loadRagConfig({
  RAG_EMBEDDING_TIMEOUT_MS: '1000',
  RAG_GENERATION_TIMEOUT_MS: '1000',
});

for (const stage of ['GENERATION', 'EMBEDDING'] as const) {
  test(`I007-R4 ${stage}: límite efectivo con transporte que ignora AbortSignal y resultado tardío`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let signal: AbortSignal | null | undefined;
    let resolveResponse!: (response: Response) => void;
    let requests = 0;
    let reads = 0;
    let cancellations = 0;
    const provider = new OllamaKnowledge(config, async (_url, init) => {
      requests++;
      signal = init?.signal;
      return new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      });
    });
    const operation =
      stage === 'GENERATION' ? provider.generate('q', [chunk]) : provider.identity();
    const rejected = assert.rejects(operation, { kind: `${stage}_TIMEOUT` });
    t.mock.timers.tick(1000);
    await rejected;
    assert.equal(signal?.aborted, true);
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          reads++;
          controller.enqueue(new TextEncoder().encode('PRIVATE_LATE_CONTENT'));
          controller.close();
        },
        cancel() {
          cancellations++;
        },
      },
      { highWaterMark: 0 },
    );
    resolveResponse(new Response(body));
    await nextTurn();
    assert.equal(requests, 1);
    assert.equal(reads, 0, 'Never consume a late response');
    assert.equal(cancellations, 1);
    await assert.rejects(operation, { kind: `${stage}_TIMEOUT` });
  });
}

test('I007-R4 lectura y cancelación no cooperativas no impiden timeout ni liberación del reader', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  let cancels = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      async pull() {
        started();
        return new Promise<void>(() => undefined);
      },
      async cancel() {
        cancels++;
        return new Promise<void>(() => undefined);
      },
    },
    { highWaterMark: 0 },
  );
  const provider = new OllamaKnowledge(config, async () => new Response(body));
  const operation = provider.generate('q', [chunk]);
  const rejected = assert.rejects(operation, { kind: 'GENERATION_TIMEOUT' });
  await reading;
  assert.equal(body.locked, true);
  t.mock.timers.tick(1000);
  await rejected;
  await nextTurn();
  assert.equal(cancels, 1);
  assert.equal(body.locked, false);
});

test('I007-R4 timeout abandona el caso, libera su snapshot y no admite una respuesta posterior', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let entered!: () => void;
  const called = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let complete!: (value: Response) => void;
  let sends = 0;
  const provider = new OllamaKnowledge(config, async () => {
    sends++;
    entered();
    return new Promise<Response>((resolve) => {
      complete = resolve;
    });
  });
  let snapshots = 0;
  let releases = 0;
  const deps = dependencies();
  deps.generator = provider;
  deps.repository.withSnapshot = async (action) => {
    snapshots++;
    try {
      return await action({
        async search() {
          return [chunk];
        },
      });
    } finally {
      snapshots--;
      releases++;
    }
  };
  const operation = askKnowledgeQuestion(deps, 'q');
  const rejected = assert.rejects(operation, { kind: 'GENERATION_TIMEOUT' });
  await called;
  assert.equal(snapshots, 1);
  t.mock.timers.tick(1000);
  await rejected;
  assert.equal(snapshots, 0);
  assert.equal(releases, 1);
  complete(
    Response.json({
      done: true,
      done_reason: 'stop',
      message: {
        role: 'assistant',
        content: '{"status":"ANSWER","answer":"LATE","chunkIds":["c1"]}',
      },
    }),
  );
  await nextTurn();
  assert.equal(sends, 1);
  assert.equal(releases, 1);
});
