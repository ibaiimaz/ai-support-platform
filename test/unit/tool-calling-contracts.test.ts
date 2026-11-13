import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ClassificationLlm,
  LlmMessage,
  LlmResponse,
  ToolCall,
} from '../../src/application/classification-llm.js';
import type { ClassificationResult } from '../../src/application/classification-result.js';
import { classificationTimeouts } from '../../src/application/classification-timeouts.js';
import type { IncidentRepository } from '../../src/application/incident-repository.js';
import type { Incident } from '../../src/domain/incident.js';

// Compiled by tsc, never executed: these checks describe static contracts, not runtime validation.
function checkStaticContracts() {
  const calls: ToolCall[] = [
    { name: 'getIncidentById', arguments: { incidentId: 'INC-142' }, callId: 'call-1' },
    { name: 'unknown', arguments: null },
  ];
  const messages: LlmMessage[] = [
    { role: 'system', content: 'instructions' },
    { role: 'user', content: 'incident' },
    { role: 'assistant', content: 'response' },
    { role: 'assistant', toolCalls: calls },
    { role: 'tool', name: 'getIncidentById', content: '{}', callId: 'call-1' },
    { role: 'tool', name: 'getIncidentById', content: '{}' },
  ];
  const responses: LlmResponse[] = [
    { type: 'classification', category: 'BUG' },
    { type: 'abstention' },
    { type: 'tool_calls', calls },
  ];
  const results: ClassificationResult[] = [
    { status: 'CLASSIFIED', category: 'FEATURE' },
    { status: 'INSUFFICIENT_CONTEXT', category: null, toolUnavailable: false },
    { status: 'INSUFFICIENT_CONTEXT', category: null, toolUnavailable: true },
  ];

  // @ts-expect-error Classification requires an allowed domain category.
  const invalidCategory: LlmResponse = { type: 'classification', category: 'OTHER' };
  // @ts-expect-error A classification response must contain its category.
  const missingCategory: LlmResponse = { type: 'classification' };
  // @ts-expect-error Tool responses require a tool name.
  const unnamedTool: LlmMessage = { role: 'tool', content: '{}' };
  // @ts-expect-error Tool arguments remain unknown until explicitly validated.
  const uncheckedId: string = calls[0]!.arguments.incidentId;
  // @ts-expect-error Abstention requires the internal availability indicator.
  const missingAvailability: ClassificationResult = {
    status: 'INSUFFICIENT_CONTEXT',
    category: null,
  };
  // @ts-expect-error A classified result cannot have a null category.
  const nullClassification: ClassificationResult = { status: 'CLASSIFIED', category: null };
  const classifiedAbstention: ClassificationResult = {
    status: 'INSUFFICIENT_CONTEXT',
    // @ts-expect-error An abstention cannot contain a category prediction.
    category: 'BUG',
    toolUnavailable: false,
  };
  // @ts-expect-error Timeout constants have readonly literal types.
  classificationTimeouts.llmCallMs = 1;

  void [
    messages,
    responses,
    results,
    invalidCategory,
    missingCategory,
    unnamedTool,
    uncheckedId,
    missingAvailability,
    nullClassification,
    classifiedAbstention,
  ];
}

void checkStaticContracts;

test('I006-AC-10 phase 1 timeout constants are independent of historical configuration', () => {
  assert.deepEqual(classificationTimeouts, {
    llmCallMs: 45_000,
    toolCallMs: 5_000,
    overallMs: 90_000,
  });
});

test('I006-AC-17 phase 1 LLM port represents multiple requests and optional correlation', async () => {
  const calls: ToolCall[] = [
    { name: 'getIncidentById', arguments: { incidentId: 'INC-142' }, callId: 'call-1' },
    { name: 'unknown', arguments: 'unvalidated' },
  ];
  const llm: ClassificationLlm = {
    async infer(messages, options) {
      assert.deepEqual(messages, [{ role: 'user', content: 'incident' }]);
      assert.deepEqual(options, { timeoutMs: 45_000, toolsEnabled: true });
      return { type: 'tool_calls', calls };
    },
  };

  assert.deepEqual(
    await llm.infer([{ role: 'user', content: 'incident' }], {
      timeoutMs: classificationTimeouts.llmCallMs,
      toolsEnabled: true,
    }),
    { type: 'tool_calls', calls },
  );
});

test('I006-AC-04/05 phase 1 repository port distinguishes an incident from absence', async () => {
  const incident: Incident = {
    id: 'INC-142',
    title: 'Save failure',
    description: 'Saving an existing report fails.',
    category: 'BUG',
  };
  const repository: IncidentRepository = {
    async getById(id, options) {
      assert.equal(options.timeoutMs, classificationTimeouts.toolCallMs);
      return id === incident.id ? incident : null;
    },
  };

  assert.equal(await repository.getById('INC-142', { timeoutMs: 5_000 }), incident);
  assert.equal(await repository.getById('INC-999', { timeoutMs: 5_000 }), null);
});
