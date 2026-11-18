import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  runToolsFormat,
  createToolsFormatBudget,
  withFirstRequestFormat,
} from '../../src/diagnostics/i006-tools-format.js';
import {
  checkToolsFormat,
  executeToolsFormat,
  main,
} from '../../src/diagnostics/i006-tools-format-main.js';
import { RetiredI006DiagnosticError } from '../../src/diagnostics/retired-i006.js';
import {
  incidentLookupTool,
  toolCallingFinalSchema,
} from '../../src/infrastructure/ollama/tool-calling-protocol.js';

test('I006-AC-12/18 retired tools+format diagnostic rejects all entrypoints without dependency access', async () => {
  const poison = new Proxy(
    {},
    {
      get() {
        assert.fail('Retired diagnostic touched a dependency');
      },
    },
  );
  for (const invoke of [
    () => runToolsFormat(poison),
    () => checkToolsFormat(poison),
    () => executeToolsFormat(poison),
    () => main(['--run'], poison),
    () => main(['--check'], poison),
  ]) {
    await assert.rejects(invoke(), RetiredI006DiagnosticError);
  }
});

test('I006 historical pure helpers retain payload isolation and ordered conservative budget', async () => {
  const original = {
    method: 'POST',
    body: JSON.stringify({
      model: 'simulated',
      stream: false,
      options: { temperature: 0 },
      messages: [],
      tools: [incidentLookupTool],
    }),
  };
  const wrapped = withFirstRequestFormat(async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), {
      ...JSON.parse(original.body),
      format: toolCallingFinalSchema,
    });
    return new Response();
  }, 'simulated');
  await wrapped('http://invalid.test', original);
  assert.equal(Object.hasOwn(JSON.parse(original.body), 'format'), false);
  const budget = createToolsFormatBudget(async () => {});
  await budget.reserve('A', 1);
  await budget.reserve('B', 1);
  await budget.reserve('B', 2);
  await assert.rejects(budget.reserve('B', 3));
  assert.equal(budget.consumed(), 3);
});
