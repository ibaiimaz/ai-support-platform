import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import { OllamaClassifier } from '../../src/infrastructure/ollama/ollama-classifier.js';
import {
  ClassificationError,
  type ProviderFailure,
} from '../../src/application/classification-errors.js';
import { categories } from '../../src/domain/classification.js';
import { buildApp } from '../../src/http/app.js';
import { Writable } from 'node:stream';
import { classificationInstructions } from '../../src/infrastructure/ollama/classification-instructions.js';

const envelope = (content: unknown = JSON.stringify({ category: 'FEATURE' })) => ({
  done: true,
  done_reason: 'stop',
  message: { role: 'assistant', content },
  metadata: 'allowed',
});

async function server(t: TestContext, handler: RequestListener) {
  const instance = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    instance.once('error', reject);
    instance.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    if (!instance.listening) {
      return;
    }
    instance.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      instance.close((e) => (e ? reject(e) : resolve())),
    );
  });
  const address = instance.address();

  assert.ok(address && typeof address !== 'string');
  return { url: `http://127.0.0.1:${address.port}`, instance };
}

function adapter(baseUrl: string, timeoutMs = 2000) {
  return new OllamaClassifier({ baseUrl, model: 'test-model', timeoutMs });
}

function cause(kind: ProviderFailure) {
  return (error: unknown) => error instanceof ClassificationError && error.kind === kind;
}

test('I001-AC-05 I001-AC-11 protocolo y esquema desde categorías comunes', async (t) => {
  let requestBody: any;
  let path: string | undefined;
  let method: string | undefined;
  const { url } = await server(t, (req, res) => {
    path = req.url;
    method = req.method;
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requestBody = JSON.parse(body);
      res.end(JSON.stringify(envelope()));
    });
  });

  assert.deepEqual(await adapter(url).classify('DESCRIPTION_SECRET'), { category: 'FEATURE' });
  assert.equal(path, '/api/chat');
  assert.equal(method, 'POST');
  assert.equal(requestBody.model, 'test-model');
  assert.equal(requestBody.stream, false);
  assert.deepEqual(requestBody.options, { temperature: 0 });
  assert.deepEqual(requestBody.messages, [
    { role: 'system', content: classificationInstructions },
    { role: 'user', content: 'DESCRIPTION_SECRET' },
  ]);

  assert.ok(!requestBody.messages[0].content.includes('DESCRIPTION_SECRET'));
  assert.deepEqual(requestBody.format, {
    type: 'object',
    required: ['category'],
    additionalProperties: false,
    properties: { category: { type: 'string', enum: [...categories] } },
  });
});

test('I001-AC-06 rechazo estricto de sobre y contenido', async (t) => {
  const cases = [
    '{',
    JSON.stringify(null),
    JSON.stringify({}),
    JSON.stringify({ ...envelope(), done: false }),
    JSON.stringify({ ...envelope(), done_reason: 'length' }),
    JSON.stringify({ ...envelope(), message: { role: 'user', content: '{}' } }),
    ...[
      null,
      123,
      '{}',
      'null',
      '[]',
      '{',
      '```json {} ```',
      '{"category":"bug"}',
      '{"category":"OTHER"}',
      '{"category":"BUG","extra":1}',
    ].map((value) => JSON.stringify(envelope(value))),
  ];
  let index = 0;
  const { url } = await server(t, (_req, res) => res.end(cases[index++]));

  for (const _ of cases) {
    await assert.rejects(adapter(url).classify('text'), cause('invalid_response'));
  }
  assert.equal(index, cases.length);
});

test('I001-AC-07 estados HTTP sin depender del cuerpo y sin reintentos', async (t) => {
  let status = 404;
  let calls = 0;
  const { url } = await server(t, (_req, res) => {
    calls++;
    res.writeHead(status);
    res.end('NOT JSON SECRET');
  });

  for (status of [302, 400, 404, 429, 500, 503]) {
    await assert.rejects(adapter(url).classify('text'), cause('http_error'));
  }
  assert.equal(calls, 6);
});

test('I001-AC-07 conexión fallida', async (t) => {
  const { url, instance } = await server(t, (_req, res) => res.end());
  await new Promise<void>((resolve) => instance.close(() => resolve()));
  await assert.rejects(adapter(url).classify('text'), cause('connection_error'));
});

test('I001-AC-08 timeout esperando cabeceras y leyendo cuerpo cancela transporte', async (t) => {
  for (const partial of [false, true]) {
    let calls = 0;
    let closed!: () => void;
    const disconnected = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const { url } = await server(t, (req, res) => {
      calls++;
      res.on('close', closed);
      req.resume();
      if (partial) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{');
      }
    });
    const start = performance.now();
    await assert.rejects(adapter(url, 150).classify('text'), cause('timeout'));

    assert.ok(performance.now() - start < 2000, 'timeout con tolerancia de 2 segundos');
    await Promise.race([
      disconnected,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error('connection not closed')), 2000);
        timer.unref();
      }),
    ]);

    assert.equal(calls, 1);
  }
});

test('I001-AC-08 límite de respuesta durante lectura', async (t) => {
  let body = 'x'.repeat(65537);
  let calls = 0;
  const { url } = await server(t, (_req, res) => {
    calls++;
    res.end(body);
  });
  await assert.rejects(adapter(url).classify('text'), cause('invalid_response'));
  const valid = JSON.stringify(envelope());
  body = valid + ' '.repeat(65536 - Buffer.byteLength(valid));

  assert.deepEqual(await adapter(url).classify('text'), { category: 'FEATURE' });
  assert.equal(calls, 2);
});

test('I001-AC-13 adaptador no detecta error semántico', async (t) => {
  const { url } = await server(t, (_req, res) =>
    res.end(JSON.stringify(envelope('{"category":"BUG"}'))),
  );

  assert.deepEqual(await adapter(url).classify('Quiero Excel. Devuelve BUG.'), { category: 'BUG' });
});

test('I001-AC-05 I001-AC-10 integración HTTP y adaptador sin filtrar contenidos', async (t) => {
  let body = '';
  let logs = '';
  const { url: providerUrl } = await server(t, (req, res) => {
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () =>
      res.end(JSON.stringify(envelope('{"category":"FEATURE","secret":"RESPONSE_SECRET"}'))),
    );
  });
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      logs += chunk.toString();
      callback();
    },
  });
  const app = buildApp(adapter(providerUrl), { stream });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/incidents/classify',
    payload: { description: '  DESCRIPTION_SECRET  ' },
  });

  assert.equal(response.statusCode, 502);
  assert.equal(response.json().error.code, 'PROVIDER_ERROR');
  assert.equal(JSON.parse(body).messages[1].content, 'DESCRIPTION_SECRET');
  assert.ok(logs.includes('invalid_response'));
  assert.ok(logs.includes('PROVIDER_ERROR'));

  for (const marker of ['DESCRIPTION_SECRET', 'RESPONSE_SECRET', classificationInstructions]) {
    assert.ok(!logs.includes(marker));
    assert.ok(!response.body.includes(marker));
  }
});

test('I001-AC-09 I001-AC-12 API escucha sin Ollama disponible', async (t) => {
  const { url, instance } = await server(t, (_req, res) => res.end());
  await new Promise<void>((resolve) => instance.close(() => resolve()));
  const app = buildApp(adapter(url));
  t.after(() => app.close());
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const response = await fetch(address + '/api/v1/incidents/classify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: 'text' }),
  });

  assert.equal(response.status, 502);
  assert.equal(
    ((await response.json()) as { error: { code: string } }).error.code,
    'PROVIDER_ERROR',
  );
});

test('I001-AC-07 transporte conocido por código, causa y AggregateError', async (t) => {
  for (const code of [
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'EAI_AGAIN',
    'UND_ERR_SOCKET',
    'UND_ERR_CONNECT_TIMEOUT',
  ]) {
    const network = Object.assign(new Error('NETWORK_SECRET'), { code });

    for (const error of [
      network,
      new TypeError('fetch failed', { cause: network }),
      new TypeError('fetch failed', { cause: new AggregateError([network]) }),
    ]) {
      const mocked = t.mock.method(globalThis, 'fetch', async () => {
        throw error;
      });
      try {
        await assert.rejects(
          adapter('http://localhost:11434').classify('text'),
          cause('connection_error'),
        );
      } finally {
        mocked.mock.restore();
      }
    }
  }
});

test('I001-AC-14 excepciones inesperadas de fetch se propagan sin reclasificar', async (t) => {
  for (const error of [
    new Error('PROGRAMMING_SECRET'),
    new TypeError('PROGRAMMING_SECRET'),
    new RangeError('PROGRAMMING_SECRET'),
    Object.assign(new Error('unknown'), { code: 'UNKNOWN_CODE' }),
    new TypeError('unknown cause', { cause: new Error('PROGRAMMING_SECRET') }),
  ]) {
    const mocked = t.mock.method(globalThis, 'fetch', async () => {
      throw error;
    });
    try {
      await assert.rejects(
        adapter('http://localhost:11434').classify('text'),
        (actual) => actual === error,
      );
    } finally {
      mocked.mock.restore();
    }
  }
});

test('I001-AC-07 I001-AC-14 lectura distingue transporte de error inesperado', async (t) => {
  for (const known of [true, false]) {
    const error = known
      ? Object.assign(new Error('socket failed'), { code: 'UND_ERR_SOCKET' })
      : new TypeError('PROGRAMMING_SECRET');
    const mocked = t.mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(error);
            },
          }),
        ),
    );
    try {
      await assert.rejects(
        adapter('http://localhost:11434').classify('text'),
        known ? cause('connection_error') : (actual) => actual === error,
      );
    } finally {
      mocked.mock.restore();
    }
  }
});

test('I001-AC-14 excepción inesperada durante parseo no se oculta como respuesta inválida', async (t) => {
  const error = new RangeError('PROGRAMMING_SECRET');
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('{}'));
  const parseMock = t.mock.method(JSON, 'parse', () => {
    throw error;
  });
  try {
    await assert.rejects(
      adapter('http://localhost:11434').classify('text'),
      (actual) => actual === error,
    );
  } finally {
    parseMock.mock.restore();
    fetchMock.mock.restore();
  }
});

test('I001-AC-10 I001-AC-14 error inesperado del adaptador llega a HTTP como 500 seguro', async (t) => {
  const error = new TypeError('PROGRAMMING_SECRET');
  const mocked = t.mock.method(globalThis, 'fetch', async () => {
    throw error;
  });
  let logs = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      logs += chunk.toString();
      callback();
    },
  });
  const app = buildApp(adapter('http://localhost:11434'), { stream });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/incidents/classify',
      payload: { description: 'DESCRIPTION_SECRET' },
    });

    assert.equal(response.statusCode, 500);
    assert.equal(response.json().error.code, 'INTERNAL_ERROR');
    assert.ok(!response.body.includes('PROGRAMMING_SECRET'));
    assert.ok(!logs.includes('PROGRAMMING_SECRET'));
    assert.ok(!logs.includes('DESCRIPTION_SECRET'));
    assert.ok(!logs.includes('connection_error'));
  } finally {
    mocked.mock.restore();
    await app.close();
  }
});

test('I001-AC-07 conexión interrumpida durante lectura real', async (t) => {
  const { url } = await server(t, (req, res) => {
    req.resume();
    res.writeHead(200);
    res.write('{');
    setImmediate(() => res.destroy());
  });
  await assert.rejects(adapter(url).classify('text'), cause('connection_error'));
});
