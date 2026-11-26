import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { buildApp } from '../../src/http/app.js';
import { classificationFixture } from '../http/application-fixture.js';
import { KnowledgeError, knowledgeErrorKinds } from '../../src/knowledge/domain.js';
import { createKnowledgeDependencies } from '../../src/knowledge/composition.js';
import { dependencies } from './helpers.js';

const url = '/api/v1/knowledge/ask';

function appFor(deps = dependencies()) {
  return buildApp({
    classification: classificationFixture(),
    knowledge: { dependencies: deps, maxQuestionLength: 50 },
  });
}

test('RF-04 contrato ANSWER, abstención HTTP 200 y entrada estricta', async () => {
  const deps = dependencies();
  const app = appFor(deps);
  try {
    const answer = await app.inject({ method: 'POST', url, payload: { question: '¿Plazo?' } });
    assert.equal(answer.statusCode, 200);
    assert.deepEqual(answer.json(), {
      status: 'ANSWER',
      answer: '15 minutos.',
      sources: [
        {
          documentId: 'access',
          versionId: 'v1',
          chunkId: 'c1',
          title: 'Acceso',
          section: 'Bloqueos',
        },
      ],
    });
    deps.generator.generate = async () => ({
      status: 'INSUFFICIENT_CONTEXT',
      answer: null,
      chunkIds: [],
    });
    assert.deepEqual(
      (await app.inject({ method: 'POST', url, payload: { question: 'q' } })).json(),
      { status: 'INSUFFICIENT_CONTEXT', answer: null, sources: [] },
    );
    for (const payload of [
      {},
      { question: '' },
      { question: ' ' },
      { question: 10 },
      { question: 'q', extra: 'x' },
      { question: 'a'.repeat(51) },
    ]) {
      assert.equal((await app.inject({ method: 'POST', url, payload })).statusCode, 400);
    }
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { 'content-type': 'text/plain' },
          payload: 'q',
        })
      ).statusCode,
      415,
    );
  } finally {
    await app.close();
  }
});

test('RF-04 todos los errores técnicos se traducen a 502/503/504 sin detalles internos', async () => {
  for (const kind of knowledgeErrorKinds) {
    const deps = dependencies();
    deps.embeddings = {
      async identity() {
        throw new KnowledgeError(kind);
      },
      async embed() {
        assert.fail();
      },
    };
    const app = appFor(deps);
    try {
      const result = await app.inject({ method: 'POST', url, payload: { question: 'q' } });
      assert.equal(
        result.statusCode,
        kind.endsWith('_TIMEOUT') ? 504 : kind.startsWith('INVALID_') ? 502 : 503,
      );
      assert.deepEqual(Object.keys(result.json().error).sort(), ['code', 'message', 'requestId']);
      assert.ok(!result.body.includes(kind));
    } finally {
      await app.close();
    }
  }
});

test('RF-09 logs por defecto no incluyen pregunta, respuesta, documentos ni errores arbitrarios', async () => {
  const logs: string[] = [];
  const stream = new Writable({
    write(bytes, _encoding, done) {
      logs.push(String(bytes));
      done();
    },
  });
  const deps = dependencies();
  deps.generator.generate = async () => {
    throw new KnowledgeError('GENERATION_UNAVAILABLE');
  };
  const app = buildApp(
    {
      classification: classificationFixture(),
      knowledge: { dependencies: deps, maxQuestionLength: 100 },
    },
    { stream },
  );
  await app.inject({ method: 'POST', url, payload: { question: 'PRIVATE_QUESTION' } });
  await app.close();
  assert.ok(logs.join('').includes('/api/v1/knowledge/ask'));
  assert.ok(!logs.join('').includes('PRIVATE_QUESTION'));
  assert.ok(!logs.join('').includes('15 minutos'));
});

test('RNF-05 construir y cerrar composición no accede a Ollama ni PostgreSQL', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    assert.fail('No network at startup');
  };
  try {
    const composition = createKnowledgeDependencies();
    assert.equal(composition.pool.totalCount, 0);
    await composition.close();
  } finally {
    globalThis.fetch = original;
  }
});

test('RNF-09 ambas rutas coexisten manteniendo el contrato y flujo de clasificación I006', async () => {
  const { createClassificationDependencies } = await import('../../src/composition.js');
  const { loadConfig } = await import('../../src/config.js');
  const classification = createClassificationDependencies(loadConfig());
  let calls = 0;
  classification.llm = {
    async infer(_messages, options) {
      calls++;
      assert.equal(options.toolsEnabled, false);
      return { type: 'classification', category: 'BUG' };
    },
  };
  const app = buildApp({
    classification,
    knowledge: { dependencies: dependencies(), maxQuestionLength: 100 },
  });
  try {
    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/incidents/classify',
      payload: { description: 'El botón dejó de guardar los datos.' },
    });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.json(), { category: 'BUG' });
    assert.equal(calls, 1);
    assert.equal(
      (await app.inject({ method: 'POST', url, payload: { question: '¿Plazo?' } })).json().status,
      'ANSWER',
    );
    assert.equal(calls, 1);
  } finally {
    await app.close();
  }
});
