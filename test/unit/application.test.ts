import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config.js';
import { classifyIncident } from '../../src/application/classify-incident.js';
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

test('I001-AC-11 caso de uso independiente y propagación de errores', async () => {
  assert.deepEqual(
    await classifyIncident(
      {
        async classify(description) {
          assert.equal(description, 'text');
          return { category: 'FEATURE' };
        },
      },
      'text',
    ),
    { category: 'FEATURE' },
  );
  const error = new ClassificationError('timeout');
  await assert.rejects(
    classifyIncident(
      {
        async classify() {
          throw error;
        },
      },
      'text',
    ),
    (e) => e === error,
  );
});
