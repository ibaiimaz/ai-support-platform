import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassificationError } from '../../src/application/classification-errors.js';
import {
  parseToolCallingResponse,
  toOllamaMessages,
} from '../../src/infrastructure/ollama/tool-calling-protocol.js';

function envelope(message: unknown) {
  return JSON.stringify({ done: true, done_reason: 'stop', message, metadata: 'allowed' });
}

function invalidResponse(error: unknown) {
  return error instanceof ClassificationError && error.kind === 'invalid_response';
}

test('I006-AC-17 translates roles and preserves call correlation, order and unknown arguments', () => {
  const messages = toOllamaMessages([
    { role: 'system', content: 'system instructions' },
    { role: 'user', content: 'incident text' },
    { role: 'assistant', content: 'previous answer' },
    {
      role: 'assistant',
      toolCalls: [
        { name: 'getIncidentById', arguments: { incidentId: 'inc-142' }, callId: 'opaque-1' },
        { name: 'unknown', arguments: '{"incidentId":142}' },
      ],
    },
    { role: 'tool', name: 'getIncidentById', content: '{"status":"FOUND"}', callId: 'opaque-1' },
    { role: 'tool', name: 'unknown', content: '{"status":"NOT_FOUND"}' },
  ]);

  assert.deepEqual(messages, [
    { role: 'system', content: 'system instructions' },
    { role: 'user', content: 'incident text' },
    { role: 'assistant', content: 'previous answer' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'opaque-1',
          function: { name: 'getIncidentById', arguments: { incidentId: 'inc-142' } },
        },
        { function: { name: 'unknown', arguments: '{"incidentId":142}' } },
      ],
    },
    {
      role: 'tool',
      tool_name: 'getIncidentById',
      content: '{"status":"FOUND"}',
      tool_call_id: 'opaque-1',
    },
    { role: 'tool', tool_name: 'unknown', content: '{"status":"NOT_FOUND"}' },
  ]);
});

test('I006-AC-17 maps every tool call without filtering, coercion or invented IDs', () => {
  const args = [
    { incidentId: 'inc-142', extra: true },
    null,
    ['INC-142'],
    '{"incidentId":"INC-142"}',
    142,
    false,
  ];
  const calls = args.map((argumentsValue, index) => ({
    function: {
      index,
      name: index === 0 ? 'getIncidentById' : 'unknown',
      arguments: argumentsValue,
    },
    ...(index === 0 ? { id: 'call-1', type: 'function' } : {}),
  }));
  const result = parseToolCallingResponse(
    envelope({ role: 'assistant', content: '', tool_calls: calls }),
  );

  assert.deepEqual(result, {
    type: 'tool_calls',
    calls: args.map((argumentsValue, index) => ({
      name: index === 0 ? 'getIncidentById' : 'unknown',
      arguments: argumentsValue,
      ...(index === 0 ? { callId: 'call-1' } : {}),
    })),
  });
});

test('I006-AC-17 accepts absent or empty tool-call content and preserves an empty request list', () => {
  const calls = [{ function: { name: 'getIncidentById', arguments: {} } }];
  for (const content of [{}, { content: '' }]) {
    assert.deepEqual(
      parseToolCallingResponse(envelope({ role: 'assistant', tool_calls: calls, ...content })),
      {
        type: 'tool_calls',
        calls: [{ name: 'getIncidentById', arguments: {} }],
      },
    );
  }

  assert.deepEqual(parseToolCallingResponse(envelope({ role: 'assistant', tool_calls: [] })), {
    type: 'tool_calls',
    calls: [],
  });
});

test('I006-AC-17 rejects mixed content and malformed tool protocol without selecting a valid subset', () => {
  const valid = { function: { name: 'getIncidentById', arguments: { incidentId: 'INC-142' } } };
  for (const content of ['explanation', ' ', '{"type":"abstention"}', null, 1, {}]) {
    assert.throws(
      () => parseToolCallingResponse(envelope({ role: 'assistant', content, tool_calls: [valid] })),
      invalidResponse,
    );
  }

  for (const toolCalls of [
    null,
    {},
    'calls',
    [null],
    [{}],
    [{ function: null }],
    [{ function: { name: 1, arguments: {} } }],
    [{ function: { name: 'getIncidentById' } }],
    [{ ...valid, id: 1 }],
    [{ ...valid, type: 'other' }],
    [valid, {}],
  ]) {
    assert.throws(
      () =>
        parseToolCallingResponse(
          envelope({ role: 'assistant', content: '', tool_calls: toolCalls }),
        ),
      invalidResponse,
    );
  }
});

test('I006-AC-17 strictly validates both final variants using the shared category definition', () => {
  for (const category of ['BUG', 'FEATURE', 'QUESTION']) {
    assert.deepEqual(
      parseToolCallingResponse(
        envelope({
          role: 'assistant',
          content: JSON.stringify({ type: 'classification', category }),
        }),
      ),
      { type: 'classification', category },
    );
  }

  assert.deepEqual(
    parseToolCallingResponse(envelope({ role: 'assistant', content: ' {"type":"abstention"} ' })),
    { type: 'abstention' },
  );
  for (const content of [
    undefined,
    null,
    1,
    '',
    '{',
    '```json {"type":"abstention"} ```',
    'prefix {"type":"abstention"}',
    '{}',
    'null',
    '[]',
    '{"type":"classification"}',
    '{"type":"classification","category":"bug"}',
    '{"type":"classification","category":"OTHER"}',
    '{"type":"classification","category":1}',
    '{"type":"classification","category":"BUG","extra":1}',
    '{"type":"abstention","category":null}',
    '{"type":"abstention","toolUnavailable":true}',
    '{"type":"tool_calls","calls":[]}',
  ]) {
    assert.throws(
      () => parseToolCallingResponse(envelope({ role: 'assistant', content })),
      invalidResponse,
    );
  }
});

test('I006-AC-17 rejects malformed or incomplete native envelopes', () => {
  const message = { role: 'assistant', content: '{"type":"abstention"}' };
  for (const value of [
    '{',
    'null',
    '[]',
    '{}',
    JSON.stringify({ done: false, done_reason: 'stop', message }),
    JSON.stringify({ done: true, done_reason: 'length', message }),
    JSON.stringify({ done: true, done_reason: 'tool_calls', message }),
    envelope({ ...message, role: 'user' }),
    envelope(null),
  ]) {
    assert.throws(() => parseToolCallingResponse(value), invalidResponse);
  }
});
