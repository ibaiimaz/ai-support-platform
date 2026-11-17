import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LlmMessage, LlmResponse } from '../../src/application/classification-llm.js';
import { ClassificationError } from '../../src/application/classification-errors.js';
import { toolCallingInstructions } from '../../src/infrastructure/ollama/tool-calling-instructions.js';
import { runEvaluation } from '../../src/evaluation/tool-calling/run.js';
import type { CaseResult } from '../../src/evaluation/tool-calling/types.js';
import { main } from '../../src/evaluation/tool-calling/main.js';
import { candidate } from './helpers.js';

const call = (id: string): LlmResponse => ({
  type: 'tool_calls',
  calls: [{ name: 'getIncidentById', arguments: { incidentId: id }, callId: 'test-correlation' }],
});

async function scripted(responses: (LlmResponse | Error)[], index = 20) {
  const dataset = await candidate();
  dataset.examples = [dataset.examples[index]!];
  let calls = 0;
  const results = await runEvaluation(
    dataset,
    {
      llm: {
        async infer() {
          const response = responses[calls++];
          if (response instanceof Error) {
            throw response;
          }
          assert.ok(response);
          return response;
        },
      },
      repository: {
        async getById() {
          throw new Error('Production repository must not be used');
        },
      },
      systemInstructions: toolCallingInstructions,
    },
    { async reserve() {}, async record() {} },
  );
  return { result: results[0]!, calls };
}

test('AC-19/20: valid wrong ID is executed but tool decision is incorrect', async () => {
  const { result } = await scripted([call('INC-999'), { type: 'classification', category: 'BUG' }]);
  assert.equal(result.observation.toolRequested, true);
  assert.equal(result.observation.toolRequestValid, true);
  assert.equal(result.observation.toolExecuted, true);
  assert.equal(result.observation.toolOutcome, 'NOT_FOUND');
  assert.equal(result.observation.toolDecisionCorrect, false);
});

test('AC-19/20: empty, unknown, invalid and multiple requests are rejected before repository access', async () => {
  for (const response of [
    { type: 'tool_calls', calls: [] },
    { type: 'tool_calls', calls: [{ name: 'unknown', arguments: {} }] },
    {
      type: 'tool_calls',
      calls: [{ name: 'getIncidentById', arguments: { incidentId: 'INC-01' } }],
    },
    {
      type: 'tool_calls',
      calls: [{ name: 'getIncidentById', arguments: { incidentId: 'INC-4401', extra: true } }],
    },
    {
      type: 'tool_calls',
      calls: [
        { name: 'getIncidentById', arguments: { incidentId: 'INC-4401' } },
        { name: 'getIncidentById', arguments: { incidentId: 'INC-4401' } },
      ],
    },
  ] satisfies LlmResponse[]) {
    const { result, calls } = await scripted([response]);
    assert.equal(calls, 1);
    assert.equal(result.outcome, 'POLICY_VIOLATION');
    assert.equal(result.final, null);
    assert.equal(result.observation.toolRequested, true);
    assert.equal(result.observation.toolRequestValid, false);
    assert.equal(result.observation.toolExecuted, false);
    assert.equal(result.observation.toolDecisionCorrect, false);
  }
});

test('AC-19/20: additional request preserves first execution but invalidates the case decision', async () => {
  const { result, calls } = await scripted([call('INC-4401'), call('INC-4402')]);
  assert.equal(calls, 2);
  assert.equal(result.observation.executionCount, 1);
  assert.equal(result.observation.toolRequestValid, false);
  assert.equal(result.observation.requestCount, 2);
  assert.equal(result.observation.toolDecisionCorrect, false);
});

test('AC-21: any technical failure stops subsequent cases and records sanitized unobservable request', async () => {
  for (const cause of [
    new ClassificationError('timeout'),
    new ClassificationError('invalid_response'),
    new Error('private-text'),
  ]) {
    const dataset = await candidate();
    let calls = 0;
    const saved: CaseResult[] = [];
    const results = await runEvaluation(
      dataset,
      {
        llm: {
          async infer() {
            calls++;
            throw cause;
          },
        },
        repository: {
          async getById() {
            return null;
          },
        },
        systemInstructions: toolCallingInstructions,
      },
      {
        async reserve() {},
        async record(result) {
          saved.push(result);
        },
      },
    );
    assert.equal(calls, 1);
    assert.equal(results.length, 1);
    assert.deepEqual(saved, results);
    assert.equal(results[0]!.observation.toolRequested, null);
    assert.equal(results[0]!.observation.toolDecisionCorrect, null);
    assert.equal(JSON.stringify(results).includes('private-text'), false);
  }
});

test('AC-21: planned UNAVAILABLE is evaluable and proceeds to the second inference', async () => {
  const { result, calls } = await scripted([call('INC-4606'), { type: 'abstention' }], 45);
  assert.equal(calls, 2);
  assert.equal(result.outcome, 'COMPLETED');
  assert.equal(result.observation.toolOutcome, 'UNAVAILABLE');
  assert.deepEqual(result.final, {
    status: 'INSUFFICIENT_CONTEXT',
    category: null,
    toolUnavailable: true,
  });
});

test('AC-19/22/26: real orchestration runs 60 simulated cases sequentially without leaking ground truth', async () => {
  const dataset = await candidate();
  let current = dataset.examples[0]!;
  let active = false;
  let calls = 0;
  const seen: string[] = [];
  const messagesSeen: LlmMessage[][] = [];
  const results = await runEvaluation(
    dataset,
    {
      llm: {
        async infer(messages, options) {
          assert.equal(active, false);
          active = true;
          calls++;
          messagesSeen.push(structuredClone(messages));
          assert.deepEqual(messages.slice(0, 2), [
            { role: 'system', content: toolCallingInstructions },
            { role: 'user', content: current.description },
          ]);
          assert.ok(options.timeoutMs <= 45000 && options.timeoutMs > 0);
          active = false;
          if (options.toolsEnabled && current.expectedTool) {
            return call(current.expectedTool.incidentId);
          }
          return current.expectedFinal.status === 'CLASSIFIED'
            ? { type: 'classification', category: current.expectedFinal.category }
            : { type: 'abstention' };
        },
      },
      repository: {
        async getById() {
          throw new Error('Must use fixture');
        },
      },
      systemInstructions: toolCallingInstructions,
    },
    {
      async reserve(example) {
        current = example;
        seen.push(example.id);
      },
      async record(result) {
        assert.equal(result.id, current.id);
      },
    },
  );
  assert.equal(results.length, 60);
  assert.equal(calls, 93);
  assert.deepEqual(
    seen,
    dataset.examples.map((example) => example.id),
  );
  assert.ok(results.every((result) => result.observation.toolDecisionCorrect));
  const message = messagesSeen
    .find((messages) => messages.some((item) => item.role === 'tool'))!
    .find((item) => item.role === 'tool')!;
  assert.equal(message.role === 'tool' && message.callId, 'test-correlation');
  assert.equal(JSON.stringify(messagesSeen).includes('counterfactualPairId'), false);
  assert.equal(JSON.stringify(messagesSeen).includes('failureConditions'), false);
});

test('AC-12/21: failed reservation or persistence cannot dispatch a subsequent inference', async () => {
  for (const failAt of ['reserve', 'record']) {
    let calls = 0;
    await assert.rejects(
      runEvaluation(
        await candidate(),
        {
          llm: {
            async infer() {
              calls++;
              return { type: 'classification', category: 'BUG' };
            },
          },
          repository: {
            async getById() {
              return null;
            },
          },
          systemInstructions: toolCallingInstructions,
        },
        {
          async reserve() {
            if (failAt === 'reserve') {
              throw new Error('disk');
            }
          },
          async record() {
            if (failAt === 'record') {
              throw new Error('disk');
            }
          },
        },
      ),
    );
    assert.equal(calls, failAt === 'reserve' ? 0 : 1);
  }
});

test('AC-12/26: real CLI has no implicit execute action and both operational actions are disabled', async () => {
  await assert.rejects(main(process.cwd(), []));
  await assert.rejects(main(process.cwd(), ['--execute', '--force']));
  await assert.rejects(main(process.cwd(), ['--execute']), /disabled/);
  await assert.rejects(main(process.cwd(), ['--initialize']), /disabled/);
});

test('AC-05/06/22: conditional cases can classify after NOT_FOUND and UNAVAILABLE through real orchestration', async () => {
  for (const [index, id, category, outcome] of [
    [40, 'INC-4601', 'FEATURE', 'NOT_FOUND'],
    [46, 'INC-4607', 'QUESTION', 'UNAVAILABLE'],
  ] as const) {
    const { result, calls } = await scripted(
      [call(id), { type: 'classification', category }],
      index,
    );
    assert.equal(calls, 2);
    assert.equal(result.outcome, 'COMPLETED');
    assert.equal(result.observation.toolOutcome, outcome);
    assert.equal(result.observation.toolDecisionCorrect, true);
    assert.deepEqual(result.final, { status: 'CLASSIFIED', category });
  }
});
