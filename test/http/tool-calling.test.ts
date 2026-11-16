import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { buildApp } from '../../src/http/app.js';
import type { ToolCallingDependencies } from '../../src/application/classify-incident.js';
import type { LlmResponse } from '../../src/application/classification-llm.js';
import type { IncidentRepository } from '../../src/application/incident-repository.js';
import { ClassificationError } from '../../src/application/classification-errors.js';
import {
  GlobalDeadlineExceededError,
  InvalidToolCallError,
} from '../../src/application/tool-calling-errors.js';
import { SyntheticIncidentRepository } from '../../src/infrastructure/incidents/synthetic-incident-repository.js';

const url = '/api/v1/incidents/classify';

function fixture(
  responses: readonly unknown[],
  repository: IncidentRepository = new SyntheticIncidentRepository(),
) {
  let inferences = 0;
  let queries = 0;
  const dependencies: ToolCallingDependencies = {
    systemInstructions: 'PROMPT_SECRET',
    llm: {
      async infer() {
        const response = responses[inferences++];
        if (response instanceof Error) {
          throw response;
        }

        return response as LlmResponse;
      },
    },
    repository: {
      async getById(id, options) {
        queries += 1;
        return repository.getById(id, options);
      },
    },
  };
  return { dependencies, counts: () => ({ inferences, queries }) };
}

function assertError(body: unknown, code: string, message: string) {
  assert.ok(typeof body === 'object' && body !== null && 'error' in body);
  const error = body.error as Record<string, unknown>;
  assert.equal(typeof error.requestId, 'string');
  assert.ok((error.requestId as string).length > 0);
  assert.deepEqual(body, { error: { code, message, requestId: error.requestId } });
}

// The HTTP factory must not regain a historical classifier overload.
function checkHttpContract() {
  // @ts-expect-error HTTP requires the I006 dependencies, not IncidentClassifier.
  buildApp({ classify: async () => ({ category: 'BUG' }) });
}

void checkHttpContract;

test('I006-AC-15/16/25 direct abstention is 422 with the exact public error envelope', async (t) => {
  const state = fixture([{ type: 'abstention' }]);
  const app = buildApp(state.dependencies);
  t.after(() => app.close());
  const result = await app.inject({
    method: 'POST',
    url,
    payload: { description: 'DESCRIPTION_SECRET' },
  });
  assert.equal(result.statusCode, 422);
  assertError(
    result.json(),
    'INSUFFICIENT_CONTEXT',
    'No hay contexto suficiente para clasificar la incidencia.',
  );
  assert.deepEqual(state.counts(), { inferences: 1, queries: 0 });
});

for (const scenario of [
  {
    name: 'NOT_FOUND + classification',
    id: 'INC-999',
    unavailable: false,
    abstention: false,
    status: 200,
  },
  {
    name: 'NOT_FOUND + abstention',
    id: 'INC-999',
    unavailable: false,
    abstention: true,
    status: 422,
  },
  {
    name: 'UNAVAILABLE + classification',
    id: 'INC-142',
    unavailable: true,
    abstention: false,
    status: 200,
  },
  {
    name: 'UNAVAILABLE + abstention',
    id: 'INC-142',
    unavailable: true,
    abstention: true,
    status: 503,
  },
]) {
  test(`I006-AC-05/06/15/25 ${scenario.name} maps the final use-case result to ${scenario.status}`, async (t) => {
    const state = fixture(
      [
        {
          type: 'tool_calls',
          calls: [{ name: 'getIncidentById', arguments: { incidentId: scenario.id } }],
        },
        scenario.abstention
          ? { type: 'abstention' }
          : { type: 'classification', category: 'FEATURE' },
      ],
      new SyntheticIncidentRepository({
        unavailableIds: scenario.unavailable ? [scenario.id] : [],
      }),
    );
    const app = buildApp(state.dependencies);
    t.after(() => app.close());
    const result = await app.inject({
      method: 'POST',
      url,
      payload: { description: `Me pasa lo mismo que en ${scenario.id}` },
    });
    assert.equal(result.statusCode, scenario.status);
    if (scenario.status === 200) {
      assert.deepEqual(result.json(), { category: 'FEATURE' });
    } else if (scenario.status === 422) {
      assertError(
        result.json(),
        'INSUFFICIENT_CONTEXT',
        'No hay contexto suficiente para clasificar la incidencia.',
      );
    } else {
      assertError(
        result.json(),
        'CLASSIFICATION_UNAVAILABLE',
        'No se pudo completar la clasificación.',
      );
    }

    assert.deepEqual(state.counts(), { inferences: 2, queries: 1 });
  });
}

test('I006-AC-04/15/25 FOUND supplies context but the final LLM category determines the public result', async (t) => {
  const state = fixture([
    {
      type: 'tool_calls',
      calls: [{ name: 'getIncidentById', arguments: { incidentId: 'inc-142' }, callId: 'call-1' }],
    },
    { type: 'classification', category: 'QUESTION' },
  ]);
  const app = buildApp(state.dependencies);
  t.after(() => app.close());
  const result = await app.inject({
    method: 'POST',
    url,
    payload: { description: 'DESCRIPTION_SECRET' },
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.json(), { category: 'QUESTION' });
  assert.deepEqual(state.counts(), { inferences: 2, queries: 1 });
});

test('I006-AC-08/09/15 malformed and prohibited requests become generic 502 without recovery', async (t) => {
  const call = { name: 'getIncidentById', arguments: { incidentId: 'INC-142' } };
  for (const response of [
    { type: 'tool_calls', calls: [] },
    { type: 'tool_calls', calls: [call, call] },
    {
      type: 'tool_calls',
      calls: [{ name: 'ARGUMENT_SECRET', arguments: { incidentId: 'INC-142' } }],
    },
    { type: 'tool_calls', calls: [{ ...call, arguments: { incidentId: 'ARGUMENT_SECRET' } }] },
    { type: 'tool_calls', calls: [{}] },
    { type: 'classification', category: 'BUG', extra: 'RAW_RESPONSE_SECRET' },
  ]) {
    const state = fixture([response]);
    const app = buildApp(state.dependencies);
    t.after(() => app.close());
    const result = await app.inject({
      method: 'POST',
      url,
      payload: { description: 'DESCRIPTION_SECRET' },
    });
    assert.equal(result.statusCode, 502);
    assertError(result.json(), 'PROVIDER_ERROR', 'No se pudo completar la clasificación.');
    assert.deepEqual(state.counts(), { inferences: 1, queries: 0 });
  }

  const state = fixture([
    { type: 'tool_calls', calls: [call] },
    { type: 'tool_calls', calls: [call] },
  ]);
  const app = buildApp(state.dependencies);
  t.after(() => app.close());
  const result = await app.inject({ method: 'POST', url, payload: { description: 'incident' } });
  assert.equal(result.statusCode, 502);
  assertError(result.json(), 'PROVIDER_ERROR', 'No se pudo completar la clasificación.');
  assert.deepEqual(state.counts(), { inferences: 2, queries: 1 });
});

test('I006-AC-10/15 actual global exhaustion in orchestration maps to generic 502', async (t) => {
  let time = 0;
  const state = fixture([]);
  state.dependencies.now = () => time;
  state.dependencies.llm.infer = async () => {
    time = 90_000;
    return { type: 'abstention' };
  };
  const app = buildApp(state.dependencies);
  t.after(() => app.close());
  const result = await app.inject({
    method: 'POST',
    url,
    payload: { description: 'DESCRIPTION_SECRET' },
  });
  assert.equal(result.statusCode, 502);
  assertError(result.json(), 'PROVIDER_ERROR', 'No se pudo completar la clasificación.');
  assert.equal(state.counts().queries, 0);
});

test('I006-AC-15/16 errors and logs never expose prompts, tool data, arbitrary exception details or raw output', async (t) => {
  const errors = [
    new ClassificationError('timeout'),
    new ClassificationError('connection_error'),
    new ClassificationError('http_error'),
    new ClassificationError('invalid_response'),
    new InvalidToolCallError(),
    new GlobalDeadlineExceededError(),
    new TypeError('ERROR_SECRET'),
  ];
  for (const error of errors) {
    error.message = 'ERROR_SECRET RAW_RESPONSE_SECRET';
    error.stack = 'STACK_SECRET';
    error.cause = new Error('CAUSE_SECRET');
    let logs = '';
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        logs += chunk.toString();
        callback();
      },
    });
    const state = fixture(
      [
        {
          type: 'tool_calls',
          calls: [
            {
              name: 'getIncidentById',
              arguments: { incidentId: 'INC-142' },
              callId: 'ARGUMENT_SECRET',
            },
          ],
        },
        error,
      ],
      {
        async getById() {
          return {
            id: 'INC-142',
            title: 'TITLE_SECRET',
            description: 'TOOL_DATA_SECRET',
            category: 'BUG',
          };
        },
      },
    );
    const app = buildApp(state.dependencies, { stream });
    t.after(() => app.close());
    const result = await app.inject({
      method: 'POST',
      url,
      payload: { description: 'DESCRIPTION_SECRET' },
    });
    assert.equal(result.statusCode, error instanceof TypeError ? 500 : 502);
    assertError(
      result.json(),
      error instanceof TypeError ? 'INTERNAL_ERROR' : 'PROVIDER_ERROR',
      error instanceof TypeError ? 'Error interno.' : 'No se pudo completar la clasificación.',
    );
    await app.inject('/UNKNOWN_PATH_SECRET?token=QUERY_SECRET');
    await app.inject({
      method: 'POST',
      url,
      payload: '{INVALID_JSON_SECRET',
      headers: { 'content-type': 'application/json' },
    });
    assert.ok(logs.includes('Request completed'));
    for (const marker of [
      'PROMPT_SECRET',
      'DESCRIPTION_SECRET',
      'ARGUMENT_SECRET',
      'TITLE_SECRET',
      'TOOL_DATA_SECRET',
      'RAW_RESPONSE_SECRET',
      'ERROR_SECRET',
      'STACK_SECRET',
      'CAUSE_SECRET',
      'UNKNOWN_PATH_SECRET',
      'QUERY_SECRET',
      'INVALID_JSON_SECRET',
    ]) {
      assert.ok(!result.body.includes(marker), marker);
      assert.ok(!logs.includes(marker), marker);
    }
  }
});

test('I006-AC-15 unexpected repository errors become safe 500 instead of semantic abstention', async (t) => {
  const state = fixture(
    [
      {
        type: 'tool_calls',
        calls: [{ name: 'getIncidentById', arguments: { incidentId: 'INC-142' } }],
      },
    ],
    {
      async getById() {
        throw new TypeError('REPOSITORY_SECRET');
      },
    },
  );
  const app = buildApp(state.dependencies);
  t.after(() => app.close());
  const result = await app.inject({ method: 'POST', url, payload: { description: 'incident' } });
  assert.equal(result.statusCode, 500);
  assertError(result.json(), 'INTERNAL_ERROR', 'Error interno.');
  assert.deepEqual(state.counts(), { inferences: 1, queries: 1 });
});
