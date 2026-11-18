import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ClassificationError,
  invalidResponseDiagnostics,
  type InvalidResponseDiagnostic,
} from '../../src/application/classification-errors.js';
import { assertLlmResponse } from '../../src/application/classification-response.js';
import { OllamaClassificationLlm } from '../../src/infrastructure/ollama/ollama-classification-llm.js';
import { parseToolCallingResponse } from '../../src/infrastructure/ollama/tool-calling-protocol.js';
import { runEvaluation } from '../../src/evaluation/tool-calling/run.js';
import { buildReport, saveReport } from '../../src/evaluation/tool-calling/report.js';
import { buildApp } from '../../src/http/app.js';
import { candidate, identity } from '../tool-calling-evaluation/helpers.js';

const secret = 'PRIVATE_MODEL_TEXT';
const message = { role: 'assistant', content: '{"type":"abstention"}' };
const envelope = (value: unknown) =>
  JSON.stringify({ done: true, done_reason: 'stop', message: value });
const rejectedResponses: [InvalidResponseDiagnostic, string[]][] = [
  ['ENVELOPE_JSON_INVALID', [secret]],
  [
    'ENVELOPE_INVALID',
    ['null', '[]', '{}', envelope({ ...message, role: 'user' }), envelope(null)],
  ],
  [
    'TERMINATION_INVALID',
    [
      JSON.stringify({ done: false, done_reason: 'stop', message }),
      JSON.stringify({ done: true, message }),
      JSON.stringify({ done: true, done_reason: 'length', message }),
    ],
  ],
  ['MIXED_CONTENT_AND_TOOLS', [envelope({ ...message, tool_calls: [] })]],
  [
    'TOOL_CALL_STRUCTURE_INVALID',
    [
      envelope({ role: 'assistant', tool_calls: null }),
      envelope({ role: 'assistant', tool_calls: [{}] }),
      envelope({ role: 'assistant', tool_calls: [{ function: { name: 'getIncidentById' } }] }),
    ],
  ],
  [
    'FINAL_CONTENT_INVALID',
    [envelope({ role: 'assistant' }), envelope({ role: 'assistant', content: null })],
  ],
  ['FINAL_JSON_INVALID', [envelope({ ...message, content: secret })]],
  ['FINAL_SCHEMA_INVALID', [envelope({ ...message, content: JSON.stringify({ type: secret }) })]],
];

for (const [diagnostic, responses] of rejectedResponses) {
  test(`I006 technical diagnostics: ${diagnostic} preserves invalid_response without content`, () => {
    for (const response of responses) {
      assert.throws(
        () => parseToolCallingResponse(response),
        (error) => {
          assert.ok(error instanceof ClassificationError);
          assert.equal(error.kind, 'invalid_response');
          assert.equal(error.diagnostic, diagnostic);
          assert.equal(error.message, 'Classification provider failed');
          assert.equal(JSON.stringify(error).includes(secret), false);
          assert.equal(error.cause, undefined);
          return true;
        },
      );
    }
  });
}

for (const [diagnostic, response] of [
  ['RESPONSE_BODY_MISSING', () => new Response(null)],
  ['RESPONSE_TOO_LARGE', () => new Response('x'.repeat(65_537))],
] as const) {
  test(`I006 technical diagnostics: ${diagnostic} has one simulated request and no retry`, async () => {
    let requests = 0;
    const adapter = new OllamaClassificationLlm(
      { baseUrl: 'http://invalid.test', model: 'simulated' },
      async () => {
        requests++;
        return response();
      },
    );
    await assert.rejects(adapter.infer([], { timeoutMs: 45_000, toolsEnabled: true }), (error) => {
      assert.ok(error instanceof ClassificationError);
      assert.equal(error.kind, 'invalid_response');
      assert.equal(error.diagnostic, diagnostic);
      return true;
    });
    assert.equal(requests, 1);
  });
}

test('I006 technical diagnostics: internal contract failures have a safe diagnostic', () => {
  for (const value of [
    null,
    {},
    { type: 'classification', category: secret },
    { type: 'abstention', extra: secret },
    { type: 'tool_calls', calls: [{}] },
  ]) {
    assert.throws(
      () => assertLlmResponse(value),
      (error) => {
        assert.ok(error instanceof ClassificationError);
        assert.equal(error.kind, 'invalid_response');
        assert.equal(error.diagnostic, 'INTERNAL_RESPONSE_INVALID');
        return true;
      },
    );
  }
});

test('I006 technical diagnostics: allowlisted codes reach persisted reports; legacy errors remain accepted', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'i006-diagnostics-'));
  try {
    const dataset = await candidate();
    const forged = new ClassificationError('invalid_response');
    Object.assign(forged, { diagnostic: secret, message: secret, raw: secret });
    const failures = [
      ...invalidResponseDiagnostics.map(
        (diagnostic) => new ClassificationError('invalid_response', diagnostic),
      ),
      new ClassificationError('invalid_response'),
      new ClassificationError('timeout'),
      forged,
    ];
    for (const failure of failures) {
      let requests = 0;
      const results = await runEvaluation(
        dataset,
        {
          systemInstructions: secret,
          classificationInstructions: secret,
          llm: {
            async infer() {
              requests++;
              throw failure;
            },
          },
          repository: {
            async getById() {
              assert.fail('Repository must not be called');
            },
          },
        },
        { async reserve() {}, async record() {} },
      );
      assert.equal(requests, 1);
      assert.equal(results.length, 1);
      assert.equal(results[0]!.error, failure.kind);
      if (failure === forged || failure.diagnostic === undefined) {
        assert.equal(Object.hasOwn(results[0]!, 'diagnostic'), false);
      } else {
        assert.equal(results[0]!.diagnostic, failure.diagnostic);
      }
      const report = buildReport(dataset, identity, results, new Date().toISOString());
      const path = await saveReport(directory, report);
      const bytes = await readFile(path, 'utf8');
      assert.equal(bytes.includes(secret), false);
      assert.deepEqual(JSON.parse(bytes).results, results);
      assert.equal(report.status, 'INCOMPLETE');
      assert.equal(report.metrics.technicalErrors, 1);
      for (const diagnostic of [secret, null, 'FINAL_SCHEMA_INVALID']) {
        const unsafe = structuredClone(results);
        Object.assign(unsafe[0]!, { diagnostic });
        if (diagnostic === 'FINAL_SCHEMA_INVALID') {
          unsafe[0]!.error = 'timeout';
        }
        assert.throws(() => buildReport(dataset, identity, unsafe, new Date().toISOString()));
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('I006 technical diagnostics: HTTP remains generic and other provider failures have no diagnostic', async (t) => {
  assert.equal(new ClassificationError('timeout', 'FINAL_SCHEMA_INVALID').diagnostic, undefined);
  const app = buildApp({
    systemInstructions: secret,
    classificationInstructions: secret,
    llm: {
      async infer() {
        throw new ClassificationError('invalid_response', 'FINAL_SCHEMA_INVALID');
      },
    },
    repository: {
      async getById() {
        assert.fail('Repository must not be called');
      },
    },
  });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/incidents/classify',
    payload: { description: secret },
  });
  assert.equal(response.statusCode, 502);
  const body = response.json();
  assert.equal(typeof body.error.requestId, 'string');
  assert.deepEqual(body, {
    error: {
      code: 'PROVIDER_ERROR',
      message: 'No se pudo completar la clasificación.',
      requestId: body.error.requestId,
    },
  });
  assert.equal(response.body.includes('FINAL_SCHEMA_INVALID'), false);
  assert.equal(response.body.includes(secret), false);
});
