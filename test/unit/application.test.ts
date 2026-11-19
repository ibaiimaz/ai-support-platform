import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config.js';
import {
  classifyIncident,
  type ToolCallingDependencies,
} from '../../src/application/classify-incident.js';
import { ClassificationError } from '../../src/application/classification-errors.js';

test('I001-AC-09 configuración válida, valores iniciales e inválidos', () => {
  assert.deepEqual(loadConfig({}), {
    baseUrl: 'http://localhost:11434',
    model: 'llama3.1:8b',
    timeoutMs: 30000,
  });

  assert.deepEqual(
    loadConfig({
      OLLAMA_BASE_URL: 'https://example.com',
      OLLAMA_MODEL: 'other',
      OLLAMA_TIMEOUT_MS: '12',
    }),
    { baseUrl: 'https://example.com', model: 'other', timeoutMs: 12 },
  );

  for (const value of ['', '0', '-1', '1.5', 'abc', '2147483648', 'Infinity']) {
    assert.throws(() => loadConfig({ OLLAMA_TIMEOUT_MS: value }));
  }

  for (const value of ['', 'ftp://example.com', 'localhost']) {
    assert.throws(() => loadConfig({ OLLAMA_BASE_URL: value }));
  }
  assert.throws(() => loadConfig({ OLLAMA_MODEL: '  ' }));
});

test('I001-AC-11 I006-AC-14/24 caso de uso I006 independiente y propagación de errores', async () => {
  let calls = 0;
  const dependencies: ToolCallingDependencies = {
    systemInstructions: 'Classification test instructions',
    classificationInstructions: 'Classification test instructions',
    repository: {
      async getById() {
        assert.fail('A direct classification must not access the repository');
      },
    },
    llm: {
      async infer(messages, options) {
        calls++;
        assert.deepEqual(messages, [
          { role: 'system', content: 'Classification test instructions' },
          { role: 'user', content: 'text' },
        ]);
        assert.equal(options.toolsEnabled, false);
        if (options.toolsEnabled) {
          return { type: 'no_lookup' };
        }
        return { type: 'classification', category: 'FEATURE' };
      },
    },
  };
  assert.deepEqual(await classifyIncident(dependencies, 'text'), {
    status: 'CLASSIFIED',
    category: 'FEATURE',
  });
  assert.equal(calls, 1);
  const error = new ClassificationError('timeout');
  dependencies.llm.infer = async () => {
    throw error;
  };
  await assert.rejects(classifyIncident(dependencies, 'text'), (caught) => caught === error);
});
