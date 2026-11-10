import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ClassificationError } from '../../src/application/classification-errors.js';
import { OllamaClassifier } from '../../src/infrastructure/ollama/ollama-classifier.js';
import { classificationInstructions } from '../../src/infrastructure/ollama/classification-instructions.js';
import { ollamaInference } from '../../src/infrastructure/ollama/inference-descriptor.js';
import {
  compareIndependent,
  compareIndependentFiles,
} from '../../src/evaluation/independent-validation/compare.js';
import {
  validateIndependentReport,
  writeIndependentReport,
} from '../../src/evaluation/independent-validation/report.js';
import { executeCli } from '../../src/evaluation/independent-validation/main.js';
import { executeIndependent } from '../../src/evaluation/independent-validation/execute.js';
import {
  effectiveAuthorization,
  readLedger,
} from '../../src/evaluation/independent-validation/budget.js';
import { fixture } from './helpers.js';

// These are complete protocol runs against simulated providers in temporary directories.
test('I005-AC-04/07/09/10/11/12/13 two arms 180 attempts, review gate, paired metrics and read-only comparison', async (t) => {
  const f = await fixture(t);
  f.op.authorization['gemma3:12b'] = { ...f.op.authorization['llama3.1:8b'] };
  await f.saveOperation();
  assert.equal((await f.run('gemma3:12b')).exitCode, 1);
  assert.equal(f.calls.length, 0);
  const llama = await f.run('llama3.1:8b');
  assert.equal(llama.exitCode, 0, llama.output);
  const first = await f.report(llama.output);
  assert.equal(first.complete, true);
  const consumedOperation = JSON.parse(
    await readFile(join(f.root, 'evals/experiments/i005-operation.json'), 'utf8'),
  );
  const effective = effectiveAuthorization(
    consumedOperation,
    (await readLedger(f.directory)).ledger,
  );
  assert.equal(effective['llama3.1:8b']!.approved, false);
  assert.equal(effective.initialize!.approved, false);
  assert.deepEqual(consumedOperation, f.op);
  assert.equal(first.execution.attemptedCount, 90);
  assert.equal(first.metrics!.accuracy, 1);
  assert.equal(first.residency.length, 91);
  // Merely completing Llama or granting Gemma does not approve Llama's evidence.
  assert.equal((await f.run('gemma3:12b')).exitCode, 1);
  const ledgerBefore = await readFile(join(f.directory, 'budget.json'));
  const ledger = JSON.parse(ledgerBefore.toString());
  await f.approveGemma(ledger.attempts[0].reportSha256);
  const secondResult = await f.run('gemma3:12b');
  assert.equal(secondResult.exitCode, 0, secondResult.output);
  const second = await f.report(secondResult.output);
  const closedOperation = JSON.parse(
    await readFile(join(f.root, 'evals/experiments/i005-operation.json'), 'utf8'),
  );
  assert.ok(
    Object.values(
      effectiveAuthorization(closedOperation, (await readLedger(f.directory)).ledger),
    ).every((a) => !(a as { approved: boolean }).approved),
  );
  assert.equal(f.calls.length, 180);
  assert.equal(f.counters().maxActive, 1);
  for (let i = 0; i < 90; i++) {
    assert.equal(f.calls[i]!.description, f.inputs.loaded.dataset.examples[i]!.description.trim());
    assert.equal(f.calls[i + 90]!.description, f.calls[i]!.description);
  }
  const paired = compareIndependent(first, second, f.inputs);
  assert.equal(paired.pairs!.length, 90);
  assert.equal(paired.bothValid!.count, 90);
  assert.equal(paired.uncertainty!.estimate, 0);
  assert.equal(paired.decision.outcome, 'net_tie');
  assert.equal(paired.promotionAuthorized, false);
  assert.equal(paired.baseline.legitimate.plannedCount, 75);
  assert.equal(paired.baseline.adversarial.plannedCount, 15);
  assert.equal(second.latency.remaining.n, 89);
  assert.equal(second.memory.summary.truePeakBytes, null);
  const filesBefore = await readdir(f.directory);
  const controls = await readFile(join(f.directory, 'budget.json'));
  const comparison = await compareIndependentFiles(f.root, [
    JSON.parse(llama.output).reportPath,
    JSON.parse(secondResult.output).reportPath,
  ]);
  assert.deepEqual(comparison.pairs, paired.pairs);
  assert.deepEqual(await readFile(join(f.directory, 'budget.json')), controls);
  assert.deepEqual(await readdir(f.directory), filesBefore);
  for (const model of ['llama3.1:8b', 'gemma3:12b'] as const) {
    assert.equal((await f.run(model)).exitCode, 1);
  }
  assert.equal(f.calls.length, 180);
  assert.equal(
    JSON.parse(controls.toString()).attempts.reduce(
      (n: number, a: { attempted: number }) => n + a.attempted,
      0,
    ),
    180,
  );
});

test('I005-AC-08/09 known HTTP/format errors count without retry and block practical confirmation', async (t) => {
  const f = await fixture(t);
  f.setClassifier(async (description, index) => {
    if (index === 0) {
      throw new ClassificationError('http_error');
    }
    if (index === 1) {
      throw new ClassificationError('invalid_response');
    }
    if (index === 2) {
      return { category: 'FEATURE' };
    }
    return {
      category: f.inputs.loaded.dataset.examples.find((e) => e.description === description)!
        .expectedCategory,
    };
  });
  const result = await f.run('llama3.1:8b');
  assert.equal(result.exitCode, 0, result.output);
  const report = await f.report(result.output);
  assert.equal(report.results.length, 90);
  assert.equal(report.execution.errorCount, 2);
  assert.equal(report.execution.incorrectCount, 1);
  assert.equal(report.metrics!.accuracy, 87 / 88);
  assert.equal(report.metrics!.endToEndSuccessRate, 87 / 90);
  assert.equal(report.metrics!.executionSuccessRate, 88 / 90);
  assert.equal(f.calls.length, 90);
  assert.ok(!('predictedCategory' in report.results[0]!));
});

test('I005-AC-06/08 timeout, unexpected exception and identity drift conserve partiality', async (t) => {
  for (const damage of ['timeout', 'unexpected', 'identity'] as const) {
    const f = await fixture(t);
    f.setClassifier(async () => {
      if (damage === 'timeout') {
        throw new ClassificationError('timeout');
      }
      if (damage === 'unexpected') {
        throw new Error('PRIVATE_STACK_SECRET');
      }
      f.observer.snapshot = async (model) => ({
        ...f.snapshot(model),
        identity: { ...f.op.models[model], digest: 'f'.repeat(64) },
      });
      return { category: 'BUG' };
    });
    const result = await f.run('llama3.1:8b');
    assert.equal(result.exitCode, 1);
    const report = await f.report(result.output);
    assert.equal(report.complete, false);
    assert.equal(report.metrics, null);
    assert.equal(report.analysisScope, 'attempted_only');
    assert.equal(report.execution.attemptedCount, 1);
    assert.equal(report.execution.unattemptedCount, 89);
    assert.equal(report.execution.uncertainCount, 0);
    assert.equal(f.calls.length, 1);
    assert.equal(
      report.termination,
      damage === 'timeout'
        ? 'timeout_not_quiescent'
        : damage === 'unexpected'
          ? 'unexpected_error'
          : 'observation_error',
    );
    assert.ok(!JSON.stringify(report).includes('PRIVATE_STACK_SECRET'));
    assert.equal((await f.run('llama3.1:8b')).exitCode, 1);
    assert.equal((await f.run('gemma3:12b')).exitCode, 1);
    assert.equal(f.calls.length, 1);
  }
});

test('I005-AC-04/05 model or host mismatch rejects before reservation and provider', async (t) => {
  for (const kind of ['digest', 'host'] as const) {
    const f = await fixture(t);
    f.observer.snapshot = async (model) => {
      const snapshot = f.snapshot(model);
      if (kind === 'digest') {
        snapshot.identity.digest = 'e'.repeat(64);
      } else {
        snapshot.hostSha256 = 'e'.repeat(64);
      }
      return snapshot;
    };
    const response = await f.run('llama3.1:8b');
    assert.equal(response.exitCode, 1);
    assert.equal(f.calls.length, 0);
    assert.equal(
      JSON.parse(await readFile(join(f.directory, 'budget.json'), 'utf8')).attempts.length,
      0,
    );
  }
});

test('I005-AC-12 initial residency and missing memory block before inference', async (t) => {
  for (const kind of ['residency', 'memory']) {
    const f = await fixture(t);
    if (kind === 'residency') {
      f.observer.prepare = async () => ({
        recordedAt: new Date().toISOString(),
        models: [
          {
            model: 'gemma3:12b',
            digest: f.op.models['gemma3:12b'].digest!,
            size: 1000,
            sizeVram: 1000,
            contextLength: 1000,
          },
        ],
      });
    } else {
      f.observer.readMemory = async () => {
        throw new Error('Unavailable');
      };
    }
    assert.equal((await f.run('llama3.1:8b')).exitCode, 1);
    assert.equal(f.calls.length, 0);
  }
});

test('I005-AC-04/13 actual adapter with mocked HTTP, original payload and no reference leakage', async (t) => {
  const f = await fixture(t);
  const payloads: Record<string, unknown>[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
    payloads.push(JSON.parse(String(options?.body)));
    return Response.json({
      done: true,
      done_reason: 'stop',
      message: { role: 'assistant', content: '{"category":"BUG"}' },
    });
  });
  // Stop after the first call through an observer failure; avoid unnecessary fixture work.
  f.observer.residency = async () => {
    throw new Error('Injected observation stop');
  };
  f.dependencies.classifier = (config) => new OllamaClassifier(config);
  const result = await f.run('llama3.1:8b');
  assert.equal(result.exitCode, 1);
  assert.equal(payloads.length, 1);
  assert.deepEqual(payloads[0], {
    model: 'llama3.1:8b',
    stream: false,
    format: ollamaInference.format,
    options: { temperature: 0 },
    messages: [
      { role: 'system', content: classificationInstructions },
      { role: 'user', content: f.inputs.loaded.dataset.examples[0]!.description.trim() },
    ],
  });
  assert.ok(!JSON.stringify(payloads).includes(f.inputs.loaded.dataset.examples[0]!.rationale));
  assert.ok(!JSON.stringify(payloads).includes('escenario:'));
  const report = await f.report(result.output);
  const encoded = JSON.stringify(report);
  for (const e of f.inputs.loaded.dataset.examples) {
    assert.ok(!encoded.includes(e.description));
    assert.ok(!encoded.includes(e.rationale));
  }
  assert.ok(!encoded.includes(classificationInstructions));
  assert.throws(() =>
    validateIndependentReport({ ...report, description: 'unapproved raw content' }, f.inputs),
  );
  await assert.rejects(writeIndependentReport(f.directory, report, f.inputs), { code: 'EEXIST' });
});

test('I005-AC-06/08 revoked permission or modified frozen input during a run stops before next attempt', async (t) => {
  for (const kind of ['permission', 'dataset']) {
    const f = await fixture(t);
    f.setClassifier(async () => {
      if (kind === 'permission') {
        f.op.authorization['llama3.1:8b'].approved = false;
        await f.saveOperation();
      } else {
        await writeFile(join(f.root, f.inputs.loaded.path), '{}');
      }
      return { category: 'BUG' };
    });
    const result = await f.run('llama3.1:8b');
    assert.equal(result.exitCode, 1);
    const report = await f.report(result.output);
    assert.equal(report.results.length, 1);
    assert.equal(f.calls.length, 1);
    assert.equal(report.complete, false);
  }
});

test('I005-AC-06 persistence failure after provider response never releases attempt', async (t) => {
  const f = await fixture(t);
  let fail = false;
  f.dependencies.synchronization = {
    async file(handle) {
      await handle.sync();
      if (fail) {
        throw new Error('Injected persistence failure');
      }
    },
    async directory(path) {
      const { open } = await import('node:fs/promises');
      const handle = await open(path, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
  };
  f.setClassifier(async () => {
    fail = true;
    return { category: 'BUG' };
  });
  const result = await executeIndependent(f.root, 'llama3.1:8b', f.dependencies);
  assert.equal(result.exitCode, 1);
  const saved = JSON.parse(await readFile(join(f.directory, 'budget.json'), 'utf8'));
  assert.equal(saved.attempts[0].attempted, 1);
  assert.equal(saved.attempts[0].results.length, 0);
  assert.ok((await readdir(f.directory)).includes('budget-persistence.pending'));
  assert.equal((await f.run('llama3.1:8b')).exitCode, 1);
  assert.equal(f.calls.length, 1);
});

test('I005-AC-06 no ledger auto-creation on continuation and explicit initialization never invokes external effects', async (t) => {
  const f = await fixture(t, false);
  assert.equal((await f.run('llama3.1:8b')).exitCode, 1);
  assert.equal(f.calls.length, 0);
  assert.equal(f.counters().observerCreations, 0);
  const response = await executeCli(f.root, ['--initialize'], f.dependencies);
  assert.equal(response.exitCode, 0, response.output);
  assert.equal(JSON.parse(response.output).attempted, 0);
  assert.equal((await executeCli(f.root, ['--initialize'], f.dependencies)).exitCode, 1);
  assert.equal(f.counters().observerCreations, 0);
});
