import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ClassificationError } from '../../src/application/classification-errors.js';
import { OllamaClassifier } from '../../src/infrastructure/ollama/ollama-classifier.js';
import { classificationInstructions } from '../../src/infrastructure/ollama/classification-instructions.js';
import { ollamaInference } from '../../src/infrastructure/ollama/inference-descriptor.js';
import { loadConfig } from '../../src/config.js';
import { parseArguments, executeCli } from '../../src/evaluation/model-comparison/main.js';
import { executeModelEvaluation } from '../../src/evaluation/model-comparison/execute.js';
import {
  models,
  phases,
  loadManifest,
  loadInputs,
  validateManifest,
} from '../../src/evaluation/model-comparison/protocol.js';
import {
  validateModelReport,
  writeModelReport,
} from '../../src/evaluation/model-comparison/report.js';
import { compareModels, compareModelFiles } from '../../src/evaluation/model-comparison/compare.js';
import { project } from './helpers.js';
import { latencySummary } from '../../src/evaluation/model-comparison/statistics.js';

test('I004-AC-01 I004-AC-02 fixtures desautorizados sin observaciones ni inferencias', async (t) => {
  const source = await loadManifest(process.cwd());
  const inputs = await loadInputs(process.cwd(), source.manifest);
  assert.equal(inputs.benchmark.dataset.examples.length, 60);
  assert.equal(inputs.compatibility.examples.length, 3);
  const f = await project(t, false);
  manifestDenied(f.manifest);
  await f.saveManifest();
  const dependencies = {
    observer() {
      throw new Error('No debe crearse');
    },
    classifier() {
      throw new Error('No debe crearse');
    },
  };
  const response = await executeModelEvaluation(f.root, 'compatibility', models[0], dependencies);
  assert.equal(response.exitCode, 1);
  assert.equal(loadConfig({}).model, 'llama3.1:8b');
  assert.equal(loadConfig({}).timeoutMs, 30000);
});

test('I004-AC-02 argumentos explícitos, sin atajos de autorización o entorno', async (t) => {
  assert.deepEqual(parseArguments(['--model', models[1], '--phase', 'benchmark']), {
    model: models[1],
    phase: 'benchmark',
  });
  for (const args of [
    [],
    ['--phase', 'benchmark'],
    ['--phase', 'benchmark', '--model', 'other'],
    ['--phase', 'validation', '--model', models[0]],
    ['--phase', 'benchmark', '--phase', 'compatibility'],
    ['--phase', 'benchmark', '--model', models[0], '--force', 'true'],
  ]) {
    assert.throws(() => parseArguments(args));
  }
  const f = await project(t, false);
  manifestDenied(f.manifest);
  await f.saveManifest();
  const response = await executeCli(
    f.root,
    ['--phase', 'benchmark', '--model', models[0]],
    f.dependencies,
  );
  assert.equal(response.exitCode, 1);
  assert.equal(f.counters().observerCreations, 0);
  assert.equal(f.counters().calls, 0);
  await assert.rejects(readdir(join(f.root, 'evals/reports')), { code: 'ENOENT' });
});

function manifestDenied(manifest: Awaited<ReturnType<typeof project>>['manifest']) {
  for (const phase of phases) {
    for (const model of models) {
      manifest.authorization[phase][model].approved = false;
    }
  }
}

test('I004-AC-02 hash, protocolo, aprobación y metadatos bloquean antes del clasificador', async (t) => {
  for (const changed of ['hash', 'review', 'digest', 'host', 'timeout'] as const) {
    const f = await project(t);
    if (changed === 'hash') {
      f.manifest.compatibility.sha256 = 'f'.repeat(64);
    } else if (changed === 'review') {
      f.manifest.compatibility.review.approved = false;
    } else if (changed === 'digest') {
      const observer = f.dependencies.observer(f.manifest);
      observer.snapshot = async (model) => ({
        ...f.snapshot(model),
        identity: { ...f.manifest.models[model], digest: 'f'.repeat(64) },
      });
      f.dependencies.observer = () => observer;
    } else if (changed === 'host') {
      f.manifest.environment.hostSha256 = 'f'.repeat(64);
    } else {
      assert.throws(() =>
        validateManifest({ ...f.manifest, protocol: { ...f.manifest.protocol, timeoutMs: 30000 } }),
      );
      continue;
    }
    await f.saveManifest();
    assert.equal((await f.run('compatibility', models[0])).exitCode, 1);
    assert.equal(f.counters().calls, 0);
  }
});

test('I004-AC-03 primer fallo técnico bloquea compatibilidad y todo benchmark sin reintento', async (t) => {
  for (const kind of ['timeout', 'connection_error', 'http_error', 'invalid_response'] as const) {
    const f = await project(t);
    f.setClassifier(async () => {
      throw new ClassificationError(kind);
    });
    const response = await f.run('compatibility', models[0]);
    assert.equal(response.exitCode, 1, response.output);
    const report = await f.readReport(response.output);
    validateModelReport(report);
    assert.equal(report.complete, false);
    assert.equal(report.termination, 'compatibility_error');
    assert.equal(report.results.length, 1);
    assert.equal(report.execution.unattemptedCount, 2);
    assert.equal(report.metrics, null);
    assert.equal((await f.run('compatibility', models[1])).exitCode, 1);
    assert.equal((await f.run('benchmark', models[0])).exitCode, 1);
    assert.equal((await f.run('compatibility', models[0])).exitCode, 1);
    assert.equal(f.counters().calls, 1);
  }
});

test('I004-AC-03 JSON válido incorrecto no es incompatibilidad', async (t) => {
  const f = await project(t);
  f.setClassifier(async () => ({ category: 'BUG' }));
  const response = await f.run('compatibility', models[0]);
  assert.equal(response.exitCode, 0, response.output);
  const report = await f.readReport(response.output);
  assert.equal(report.execution.incorrectCount, 2);
  assert.equal(report.execution.errorCount, 0);
  assert.equal(report.complete, true);
  assert.equal(f.counters().calls, 3);
});

test('I004-AC-04 I004-AC-10 orden completo, presupuesto 126, no duplicados ni fase adelantada', async (t) => {
  const f = await project(t);
  assert.equal((await f.run('compatibility', models[1])).exitCode, 1);
  assert.equal((await f.run('benchmark', models[0])).exitCode, 1);
  assert.equal(f.counters().calls, 0);
  await f.compatibilityRuns();
  for (const model of models) {
    const response = await f.run('benchmark', model);
    assert.equal(response.exitCode, 0, response.output);
    const report = await f.readReport(response.output);
    assert.equal(report.results.length, 60);
    assert.equal(report.residency.length, 61);
    assert.equal(report.residency[0]!.models.length, 0);
    assert.ok(
      report.residency.slice(1).every((r) => r.models.length === 1 && r.models[0]!.model === model),
    );
    assert.deepEqual(
      report.results.map((r) => r.id),
      f.benchmark.examples.map((e) => e.id),
    );
  }
  const ledger = JSON.parse(await readFile(join(f.root, 'evals/reports/i004/budget.json'), 'utf8'));
  assert.equal(
    ledger.attempts.reduce((n: number, a: { attempted: number }) => n + a.attempted, 0),
    126,
  );
  assert.equal(
    ledger.attempts.reduce((n: number, a: { reserved: number }) => n + a.reserved, 0),
    126,
  );
  assert.equal(ledger.attempts.length, 4);
  for (const phase of phases) {
    for (const model of models) {
      assert.equal((await f.run(phase, model)).exitCode, 1);
    }
  }
  assert.equal(f.counters().calls, 126);
});

test('I004-AC-04 I004-AC-10 benchmark conocido continúa, inesperado o timeout sin inactividad detienen', async (t) => {
  for (const kind of ['http_error', 'timeout', 'unexpected_error'] as const) {
    const f = await project(t);
    await f.compatibilityRuns();
    if (kind === 'timeout') {
      const observer = f.dependencies.observer(f.manifest);
      observer.confirmIdleAfterTimeout = async () => false;
      f.dependencies.observer = () => observer;
    }
    f.setClassifier(async (description, _model, index) => {
      if (index === 0) {
        if (kind === 'unexpected_error') {
          throw new Error('PROGRAMMING_SECRET');
        }
        throw new ClassificationError(kind);
      }
      return { category: f.expected.get(description)! };
    });
    const response = await f.run('benchmark', models[0]);
    const report = await f.readReport(response.output);
    assert.equal(response.exitCode, kind === 'http_error' ? 0 : 1);
    assert.equal(report.results.length, kind === 'http_error' ? 60 : 1);
    assert.equal(report.execution.errorCount, 1);
    assert.ok(!JSON.stringify(report).includes('PROGRAMMING_SECRET'));
    if (kind !== 'http_error') {
      assert.equal((await f.run('benchmark', models[1])).exitCode, 1);
    }
  }
});

test('I004-AC-04 residencia inicial o ajena bloquea y conserva parcialidad', async (t) => {
  for (const initial of [true, false]) {
    const f = await project(t);
    const observer = f.dependencies.observer(f.manifest);
    const foreign = {
      recordedAt: new Date().toISOString(),
      models: [
        {
          model: models[1],
          digest: f.manifest.models[models[1]].digest!,
          size: 10,
          sizeVram: 10,
          contextLength: 4096,
        },
      ],
    };
    if (initial) {
      observer.prepare = async () => foreign;
    } else {
      observer.residency = async () => foreign;
    }
    f.dependencies.observer = () => observer;
    const response = await f.run('compatibility', models[0]);
    assert.equal(response.exitCode, 1);
    assert.equal(f.counters().calls, initial ? 0 : 1);
    if (!initial) {
      const report = await f.readReport(response.output);
      assert.equal(report.termination, 'observation_error');
      assert.equal(report.results.length, 1);
      assert.equal(report.complete, false);
    }
  }
});

test('I004-AC-08 memoria no fiable requiere aprobación y queda explícitamente ausente', async (t) => {
  const f = await project(t);
  const observer = f.dependencies.observer(f.manifest);
  observer.readMemory = async () => {
    throw new Error('Unavailable');
  };
  f.dependencies.observer = () => observer;
  assert.equal((await f.run('compatibility', models[0])).exitCode, 1);
  assert.equal(f.counters().calls, 0);
  f.manifest.environment.memoryUnavailable = {
    approved: true,
    approvedBy: 'Fixture reviewer',
    date: '2026-11-06',
  };
  await f.saveManifest();
  const response = await f.run('compatibility', models[0]);
  assert.equal(response.exitCode, 0, response.output);
  const report = await f.readReport(response.output);
  assert.equal(report.memory.summary.reliable, false);
  assert.equal(report.memory.summary.observedMaxRssBytes, null);
  assert.equal(report.memory.summary.truePeakBytes, null);
  assert.ok(report.memory.samples.every((s) => s.reason === 'unavailable'));
});

test('I004-AC-09 informes estrictos, creación exclusiva y ausencia de textos privados', async (t) => {
  const f = await project(t);
  const response = await f.run('compatibility', models[0]);
  assert.equal(response.exitCode, 0, response.output);
  const report = await f.readReport(response.output);
  assert.equal(report.schemaVersion, 3);
  validateModelReport(report);
  await assert.rejects(writeModelReport(join(f.root, 'evals/reports/i004'), report), {
    code: 'EEXIST',
  });
  assert.throws(() => validateModelReport({ ...report, description: 'secret' }));
  const changed = structuredClone(report);
  changed.results[0]!.durationMs = -1;
  assert.throws(() => validateModelReport(changed));
  const text = JSON.stringify(report);
  for (const example of [...f.compatibility.examples, ...f.benchmark.examples]) {
    assert.ok(!text.includes(example.description));
    assert.ok(!text.includes(example.rationale));
  }
  assert.ok(!text.includes(classificationInstructions));
  assert.equal(report.latency.internal.loadMs, null);
  assert.equal(report.model.digest, f.manifest.models[models[0]].digest);
});

test('I004-AC-05 I004-AC-06 I004-AC-11 comparación por ID, errores, regresiones y modelos distintos', async (t) => {
  const f = await project(t);
  await f.compatibilityRuns();
  const baselineResult = await f.run('benchmark', models[0]);
  const baseline = await f.readReport(baselineResult.output);
  f.setClassifier(async (description, _model, index) => {
    if (index === 0) {
      throw new ClassificationError('invalid_response');
    }
    return { category: index === 1 ? 'FEATURE' : f.expected.get(description)! };
  });
  const candidateResult = await f.run('benchmark', models[1]);
  assert.equal(candidateResult.exitCode, 0, candidateResult.output);
  const candidate = await f.readReport(candidateResult.output);
  const comparison = compareModels(baseline, candidate);
  assert.equal(comparison.bothValid.count, 59);
  assert.equal(comparison.legitimate.operationalRegressions.length, 1);
  assert.equal(comparison.legitimate.semanticRegressions.length, 1);
  assert.equal(comparison.legitimate.netLossOfCorrect, 2);
  assert.equal(comparison.candidate.global.metrics.accuracy, 58 / 59);
  assert.equal(comparison.candidate.global.metrics.endToEndSuccessRate, 58 / 60);
  assert.equal(comparison.signals.relevantExploratoryGain, false);
  assert.equal(comparison.promotionAuthorized, false);
  const reordered = structuredClone(candidate);
  reordered.results.reverse();
  // Recomputed report summaries are required when changing latency order; canonical report rejects tampering.
  assert.throws(() => compareModels(baseline, reordered));
  reordered.latency = latencySummary(reordered.results);
  const reorderedComparison = compareModels(baseline, reordered);
  assert.deepEqual(reorderedComparison.transitions, comparison.transitions);
  assert.equal(reorderedComparison.bothValid.count, 59);
  const wrong = structuredClone(candidate);
  wrong.results[0]!.id = 'unknown';
  assert.throws(() => compareModels(baseline, wrong));
  assert.throws(() => compareModels(candidate, baseline));
  const fromFiles = await compareModelFiles(f.root, [
    JSON.parse(baselineResult.output).reportPath,
    JSON.parse(candidateResult.output).reportPath,
  ]);
  assert.deepEqual(fromFiles.pairs, comparison.pairs);
});

test('I004-AC-09 I004-AC-12 payload real del adaptador con fetch simulado y producción intacta', async (t) => {
  const f = await project(t);
  const payloads: Record<string, unknown>[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
    payloads.push(JSON.parse(String(options?.body)));
    return new Response(
      JSON.stringify({
        done: true,
        done_reason: 'stop',
        message: { role: 'assistant', content: '{"category":"BUG"}' },
      }),
    );
  });
  f.dependencies.classifier = (config) => {
    assert.equal(config.timeoutMs, 45000);
    return new OllamaClassifier(config);
  };
  const first = await f.run('compatibility', models[0]);
  const second = await f.run('compatibility', models[1]);
  assert.equal(first.exitCode, 0, first.output);
  assert.equal(second.exitCode, 0, second.output);
  assert.equal(payloads.length, 6);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(payloads[i + 3], { ...payloads[i], model: models[1] });
    assert.deepEqual(payloads[i]!.messages, [
      { role: 'system', content: classificationInstructions },
      { role: 'user', content: f.compatibility.examples[i]!.description.trim() },
    ]);
    assert.deepEqual(payloads[i]!.format, ollamaInference.format);
    assert.deepEqual(payloads[i]!.options, { temperature: 0 });
  }
  assert.deepEqual(loadConfig({}), {
    model: models[0],
    baseUrl: 'http://localhost:11434',
    timeoutMs: 30000,
  });
  assert.ok((await readFile('src/main.ts', 'utf8')).includes('new OllamaClassifier(loadConfig())'));
  assert.equal(
    execFileSync('git', ['check-ignore', 'evals/reports/i004/example.json'], {
      encoding: 'utf8',
    }).trim(),
    'evals/reports/i004/example.json',
  );
});

test('I004-AC-02 I004-AC-10 evidencia previa o progreso alterados bloquean sin inferencias', async (t) => {
  for (const target of ['report', 'ledger']) {
    const f = await project(t);
    const response = await f.run('compatibility', models[0]);
    if (target === 'report') {
      const path = join(f.root, JSON.parse(response.output).reportPath);
      await writeFile(path, '{}');
    } else {
      const path = join(f.root, 'evals/reports/i004/budget.json');
      const ledger = JSON.parse(await readFile(path, 'utf8'));
      ledger.attempts[0].results[0].durationMs += 1;
      await writeFile(path, JSON.stringify(ledger));
    }
    assert.equal((await f.run('compatibility', models[1])).exitCode, 1);
    assert.equal(f.counters().calls, 3);
  }
});

test('I004-AC-02 entorno no puede autorizar ni alterar modelo o timeout experimental', async (t) => {
  const priorModel = process.env.OLLAMA_MODEL;
  const priorTimeout = process.env.OLLAMA_TIMEOUT_MS;
  const priorForce = process.env.I004_ALLOW_INFERENCES;
  t.after(() => {
    for (const [key, value] of [
      ['OLLAMA_MODEL', priorModel],
      ['OLLAMA_TIMEOUT_MS', priorTimeout],
      ['I004_ALLOW_INFERENCES', priorForce],
    ] as const) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
  process.env.OLLAMA_MODEL = 'unapproved-model';
  process.env.OLLAMA_TIMEOUT_MS = '1';
  process.env.I004_ALLOW_INFERENCES = 'true';
  const f = await project(t);
  const allowedFixture = await f.run('compatibility', models[0]);
  assert.equal(allowedFixture.exitCode, 0, allowedFixture.output);
  const report = await f.readReport(allowedFixture.output);
  assert.equal(report.model.name, models[0]);
  assert.equal(report.configuration.timeoutMs, 45000);
  assert.equal(process.env.OLLAMA_MODEL, 'unapproved-model');
  assert.equal(process.env.OLLAMA_TIMEOUT_MS, '1');
  manifestDenied(f.manifest);
  await f.saveManifest();
  const before = f.counters().calls;
  assert.equal((await f.run('compatibility', models[1])).exitCode, 1);
  assert.equal(f.counters().calls, before);
});
