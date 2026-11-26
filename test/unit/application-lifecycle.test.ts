import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';
import { buildApp, type ApplicationDependencies } from '../../src/http/app.js';
import {
  createApplicationDependencies,
  createClassificationDependencies,
} from '../../src/composition.js';
import { createKnowledgeDependencies } from '../../src/knowledge/composition.js';
import { loadConfig } from '../../src/config.js';
import { loadRagConfig } from '../../src/knowledge/config.js';
import { startApplication } from '../../src/main.js';
import { classificationFixture } from '../http/application-fixture.js';
import { dependencies } from '../knowledge/helpers.js';

function fixture() {
  let closures = 0;
  let prepared = 0;
  const classification = classificationFixture();
  classification.llm.infer = async () => ({ type: 'classification', category: 'BUG' });
  const knowledge = createKnowledgeDependencies(loadRagConfig({}));
  const close = knowledge.close;
  knowledge.close = () => {
    closures++;
    return close();
  };
  const compose = () =>
    createApplicationDependencies(loadConfig({}), loadRagConfig({}), {
      classification() {
        prepared++;
        return classification;
      },
      knowledge() {
        return knowledge;
      },
    });
  return { compose, knowledge, classification, counts: () => ({ closures, prepared }) };
}

function simulatedListen(app: ReturnType<typeof buildApp>, fail = false) {
  Object.defineProperty(app, 'listen', {
    value: async (options: unknown) => {
      assert.deepEqual(options, { host: '127.0.0.1', port: 3000 });
      await app.ready();
      if (fail) {
        throw new Error('Synthetic bind failure');
      }
      return 'http://127.0.0.1:3000';
    },
  });
  return app;
}

test('RT-002 buildApp exige ambas capacidades y registra sus rutas sin efectos de construcción', async () => {
  let classifications = 0;
  const classification = classificationFixture();
  classification.llm.infer = async () => {
    classifications++;
    return { type: 'classification', category: 'BUG' };
  };
  let generations = 0;
  const knowledge = dependencies();
  knowledge.generator.generate = async () => {
    generations++;
    return { status: 'ANSWER', answer: '15 minutos.', chunkIds: ['c1'] };
  };
  const all: ApplicationDependencies = {
    classification,
    knowledge: { dependencies: knowledge, maxQuestionLength: 100 },
  };

  function typeContract() {
    // @ts-expect-error Both capabilities are mandatory; no classification-only overload.
    buildApp(classification);
  }

  void typeContract;
  const app = buildApp(all);
  assert.equal(classifications, 0);
  assert.equal(generations, 0);
  try {
    const classified = await app.inject({
      method: 'POST',
      url: '/api/v1/incidents/classify',
      payload: { description: 'El botón no guarda.' },
    });
    assert.equal(classified.statusCode, 200);
    assert.deepEqual(classified.json(), { category: 'BUG' });
    assert.equal(generations, 0);
    const answered = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge/ask',
      payload: { question: '¿Plazo?' },
    });
    assert.equal(answered.statusCode, 200);
    assert.equal(answered.json().status, 'ANSWER');
    assert.equal(classifications, 1);
    assert.equal(generations, 1);
  } finally {
    await app.close();
  }
});

test('RT-002 composición central y factoría independiente no conectan ni infieren; cierre concurrente único', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('No inference at construction'));
  t.mock.method(Pool.prototype, 'connect', () => assert.fail('No DB connection at construction'));
  const application = await createApplicationDependencies(loadConfig({}), loadRagConfig({}));
  assert.equal(application.dependencies.knowledge.maxQuestionLength, 2000);
  const first = application.close();
  assert.equal(application.close(), first);
  await Promise.all([first, application.close()]);
  const knowledge = createKnowledgeDependencies(loadRagConfig({}));
  let ends = 0;
  Object.defineProperty(knowledge.pool, 'end', {
    value: async () => {
      ends++;
    },
  });
  const closing = knowledge.close();
  assert.equal(knowledge.close(), closing);
  await Promise.all([closing, knowledge.close()]);
  assert.equal(ends, 1);
});

test('RT-002 composición parcial libera knowledge cuando falla preparar clasificación', async () => {
  const f = fixture();
  await assert.rejects(
    createApplicationDependencies(loadConfig({}), loadRagConfig({}), {
      knowledge: () => f.knowledge,
      classification() {
        throw new Error('Synthetic classification preparation failure');
      },
    }),
    /Synthetic classification preparation failure/,
  );
  assert.deepEqual(f.counts(), { closures: 1, prepared: 0 });
  let classifications = 0;
  await assert.rejects(
    createApplicationDependencies(loadConfig({}), loadRagConfig({}), {
      knowledge() {
        throw new Error('Synthetic knowledge preparation failure');
      },
      classification(config) {
        classifications++;
        return createClassificationDependencies(config);
      },
    }),
    /Synthetic knowledge preparation failure/,
  );
  assert.equal(classifications, 0);
  let builds = 0;
  await assert.rejects(
    startApplication(
      async () => {
        throw new Error('Composition rejected');
      },
      () => {
        builds++;
        throw new Error('Unexpected app construction');
      },
    ),
    /Composition rejected/,
  );
  assert.equal(builds, 0);
});

test('RT-002 main libera recursos ante fallo de buildApp, preparación y listen', async () => {
  for (const phase of ['build', 'ready', 'listen'] as const) {
    const f = fixture();
    const beforeTerm = process.listenerCount('SIGTERM');
    const beforeInt = process.listenerCount('SIGINT');
    await assert.rejects(
      startApplication(f.compose, (all, logger) => {
        assert.equal(all.classification, f.classification);
        assert.equal(all.knowledge.dependencies, f.knowledge.dependencies);
        assert.equal(logger, true);
        if (phase === 'build') {
          throw new Error('Synthetic build failure');
        }
        const app = simulatedListen(buildApp(all, false), phase === 'listen');
        if (phase === 'ready') {
          app.addHook('onReady', async () => {
            throw new Error('Synthetic ready failure');
          });
        }
        return app;
      }),
      /Synthetic/,
    );
    assert.equal(f.counts().closures, 1);
    assert.equal(process.listenerCount('SIGTERM'), beforeTerm);
    assert.equal(process.listenerCount('SIGINT'), beforeInt);
  }
});

test('RT-002 cierre ordinario, repetido y por señal elimina listeners y libera una vez', async () => {
  for (const signal of [null, 'SIGTERM', 'SIGINT'] as const) {
    const f = fixture();
    const beforeTerm = process.listeners('SIGTERM');
    const beforeInt = process.listeners('SIGINT');
    const app = await startApplication(f.compose, (all) => simulatedListen(buildApp(all)));
    assert.equal(f.counts().closures, 0);
    if (signal) {
      const previous = signal === 'SIGTERM' ? beforeTerm : beforeInt;
      const handler = process.listeners(signal).find((listener) => !previous.includes(listener));
      assert.ok(handler);
      handler(signal);
    }
    await Promise.all([app.close(), app.close()]);
    await app.close();
    assert.equal(f.counts().closures, 1);
    assert.deepEqual(process.listeners('SIGTERM'), beforeTerm);
    assert.deepEqual(process.listeners('SIGINT'), beforeInt);
  }
});

test('RT-002 main intenta liberar recursos aunque falle cerrar la aplicación tras error de listen', async () => {
  const f = fixture();
  await assert.rejects(
    startApplication(f.compose, (all) => {
      const app = simulatedListen(buildApp(all), true);
      const close = app.close.bind(app);
      Object.defineProperty(app, 'close', {
        value: async () => {
          await close();
          throw new Error('Synthetic close failure');
        },
      });
      return app;
    }),
    /Synthetic close failure/,
  );
  assert.equal(f.counts().closures, 1);
});

test('RT-002 CLI administrativa y evaluador no dependen de HTTP ni de la composición global', async () => {
  const config = JSON.parse(await readFile('tsconfig.json', 'utf8'));
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, process.cwd());
  const program = ts.createProgram(
    [resolve('src/knowledge/cli.ts'), resolve('src/evaluation/knowledge/main.ts')],
    parsed.options,
  );
  for (const file of program.getSourceFiles()) {
    const path = resolve(file.fileName);
    assert.ok(!path.startsWith(resolve('src/http') + '/'), path);
    assert.notEqual(path, resolve('src/main.ts'));
    assert.notEqual(path, resolve('src/composition.ts'));
  }
});

test('RT-002 fallo al liberar el pool queda ligado a una única promesa, sin reintentos ocultos', async () => {
  const knowledge = createKnowledgeDependencies(loadRagConfig({}));
  let ends = 0;
  Object.defineProperty(knowledge.pool, 'end', {
    value: async () => {
      ends++;
      throw new Error('Synthetic pool end failure');
    },
  });
  const first = knowledge.close();
  assert.equal(knowledge.close(), first);
  await assert.rejects(first, /Synthetic pool end failure/);
  await assert.rejects(knowledge.close(), /Synthetic pool end failure/);
  assert.equal(ends, 1);
});

test('RT-002 main usa por defecto la composición central con ambas capacidades sin inferir', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('No inference at startup'));
  t.mock.method(Pool.prototype, 'connect', () => assert.fail('No DB connection at startup'));
  let built = 0;
  const app = await startApplication(undefined, (all, logger) => {
    built++;
    assert.ok(all.classification.llm);
    assert.ok(all.classification.repository);
    assert.ok(all.knowledge.dependencies.generator);
    assert.ok(all.knowledge.dependencies.embeddings);
    assert.equal(all.knowledge.maxQuestionLength, loadRagConfig().maxQuestionLength);
    assert.equal(logger, true);
    return simulatedListen(buildApp(all));
  });
  try {
    assert.equal(built, 1);
  } finally {
    await app.close();
  }
});
