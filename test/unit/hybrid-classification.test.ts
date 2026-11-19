import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractIncidentReferences } from '../../src/application/incident-references.js';
import {
  classifyIncident,
  type ToolCallingDependencies,
} from '../../src/application/classify-incident.js';
import { InvalidToolCallError } from '../../src/application/tool-calling-errors.js';
import { ClassificationError } from '../../src/application/classification-errors.js';
import { createClassificationDependencies } from '../../src/composition.js';
import { restrictedIncidentLookupTool } from '../../src/infrastructure/ollama/tool-calling-protocol.js';
import { loadConfig } from '../../src/config.js';
import { candidate, identity } from '../tool-calling-evaluation/helpers.js';
import { runEvaluation } from '../../src/evaluation/tool-calling/run.js';
import { buildReport } from '../../src/evaluation/tool-calling/report.js';
import { candidateModel, plannedPhases } from '../../src/evaluation/tool-calling/protocol.js';

const config = { baseUrl: 'http://simulated.invalid', ...candidateModel };
const envelope = (message: unknown) => Response.json({ done: true, done_reason: 'stop', message });

for (const [text, expected] of [
  ['Sin referencias', []],
  ['INC-1', ['INC-1']],
  ['(inc-142), INC-999999. INC-142 / InC-2', ['INC-142', 'INC-999999', 'INC-2']],
  ['INC-0 INC-01 INC-1234567 INC-12345678', []],
  ['xINC-1 INC-1x éINC-1 INC-1é 9INC-1 INC-1_ INC-1-2', []],
  ['INC-1\u0301 \u0301INC-1 INC-1١ 𐐀INC-1', []],
  ['INC -1 INC- 1 INC_1 INC–1 INC-１', []],
  ['INC-1\nINC-2;\tinc-1', ['INC-1', 'INC-2']],
] as [string, string[]][]) {
  test(`I006-AC-07/27 lexical extraction ${JSON.stringify(text)}`, () => {
    assert.deepEqual(extractIncidentReferences(text), expected);
  });
}

test('I006-AC-27/28 dynamic enums are per call, deduplicated, and never unrestricted', () => {
  assert.deepEqual(
    restrictedIncidentLookupTool(['INC-1', 'INC-2', 'INC-1']).function.parameters.properties
      .incidentId.enum,
    ['INC-1', 'INC-2'],
  );
  assert.deepEqual(
    restrictedIncidentLookupTool(['INC-3']).function.parameters.properties.incidentId.enum,
    ['INC-3'],
  );
  for (const ids of [[], ['INC-01'], ['INC-1\n']]) {
    assert.throws(() => restrictedIncidentLookupTool(ids), RangeError);
  }
});

for (const final of [{ type: 'classification', category: 'BUG' }, { type: 'abstention' }]) {
  test(`I006-AC-01/09/28 no eligible ID performs only final ${final.type}, despite prompt references`, async () => {
    let calls = 0;
    const deps = createClassificationDependencies(config, async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.think, false);
      assert.equal(body.model, 'qwen3:8b');
      assert.equal(body.tools, undefined);
      assert.ok(body.format.oneOf);
      return envelope({ role: 'assistant', content: JSON.stringify(final) });
    });
    deps.systemInstructions += '\nINC-142';
    deps.repository.getById = async () => assert.fail('No repository');
    const result = await classifyIncident(deps, 'La aplicación no guarda el documento.');
    assert.equal(
      result.status,
      final.type === 'abstention' ? 'INSUFFICIENT_CONTEXT' : 'CLASSIFIED',
    );
    assert.equal(calls, 1);
  });
}

test('I006-AC-08/28 provider ignoring the enum cannot execute an unprovided ID or obtain repair', async () => {
  let sends = 0;
  const deps = createClassificationDependencies(config, async (_url, init) => {
    sends++;
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.tools[0].function.parameters.properties.incidentId.enum, [
      'INC-1',
      'INC-2',
    ]);
    assert.equal(body.format, undefined);
    return envelope({
      role: 'assistant',
      tool_calls: [{ function: { name: 'getIncidentById', arguments: { incidentId: 'INC-142' } } }],
    });
  });
  deps.repository.getById = async () => assert.fail('Forbidden lookup');
  await assert.rejects(classifyIncident(deps, 'Retomo INC-1 o inc-2'), InvalidToolCallError);
  assert.equal(sends, 1);
});

for (const lookup of [false, true]) {
  test(`I006-AC-09/28 multiple eligible IDs, lookup ${lookup}, exactly two requests`, async () => {
    let sends = 0;
    let queries = 0;
    const deps = createClassificationDependencies(config, async (_url, init) => {
      sends++;
      const body = JSON.parse(String(init?.body));
      if (sends === 1) {
        assert.deepEqual(body.tools[0].function.parameters.properties.incidentId.enum, [
          'INC-1',
          'INC-2',
        ]);
        return lookup
          ? envelope({
              role: 'assistant',
              tool_calls: [
                { function: { name: 'getIncidentById', arguments: { incidentId: 'inc-2' } } },
              ],
            })
          : envelope({ role: 'assistant', content: 'DISCARDED' });
      }
      assert.equal(body.tools, undefined);
      assert.ok(body.format);
      assert.equal(JSON.stringify(body).includes('DISCARDED'), false);
      return envelope({ role: 'assistant', content: '{"type":"classification","category":"BUG"}' });
    });
    deps.repository.getById = async (id) => {
      queries++;
      assert.equal(id, 'INC-2');
      return null;
    };
    assert.deepEqual(await classifyIncident(deps, 'Retomo INC-1 o INC-2'), {
      status: 'CLASSIFIED',
      category: 'BUG',
    });
    assert.equal(sends, 2);
    assert.equal(queries, lookup ? 1 : 0);
  });
}

test('I006-AC-09/10/28 no-ID final errors stop without decision fallback', async () => {
  let sends = 0;
  const failure = new ClassificationError('timeout');
  const deps: ToolCallingDependencies = {
    now: () => 0,
    systemInstructions: 'INC-142',
    classificationInstructions: 'final',
    llm: {
      async infer(_messages, options) {
        sends++;
        assert.equal(options.toolsEnabled, false);
        assert.equal(options.timeoutMs, 45000);
        throw failure;
      },
    },
    repository: {
      async getById() {
        assert.fail('No lookup');
      },
    },
  };
  await assert.rejects(classifyIncident(deps, 'Sin referencia'), (error) => error === failure);
  assert.equal(sends, 1);
});

test('I006-AC-19/26/29 full known regression uses 104 mocked requests and reports CODE/LLM separately', async () => {
  const dataset = await candidate();
  assert.equal(
    dataset.examples.filter((example) => plannedPhases(example.description).length === 1).length,
    16,
  );
  assert.equal(
    dataset.examples.filter((example) => plannedPhases(example.description).length === 2).length,
    44,
  );
  assert.equal(loadConfig({}).model, 'llama3.1:8b');
  let current = dataset.examples[0]!;
  let sends = 0;
  const deps = createClassificationDependencies(config, async (_url, init) => {
    sends++;
    const body = JSON.parse(String(init?.body));
    if (body.tools) {
      return current.expectedTool
        ? envelope({
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
        : envelope({ role: 'assistant', content: '' });
    }
    return envelope({
      role: 'assistant',
      content: JSON.stringify(
        current.expectedFinal.status === 'CLASSIFIED'
          ? { type: 'classification', category: current.expectedFinal.category }
          : { type: 'abstention' },
      ),
    });
  });
  const results = await runEvaluation(dataset, deps, {
    async reserve(example) {
      current = example;
    },
    async record() {},
  });
  const report = buildReport(dataset, identity, results, new Date().toISOString());
  assert.equal(sends, 104);
  assert.equal(report.status, 'COMPLETE_PASSED');
  assert.equal(report.segments.CODE.cases, 16);
  assert.equal(report.segments.CODE.toolDecisionsCorrect, 16);
  assert.equal(report.segments.LLM.cases, 44);
  assert.equal(report.segments.LLM.toolDecisionsCorrect, 44);
  assert.ok(
    report.results
      .filter((result) => result.observation.decisionSource === 'CODE')
      .every(
        (result) => !result.phases.decision.started && result.observation.inferenceCount === 1,
      ),
  );
});

test('I006-AC-19/20/28 an eligible but wrong target remains a semantic error, distinct from a blocked ID', async () => {
  const dataset = await candidate();
  dataset.examples = [{ ...dataset.examples[20]!, description: 'Retomo INC-4401 o INC-4402' }];
  let phase = 0;
  const results = await runEvaluation(
    dataset,
    {
      systemInstructions: 'decision',
      classificationInstructions: 'final',
      llm: {
        async infer() {
          return phase++ === 0
            ? {
                type: 'tool_calls',
                calls: [{ name: 'getIncidentById', arguments: { incidentId: 'INC-4402' } }],
              }
            : { type: 'abstention' };
        },
      },
      repository: {
        async getById() {
          assert.fail('Use per-case fixtures');
        },
      },
    },
    { async reserve() {}, async record() {} },
  );
  assert.equal(results[0]!.observation.toolRequestValid, true);
  assert.equal(results[0]!.observation.toolExecuted, true);
  assert.equal(results[0]!.observation.toolDecisionCorrect, false);
});

test('I006-AC-19/29 reports reject forged deterministic origins and deterministic tool executions', async () => {
  const { perfectResults } = await import('../tool-calling-evaluation/helpers.js');
  const dataset = await candidate();
  for (const mutate of [
    (row: ReturnType<typeof perfectResults>[number]) => {
      row.observation.decisionSource = 'LLM';
    },
    (row: ReturnType<typeof perfectResults>[number]) => {
      row.observation.toolExecuted = true;
      row.observation.executionCount = 1;
    },
  ]) {
    const results = perfectResults(dataset);
    mutate(results[0]!);
    assert.throws(
      () => buildReport(dataset, identity, results, new Date().toISOString()),
      /Invalid/,
    );
  }
});

test('I006-AC-26/29 identity pins candidate, thinking, digest and quantization without calling chat', async (t) => {
  const { effectiveIdentity } = await import('../../src/evaluation/tool-calling/main.js');
  const { sha256 } = await import('../../src/evaluation/dataset.js');
  const { readFile } = await import('node:fs/promises');
  let digest: string = candidateModel.digest;
  let quantization = 'Q4_K_M';
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    const path = new URL(String(input)).pathname;
    if (path === '/api/tags') {
      return Response.json({ models: [{ name: 'qwen3:8b', digest }] });
    }
    if (path === '/api/version') {
      return Response.json({ version: '0.40.14' });
    }
    assert.equal(path, '/api/show', 'Identity must never call inference endpoints');
    return Response.json({ details: { quantization_level: quantization }, template: 'native' });
  });
  const hash = sha256(await readFile('evals/datasets/incidents-tool-calling-v1.json'));
  const code = { identity: identity.codeIdentity, verify() {} };
  const effective = await effectiveIdentity(process.cwd(), hash, code);
  assert.equal(effective.model, 'qwen3:8b');
  assert.equal(effective.modelDigest, candidateModel.digest);
  assert.equal(effective.think, false);
  digest = 'a'.repeat(64);
  await assert.rejects(effectiveIdentity(process.cwd(), hash, code), /model identity/);
  digest = candidateModel.digest;
  quantization = 'Q8_0';
  await assert.rejects(effectiveIdentity(process.cwd(), hash, code), /model identity/);
});
