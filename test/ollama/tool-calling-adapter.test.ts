import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassificationError } from '../../src/application/classification-errors.js';
import { OllamaClassificationLlm } from '../../src/infrastructure/ollama/ollama-classification-llm.js';

const config = { baseUrl: 'http://ollama.invalid:11434/ignored', model: 'llama3.1:8b' };

function response(message: unknown = { role: 'assistant', content: '{"type":"abstention"}' }) {
  return new Response(JSON.stringify({ done: true, done_reason: 'stop', message }));
}

function failure(kind: string) {
  return (error: unknown) => error instanceof ClassificationError && error.kind === kind;
}

test('I006-AC-17 tools enabled sends the exact native request without format or prompt injection by adapter', async () => {
  let requests = 0;
  const adapter = new OllamaClassificationLlm(config, async (url, options) => {
    requests += 1;
    assert.equal(String(url), 'http://ollama.invalid:11434/api/chat');
    assert.equal(options?.method, 'POST');
    assert.equal(options.redirect, 'manual');
    assert.deepEqual(options.headers, { 'content-type': 'application/json' });
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(String(options.body)), {
      model: 'llama3.1:8b',
      stream: false,
      options: { temperature: 0 },
      messages: [
        { role: 'system', content: 'instructions supplied by application' },
        { role: 'user', content: 'incident' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'getIncidentById',
            description:
              'Consultar una incidencia anterior por su identificador cuando falte contexto.',
            parameters: {
              type: 'object',
              required: ['incidentId'],
              additionalProperties: false,
              properties: {
                incidentId: {
                  type: 'string',
                  description: 'Identificador de incidencia, por ejemplo INC-142.',
                },
              },
            },
          },
        },
      ],
    });
    return response({
      role: 'assistant',
      content: '{"type":"classification","category":"FEATURE"}',
    });
  });

  assert.deepEqual(
    await adapter.infer(
      [
        { role: 'system', content: 'instructions supplied by application' },
        { role: 'user', content: 'incident' },
      ],
      { timeoutMs: 45_000, toolsEnabled: true },
    ),
    { type: 'classification', category: 'FEATURE' },
  );
  assert.equal(requests, 1);
});

test('I006-AC-17 tools disabled sends the strict final schema and retains assistant/tool correlation', async () => {
  const adapter = new OllamaClassificationLlm(config, async (_url, options) => {
    assert.deepEqual(JSON.parse(String(options?.body)), {
      model: 'llama3.1:8b',
      stream: false,
      options: { temperature: 0 },
      messages: [
        { role: 'user', content: 'incident' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call-1',
              function: { name: 'getIncidentById', arguments: { incidentId: 'INC-142' } },
            },
          ],
        },
        {
          role: 'tool',
          tool_name: 'getIncidentById',
          tool_call_id: 'call-1',
          content: '{"status":"NOT_FOUND","incidentId":"INC-142"}',
        },
      ],
      format: {
        oneOf: [
          {
            type: 'object',
            required: ['type', 'category'],
            additionalProperties: false,
            properties: {
              type: { const: 'classification' },
              category: { type: 'string', enum: ['BUG', 'FEATURE', 'QUESTION'] },
            },
          },
          {
            type: 'object',
            required: ['type'],
            additionalProperties: false,
            properties: { type: { const: 'abstention' } },
          },
        ],
      },
    });
    return response();
  });

  assert.deepEqual(
    await adapter.infer(
      [
        { role: 'user', content: 'incident' },
        {
          role: 'assistant',
          toolCalls: [
            { name: 'getIncidentById', arguments: { incidentId: 'INC-142' }, callId: 'call-1' },
          ],
        },
        {
          role: 'tool',
          name: 'getIncidentById',
          callId: 'call-1',
          content: '{"status":"NOT_FOUND","incidentId":"INC-142"}',
        },
      ],
      { timeoutMs: 45_000, toolsEnabled: false },
    ),
    { type: 'abstention' },
  );
});

test('I006-AC-17 retains multiple unknown calls even when tools are disabled, without extra requests', async () => {
  let requests = 0;
  const adapter = new OllamaClassificationLlm(config, async () => {
    requests += 1;
    return response({
      role: 'assistant',
      tool_calls: [
        { function: { name: 'unknown', arguments: 'not repaired' }, id: 'call-1' },
        { function: { name: 'getIncidentById', arguments: { incidentId: 142, extra: true } } },
      ],
    });
  });

  assert.deepEqual(await adapter.infer([], { timeoutMs: 45_000, toolsEnabled: false }), {
    type: 'tool_calls',
    calls: [
      { name: 'unknown', arguments: 'not repaired', callId: 'call-1' },
      { name: 'getIncidentById', arguments: { incidentId: 142, extra: true } },
    ],
  });
  assert.equal(requests, 1);
});

test('I006-AC-17 validates final JSON in both modes without repair, fallback or retries', async () => {
  for (const toolsEnabled of [true, false]) {
    for (const content of [
      '{',
      '{"type":"abstention","extra":1}',
      '{"type":"classification","category":"OTHER"}',
      '```json {"type":"abstention"} ```',
    ]) {
      let requests = 0;
      const adapter = new OllamaClassificationLlm(config, async () => {
        requests += 1;
        return response({ role: 'assistant', content });
      });
      await assert.rejects(
        adapter.infer([], { timeoutMs: 45_000, toolsEnabled }),
        failure('invalid_response'),
      );
      assert.equal(requests, 1);
    }
  }
});

test('I006-AC-17 HTTP failures, including redirects, remain generic and never retry', async () => {
  for (const status of [302, 400, 429, 500, 503]) {
    let requests = 0;
    let cancelled = false;
    const adapter = new OllamaClassificationLlm(config, async () => {
      requests += 1;
      return new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { status },
      );
    });
    await assert.rejects(adapter.infer([], { timeoutMs: 45_000, toolsEnabled: true }), (error) => {
      assert.ok(error instanceof ClassificationError);
      assert.equal(error.kind, 'http_error');
      assert.equal(error.message, 'Classification provider failed');
      return true;
    });
    assert.equal(requests, 1);
    assert.equal(cancelled, true);
  }
});

test('I006-AC-17 connection errors are recognized while programming failures propagate unchanged', async () => {
  const connection = Object.assign(new Error('private transport detail'), { code: 'ECONNREFUSED' });
  const unexpected = new TypeError('programming error');
  const cyclic = new Error('cyclic programming error');
  cyclic.cause = cyclic;
  for (const error of [
    connection,
    new TypeError('fetch failed', { cause: connection }),
    new AggregateError([connection]),
  ]) {
    const adapter = new OllamaClassificationLlm(config, async () => {
      throw error;
    });
    await assert.rejects(
      adapter.infer([], { timeoutMs: 45_000, toolsEnabled: true }),
      failure('connection_error'),
    );
  }

  for (const error of [
    unexpected,
    cyclic,
    new AggregateError([connection, unexpected]),
    new DOMException('unrelated abort', 'AbortError'),
  ]) {
    const adapter = new OllamaClassificationLlm(config, async () => {
      throw error;
    });
    await assert.rejects(
      adapter.infer([], { timeoutMs: 45_000, toolsEnabled: true }),
      (caught) => caught === error,
    );
  }
});

test('I006-AC-17 limits response bytes, rejects absent bodies and preserves read failures', async () => {
  let cancelled = false;
  const oversized = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(65_537));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  for (const result of [new Response(null), new Response('{'), oversized]) {
    const adapter = new OllamaClassificationLlm(config, async () => result);
    await assert.rejects(
      adapter.infer([], { timeoutMs: 45_000, toolsEnabled: true }),
      failure('invalid_response'),
    );
  }
  assert.equal(cancelled, true);

  const connection = Object.assign(new Error('read interrupted'), { code: 'ECONNRESET' });
  const unexpected = new TypeError('unexpected reader failure');
  for (const error of [connection, unexpected]) {
    const adapter = new OllamaClassificationLlm(
      config,
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(error);
            },
          }),
        ),
    );
    await assert.rejects(
      adapter.infer([], { timeoutMs: 45_000, toolsEnabled: true }),
      error === connection ? failure('connection_error') : (caught) => caught === unexpected,
    );
  }
});

test('I006-AC-17 accepts a complete response at the byte limit and split Unicode chunks', async () => {
  const text = JSON.stringify({
    done: true,
    done_reason: 'stop',
    message: { role: 'assistant', content: '{"type":"abstention"}' },
    metadata: '😀',
  });
  const bytes = Buffer.from(text);
  const padded = Buffer.concat([bytes, Buffer.alloc(65_536 - bytes.length, 32)]);
  const emojiOffset = bytes.indexOf(Buffer.from('😀'));
  const adapter = new OllamaClassificationLlm(
    config,
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(padded.subarray(0, emojiOffset + 1));
            controller.enqueue(padded.subarray(emojiOffset + 1));
            controller.close();
          },
        }),
      ),
  );

  assert.deepEqual(await adapter.infer([], { timeoutMs: 45_000, toolsEnabled: true }), {
    type: 'abstention',
  });
});

test('I006-AC-17 request timeout is bounded at 45 seconds even if fetch ignores cancellation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let signal: AbortSignal | null | undefined;
  let requests = 0;
  const adapter = new OllamaClassificationLlm(config, async (_url, options) => {
    requests += 1;
    signal = options?.signal;
    started();
    return new Promise<Response>(() => {});
  });
  const pending = assert.rejects(
    adapter.infer([], { timeoutMs: 90_000, toolsEnabled: true }),
    failure('timeout'),
  );
  await ready;
  t.mock.timers.tick(44_999);
  assert.equal(signal?.aborted, false);
  t.mock.timers.tick(1);
  await pending;
  assert.equal(signal?.aborted, true);
  assert.equal(requests, 1);
});

test('I006-AC-17 the caller shorter timeout covers body reading and cancels best effort', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let reading!: () => void;
  const ready = new Promise<void>((resolve) => {
    reading = resolve;
  });
  let cancelled = false;
  let signal: AbortSignal | null | undefined;
  const adapter = new OllamaClassificationLlm(config, async (_url, options) => {
    signal = options?.signal;
    return new Response(
      new ReadableStream(
        {
          pull() {
            reading();
          },
          cancel() {
            cancelled = true;
            return new Promise<void>(() => {});
          },
        },
        // Disable eager buffering: the signal proves the adapter actually called reader.read().
        { highWaterMark: 0 },
      ),
    );
  });
  const pending = assert.rejects(
    adapter.infer([], { timeoutMs: 123, toolsEnabled: false }),
    failure('timeout'),
  );
  await ready;
  t.mock.timers.tick(123);
  await pending;
  assert.equal(signal?.aborted, true);
  assert.equal(cancelled, true);
});

test('I006-AC-17 invalid timeouts fail before any request', async () => {
  let requests = 0;
  const adapter = new OllamaClassificationLlm(config, async () => {
    requests += 1;
    return response();
  });
  for (const timeoutMs of [0, -1, NaN, Infinity]) {
    await assert.rejects(adapter.infer([], { timeoutMs, toolsEnabled: true }), RangeError);
  }
  assert.equal(requests, 0);
});

test('I006-AC-17 the body shares the request deadline rather than starting a new timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let deliver!: (value: Response) => void;
  let reading!: () => void;
  const bodyRead = new Promise<void>((resolve) => {
    reading = resolve;
  });
  let signal: AbortSignal | null | undefined;
  const adapter = new OllamaClassificationLlm(config, async (_url, options) => {
    signal = options?.signal;
    started();
    return new Promise<Response>((resolve) => {
      deliver = resolve;
    });
  });
  const pending = assert.rejects(
    adapter.infer([], { timeoutMs: 100, toolsEnabled: true }),
    failure('timeout'),
  );
  await requestStarted;
  t.mock.timers.tick(60);
  deliver(
    new Response(
      new ReadableStream(
        {
          pull() {
            reading();
          },
        },
        { highWaterMark: 0 },
      ),
    ),
  );
  await bodyRead;
  t.mock.timers.tick(39);
  assert.equal(signal?.aborted, false);
  t.mock.timers.tick(1);
  await pending;
  assert.equal(signal?.aborted, true);
});

test('I006-AC-17 successful and invalid completed responses clear their timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const signals: AbortSignal[] = [];
  for (const content of ['{"type":"abstention"}', '{']) {
    const adapter = new OllamaClassificationLlm(config, async (_url, options) => {
      assert.ok(options?.signal);
      signals.push(options.signal);
      return response({ role: 'assistant', content });
    });
    if (content === '{') {
      await assert.rejects(
        adapter.infer([], { timeoutMs: 100, toolsEnabled: true }),
        failure('invalid_response'),
      );
    } else {
      await adapter.infer([], { timeoutMs: 100, toolsEnabled: true });
    }
  }

  t.mock.timers.tick(45_000);
  assert.equal(signals.length, 2);
  assert.ok(signals.every((signal) => !signal.aborted));
});
