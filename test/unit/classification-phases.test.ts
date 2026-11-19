import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyIncident } from '../../src/application/classify-incident.js';
import { ClassificationError } from '../../src/application/classification-errors.js';
import { InvalidToolCallError } from '../../src/application/tool-calling-errors.js';
import type { LlmResponse } from '../../src/application/classification-llm.js';
import { OllamaClassificationLlm } from '../../src/infrastructure/ollama/ollama-classification-llm.js';
import { createClassificationDependencies } from '../../src/composition.js';
import { lookupDecisionInstructions } from '../../src/infrastructure/ollama/lookup-decision-instructions.js';
import { classificationFinalInstructions } from '../../src/infrastructure/ollama/classification-final-instructions.js';
import { runEvaluation } from '../../src/evaluation/tool-calling/run.js';
import { buildReport } from '../../src/evaluation/tool-calling/report.js';
import { candidate, identity, perfectResults } from '../tool-calling-evaluation/helpers.js';

const config = { baseUrl: 'http://simulated.invalid', model: 'simulated' };
const wrap = (message: unknown) => Response.json({ done: true, done_reason: 'stop', message });

test('I006-AC-01/02/14/17 decision text is ignored, including invalid JSON and textual calls; absence is no_lookup', async () => {
  for (const content of [
    undefined,
    '',
    'not JSON',
    '{"type":"classification","category":"BUG"}',
    '{"type":"abstention"}',
    '{"tool_calls":[{"function":{"name":"getIncidentById"}}]}',
    '```json\n{}\n```',
  ]) {
    let requests = 0;
    const adapter = new OllamaClassificationLlm(config, async () => {
      requests++;
      return wrap({ role: 'assistant', ...(content === undefined ? {} : { content }) });
    });
    assert.deepEqual(
      await adapter.infer([], {
        toolsEnabled: true,
        eligibleIncidentIds: ['INC-142'],
        timeoutMs: 45000,
      }),
      {
        type: 'no_lookup',
      },
    );
    assert.equal(requests, 1);
  }
});

test('I006-AC-08/14/17 decision protocol remains strict; malformed content, calls and mixed messages are technical failures', async () => {
  for (const message of [
    { role: 'assistant', content: null },
    { role: 'assistant', content: 1 },
    { role: 'assistant', tool_calls: null },
    { role: 'assistant', tool_calls: [{}] },
    { role: 'assistant', content: ' ', tool_calls: [] },
    { role: 'user', content: '' },
  ]) {
    const adapter = new OllamaClassificationLlm(config, async () => wrap(message));
    await assert.rejects(
      adapter.infer([], { toolsEnabled: true, eligibleIncidentIds: ['INC-142'], timeoutMs: 45000 }),
      (error) => error instanceof ClassificationError && error.kind === 'invalid_response',
    );
  }
  const adapter = new OllamaClassificationLlm(config, async () =>
    wrap({ role: 'assistant', tool_calls: [] }),
  );
  assert.deepEqual(
    await adapter.infer([], {
      toolsEnabled: true,
      eligibleIncidentIds: ['INC-142'],
      timeoutMs: 45000,
    }),
    {
      type: 'tool_calls',
      calls: [],
    },
  );
});

test('I006-AC-01/09/14 classifications cannot escape the decision phase and no_lookup cannot escape the final phase', async () => {
  for (const responses of [
    [{ type: 'classification', category: 'BUG' }],
    [{ type: 'abstention' }],
    [{ type: 'no_lookup', extra: true }],
    [{ type: 'no_lookup' }, { type: 'no_lookup' }],
  ]) {
    let calls = 0;
    await assert.rejects(
      classifyIncident(
        {
          systemInstructions: 'decision',
          classificationInstructions: 'final',
          llm: {
            async infer() {
              return responses[calls++] as LlmResponse;
            },
          },
          repository: {
            async getById() {
              assert.fail('No lookup');
            },
          },
        },
        'text INC-142',
      ),
      (error) => error instanceof ClassificationError && error.kind === 'invalid_response',
    );
    assert.equal(calls, responses.length);
  }
  let calls = 0;
  await assert.rejects(
    classifyIncident(
      {
        systemInstructions: 'decision',
        classificationInstructions: 'final',
        llm: {
          async infer() {
            return calls++ === 0 ? { type: 'no_lookup' } : { type: 'tool_calls', calls: [] };
          },
        },
        repository: {
          async getById() {
            assert.fail('Additional lookup forbidden');
          },
        },
      },
      'text INC-142',
    ),
    InvalidToolCallError,
  );
  assert.equal(calls, 2);
});

test('I006-AC-01/02/09/14/17/25 two native requests have separate system instructions and never copy discarded text', async () => {
  const secret = 'DISCARDED_FIRST_RESPONSE_SECRET';
  const bodies: any[] = [];
  const dependencies = createClassificationDependencies(config, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    if (bodies.length === 1) {
      return wrap({ role: 'assistant', content: secret });
    }
    assert.equal(JSON.stringify(body).includes(secret), false);
    return wrap({ role: 'assistant', content: '{"type":"classification","category":"FEATURE"}' });
  });
  dependencies.repository.getById = async () => {
    assert.fail('No repository');
  };
  const result = await classifyIncident(dependencies, 'Sufficient text, incidental INC-142');
  assert.deepEqual(result, { status: 'CLASSIFIED', category: 'FEATURE' });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].messages[0].content, lookupDecisionInstructions);
  assert.equal(bodies[1].messages[0].content, classificationFinalInstructions);
  assert.deepEqual(bodies[0].messages[1], bodies[1].messages[1]);
  assert.equal(Object.hasOwn(bodies[0], 'format'), false);
  assert.ok(bodies[0].tools);
  assert.equal(Object.hasOwn(bodies[1], 'tools'), false);
  assert.ok(bodies[1].format.oneOf);
  assert.equal(bodies[1].messages.length, 2);
});

test('I006-AC-19/21/26 final technical failure retains known no_lookup and reports its phase without provider content', async () => {
  let calls = 0;
  const results = await runEvaluation(
    await candidate(),
    {
      systemInstructions: 'decision',
      classificationInstructions: 'final',
      llm: {
        async infer() {
          calls++;
          throw new ClassificationError('invalid_response', 'FINAL_SCHEMA_INVALID');
        },
      },
      repository: {
        async getById() {
          assert.fail('No repository');
        },
      },
    },
    { async reserve() {}, async record() {} },
  );
  assert.equal(calls, 1);
  assert.equal(results.length, 1);
  assert.deepEqual(results[0]!.phases, {
    decision: {
      started: false,
      attempts: 0,
      dispatched: 0,
      reservationUncertain: false,
      status: 'NOT_STARTED',
    },
    classification: {
      started: true,
      attempts: 1,
      dispatched: 1,
      reservationUncertain: false,
      status: 'TECHNICAL_ERROR',
    },
  });
  assert.equal(results[0]!.failurePhase, 'classification');
  assert.equal(results[0]!.observation.toolRequested, false);
  assert.equal(results[0]!.diagnostic, 'FINAL_SCHEMA_INVALID');
  assert.equal(
    buildReport(await candidate(), identity, results, new Date().toISOString()).status,
    'INCOMPLETE',
  );
});

test('I006-AC-20/21/23 policy-evaluable rejection does not add a hidden fixed-attempt acceptance threshold', async () => {
  const dataset = await candidate();
  const results = perfectResults(dataset);
  const rejected = results[10]!;
  rejected.outcome = 'POLICY_VIOLATION';
  rejected.error = 'invalid_tool_call';
  rejected.failurePhase = 'decision';
  rejected.final = null;
  rejected.phases = {
    decision: {
      started: true,
      attempts: 1,
      dispatched: 1,
      reservationUncertain: false,
      status: 'POLICY_REJECTED',
    },
    classification: {
      started: false,
      attempts: 0,
      dispatched: 0,
      reservationUncertain: false,
      status: 'NOT_STARTED',
    },
  };
  rejected.observation.inferenceCount = 1;
  rejected.observation.toolRequested = true;
  rejected.observation.toolRequestValid = false;
  rejected.observation.toolDecisionCorrect = false;
  rejected.observation.requestCount = 1;
  const report = buildReport(dataset, identity, results, new Date().toISOString());
  assert.equal(report.status, 'COMPLETE_PASSED');
  assert.equal(
    results.reduce((sum, result) => sum + result.observation.inferenceCount, 0),
    103,
  );
  assert.equal(report.metrics.classification.numerator, 49);
  assert.equal(report.metrics.classification.denominator, 50);
  assert.equal(report.metrics.precision.denominator, 34);
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.protocolId, 'I006-HYBRID-CLASSIFICATION-V1');
});

test('I006-AC-22/26 real adapter and orchestration process 60 simulated cases in 104 phase-identified attempts', async () => {
  const dataset = await candidate();
  let current = dataset.examples[0]!;
  let requests = 0;
  const dependencies = createClassificationDependencies(config, async (_url, init) => {
    requests++;
    const body = JSON.parse(String(init?.body));
    assert.equal(JSON.stringify(body).includes('rationale'), false);
    if (body.tools) {
      return current.expectedTool
        ? wrap({
            role: 'assistant',
            tool_calls: [
              {
                function: {
                  name: current.expectedTool.name,
                  arguments: { incidentId: current.expectedTool.incidentId },
                },
              },
            ],
          })
        : wrap({ role: 'assistant', content: 'ignored decision text' });
    }
    return wrap({
      role: 'assistant',
      content: JSON.stringify(
        current.expectedFinal.status === 'CLASSIFIED'
          ? { type: 'classification', category: current.expectedFinal.category }
          : { type: 'abstention' },
      ),
    });
  });
  const results = await runEvaluation(dataset, dependencies, {
    async reserve(example) {
      current = example;
    },
    async record() {},
  });
  const report = buildReport(dataset, identity, results, new Date().toISOString());
  assert.equal(requests, 104);
  assert.equal(results.length, 60);
  assert.equal(report.status, 'COMPLETE_PASSED');
  assert.ok(
    results.every(
      (result) =>
        (result.observation.decisionSource === 'CODE'
          ? result.phases.decision.status === 'NOT_STARTED'
          : result.phases.decision.status === 'COMPLETED') &&
        result.phases.classification.status === 'COMPLETED' &&
        result.observation.inferenceCount ===
          (result.observation.decisionSource === 'CODE' ? 1 : 2),
    ),
  );
});

test('I006-AC-19/26 report rejects inconsistent phase counters, crossed states and legacy identities', async () => {
  const dataset = await candidate();
  for (const mutation of [
    (result: ReturnType<typeof perfectResults>[number]) => {
      result.phases.classification.attempts = 0;
    },
    (result: ReturnType<typeof perfectResults>[number]) => {
      result.phases.decision.status = 'NOT_STARTED';
    },
    (result: ReturnType<typeof perfectResults>[number]) => {
      result.failurePhase = 'decision';
    },
  ]) {
    const results = perfectResults(dataset);
    mutation(results[10]!);
    assert.throws(
      () => buildReport(dataset, identity, results, new Date().toISOString()),
      /Invalid/,
    );
  }
  const legacyIdentity = { ...identity, protocolId: 'I006-OLD' };
  assert.throws(
    () =>
      Reflect.apply(buildReport, undefined, [
        dataset,
        legacyIdentity,
        [],
        new Date().toISOString(),
      ]),
    /Incompatible/,
  );
});
