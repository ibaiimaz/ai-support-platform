import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../../src/config.js';
import { loadDataset, sha256 } from '../../src/evaluation/dataset.js';
import { runEvaluation } from '../../src/evaluation/run-evaluation.js';
import { buildReport, validateReport, writeReport } from '../../src/evaluation/report.js';
import { executeEvaluation } from '../../src/evaluation/main.js';
import { classificationInstructions } from '../../src/infrastructure/ollama/classification-instructions.js';
import { ollamaInference } from '../../src/infrastructure/ollama/inference-descriptor.js';
import { ClassificationError } from '../../src/application/classification-errors.js';
import { temporaryProject } from './helpers.js';

test('I002-AC-08 hashes verificables, modelo efectivo y referencia opcional al código', async (t) => {
  const root = await temporaryProject(t);
  const path = 'evals/datasets/incidents-v1.json';
  const loaded = await loadDataset(join(root, path), path);
  const config = loadConfig({
    OLLAMA_MODEL: 'otro-modelo:latest',
    OLLAMA_TIMEOUT_MS: '42',
    OLLAMA_BASE_URL: 'https://user:PASSWORD_SECRET@example.com:8443/path?token=TOKEN_SECRET',
  });
  const run = await runEvaluation(loaded.dataset.examples, {
    async classify() {
      return { category: 'BUG' };
    },
  });

  for (const reference of [null, 'git:' + 'a'.repeat(40)]) {
    const report = buildReport(loaded, config, run, reference);
    validateReport(report);
    assert.equal(report.codeReference, reference);
    assert.equal(report.model.name, 'otro-modelo:latest');
    assert.equal(report.model.digest, null);
    assert.equal(
      report.prompt.sha256,
      createHash('sha256').update(classificationInstructions, 'utf8').digest('hex'),
    );
    assert.equal(
      report.dataset.sha256,
      createHash('sha256')
        .update(await readFile(join(root, path)))
        .digest('hex'),
    );
    assert.equal(report.configuration.timeoutMs, 42);
    assert.equal(report.configuration.providerOrigin, 'https://example.com:8443');
    assert.deepEqual(report.configuration.options, ollamaInference.options);
    assert.deepEqual(report.configuration.format, ollamaInference.format);
    assert.deepEqual(
      report.results.map((result) => result.id),
      loaded.dataset.examples.map((example) => example.id),
    );
    assert.ok(!JSON.stringify(report).includes('PASSWORD_SECRET'));
    assert.ok(!JSON.stringify(report).includes('TOKEN_SECRET'));
    assert.deepEqual(report.execution, {
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
      nodeVersion: process.version,
      platform: process.platform,
      plannedCount: 60,
      attemptedCount: 60,
      validCount: 60,
      correctCount: 20,
      incorrectCount: 40,
      errorCount: 0,
      unattemptedCount: 0,
    });
  }

  assert.notEqual(sha256('fixture prompt'), sha256('fixture prompt actualizado'));
  const changedPath = join(root, 'changed.json');
  await writeFile(changedPath, JSON.stringify({ ...loaded.dataset, version: 2 }));
  assert.notEqual((await loadDataset(changedPath, 'changed.json')).sha256, loaded.sha256);
});

test('I002-AC-09 escritura exclusiva, nombres únicos y validación previa', async (t) => {
  const root = await temporaryProject(t);
  const loaded = await loadDataset(
    join(root, 'evals/datasets/incidents-v1.json'),
    'evals/datasets/incidents-v1.json',
  );
  const run = await runEvaluation(loaded.dataset.examples, {
    async classify() {
      return { category: 'BUG' };
    },
  });
  const report = buildReport(loaded, loadConfig({}), run, null);
  const directory = join(root, 'reports');
  const path = await writeReport(directory, report);
  const original = await readFile(path, 'utf8');
  assert.deepEqual(JSON.parse(original), report);
  await assert.rejects(writeReport(directory, report), { code: 'EEXIST' });
  assert.equal(await readFile(path, 'utf8'), original);

  const another = buildReport(loaded, loadConfig({}), run, null);
  assert.notEqual(another.runId, report.runId);
  await writeReport(directory, another);
  assert.equal((await readdir(directory)).length, 2);

  for (const invalid of [
    { ...report, extra: 'SECRET' },
    { ...report, metrics: { ...report.metrics, accuracy: NaN } },
    { ...report, execution: { ...report.execution, correctCount: 60 } },
    { ...report, complete: false },
    { ...report, results: [{ ...report.results[0], rawResponse: 'SECRET' }] },
  ]) {
    assert.throws(() => validateReport(invalid));
  }
});

test('I002-AC-02 configuración/dataset inválidos no invocan proveedor', async (t) => {
  const root = await temporaryProject(t);
  let calls = 0;
  const factory = () => {
    calls++;
    throw new Error('No debe instanciarse');
  };
  const invalidConfig = await executeEvaluation(root, { OLLAMA_TIMEOUT_MS: '0' }, factory);
  assert.equal(invalidConfig.exitCode, 1);
  await writeFile(join(root, 'evals/datasets/incidents-v1.json'), '{}');
  assert.equal((await executeEvaluation(root, {}, factory)).exitCode, 1);
  assert.equal(calls, 0);
  await assert.rejects(readdir(join(root, 'evals/reports')), { code: 'ENOENT' });
});

test('I002-AC-09 informe completo con errores técnicos sale con código 0', async (t) => {
  const root = await temporaryProject(t);
  let calls = 0;
  const response = await executeEvaluation(root, {}, () => ({
    async classify() {
      calls++;
      throw new ClassificationError('connection_error');
    },
  }));
  assert.equal(response.exitCode, 0);
  assert.equal(calls, 60);
  const summary = JSON.parse(response.output);
  assert.equal(summary.complete, true);
  assert.equal(summary.counts.errorCount, 60);
  assert.equal(summary.metrics.accuracy, null);
  assert.equal(summary.metrics.executionSuccessRate, 0);
});

test('I002-AC-09 I002-AC-10 I002-AC-11 informe parcial y fallo de escritura son no cero sin fugas', async (t) => {
  const root = await temporaryProject(t);
  let calls = 0;
  const response = await executeEvaluation(root, {}, () => ({
    async classify() {
      calls++;
      if (calls === 2) {
        throw new TypeError('PROVIDER_SECRET');
      }
      return { category: 'BUG' };
    },
  }));
  assert.equal(response.exitCode, 1);
  assert.equal(calls, 2);
  const summary = JSON.parse(response.output);
  const report = JSON.parse(await readFile(join(root, summary.reportPath), 'utf8'));
  validateReport(report);
  assert.equal(report.complete, false);
  assert.equal(report.termination, 'unexpected_error');
  assert.equal(report.metrics, null);
  assert.equal(report.execution.attemptedCount, 2);
  assert.equal(report.execution.unattemptedCount, 58);

  for (const marker of ['DESCRIPTION_SECRET', 'REFERENCE_SECRET', 'PROVIDER_SECRET']) {
    assert.ok(!response.output.includes(marker));
    assert.ok(!JSON.stringify(report).includes(marker));
  }

  const unwritableRoot = await temporaryProject(t);
  await writeFile(join(unwritableRoot, 'evals/reports'), 'directory blocked by a file');
  const failed = await executeEvaluation(unwritableRoot, {}, () => ({
    async classify() {
      return { category: 'BUG' };
    },
  }));
  assert.equal(failed.exitCode, 1);
  assert.ok(!failed.output.includes('reportPath'));
  assert.ok(!failed.output.includes('guardado correctamente'));
});

test('I002-AC-11 informes ignorados por Git, dataset versionable', () => {
  const ignored = execFileSync('git', ['check-ignore', 'evals/reports/example.json'], {
    encoding: 'utf8',
  });
  assert.equal(ignored.trim(), 'evals/reports/example.json');
  assert.throws(() =>
    execFileSync('git', ['check-ignore', 'evals/datasets/incidents-v1.json'], { stdio: 'pipe' }),
  );
});
