import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { registeredPrompts, baselinePrompt, findPrompt } from '../../src/evaluation/prompts.js';
import { contrastiveExamples } from '../../src/infrastructure/ollama/prompts/h2.js';
import { loadManifest, validateManifest } from '../../src/evaluation/experiment-manifest.js';
import { loadDataset, sha256 } from '../../src/evaluation/dataset.js';
import { executeExperiment, parseExperimentArguments } from '../../src/evaluation/experiment.js';
import {
  validateAnyReport,
  validateReport,
  buildReport,
  writeReport,
} from '../../src/evaluation/report.js';
import { OllamaClassifier } from '../../src/infrastructure/ollama/ollama-classifier.js';
import { classificationInstructions } from '../../src/infrastructure/ollama/classification-instructions.js';
import { buildApp } from '../../src/http/app.js';
import { runEvaluation } from '../../src/evaluation/run-evaluation.js';
import { experimentProject, fixturePair } from './helpers.js';
import { ollamaInference } from '../../src/infrastructure/ollama/inference-descriptor.js';

test('I003-AC-01 I003-AC-04 candidatos registrados y baseline inmutable', async () => {
  const { manifest } = await loadManifest(process.cwd());
  validateManifest(manifest);
  assert.equal(
    baselinePrompt.sha256,
    'ea81fca7322e307986b0ab3739fc9d73ad2384cc2361da8a0b28cfedf659a9ef',
  );
  assert.equal(registeredPrompts.length, 5);
  assert.equal(new Set(registeredPrompts.map((prompt) => prompt.sha256)).size, 5);

  for (const prompt of registeredPrompts) {
    assert.equal(prompt.sha256, createHash('sha256').update(prompt.text).digest('hex'));
    assert.equal(prompt.byteLength, Buffer.byteLength(prompt.text));
    assert.ok(Object.isFrozen(prompt));
    assert.ok(prompt.risks.length > 0);
  }

  const changed = structuredClone(manifest);
  changed.prompts[0]!.sha256 = 'a'.repeat(64);
  assert.throws(() => validateManifest(changed));
  const duplicate = structuredClone(manifest);
  duplicate.prompts[1] = duplicate.prompts[0]!;
  assert.throws(() => validateManifest(duplicate));
});

test('I003-AC-05 validación candidata 60 casos y H2 sin coincidencias exactas', async () => {
  const { manifest } = await loadManifest(process.cwd());
  const development = await loadDataset(
    manifest.datasets.development.path,
    manifest.datasets.development.path,
  );
  const validation = await loadDataset(
    manifest.datasets.validation.path,
    manifest.datasets.validation.path,
  );
  assert.equal(
    development.sha256,
    'e17fcb2ea94126809319133a9ba78fa1108e7efe21ed62f45c88167bebe72c90',
  );
  assert.equal(validation.sha256, manifest.datasets.validation.sha256);
  assert.equal(validation.dataset.examples.length, 60);
  const ids = new Set(development.dataset.examples.map((example) => example.id));
  const text = new Set(development.dataset.examples.map((example) => example.description.trim()));
  assert.ok(
    validation.dataset.examples.every(
      (example) => !ids.has(example.id) && !text.has(example.description.trim()),
    ),
  );
  const allTexts = new Set(
    [...development.dataset.examples, ...validation.dataset.examples].map((example) =>
      example.description.trim(),
    ),
  );
  assert.ok(contrastiveExamples.every((example) => !allTexts.has(example.description.trim())));
  assert.equal(manifest.preparation.isolation, 'procedural');
});

test('I003-AC-02 I003-AC-03 I003-AC-13 candidato en evaluación no cambia HTTP original', async (t) => {
  const { root } = await experimentProject(t);
  const payloads: { messages: { role: string; content: string }[] }[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: unknown, options?: RequestInit) => {
    payloads.push(JSON.parse(String(options?.body)));
    return new Response(
      JSON.stringify({
        done: true,
        done_reason: 'stop',
        message: { role: 'assistant', content: '{"category":"BUG"}' },
      }),
    );
  });
  const control = await executeExperiment(root, 'development', 'i001-original', {});
  assert.equal(control.exitCode, 0, control.output);
  payloads.length = 0;
  const response = await executeExperiment(root, 'development', 'h2', {});
  assert.equal(response.exitCode, 0, response.output);
  const output = JSON.parse(response.output);
  const report = JSON.parse(await readFile(join(root, output.reportPath), 'utf8'));
  validateAnyReport(report);
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.prompt.sha256, sha256(payloads[0]!.messages[0]!.content));
  assert.equal(report.prompt.sha256, findPrompt('h2').sha256);
  assert.ok(
    payloads.every(
      (payload) =>
        payload.messages.length === 2 &&
        payload.messages[0]?.role === 'system' &&
        payload.messages[1]?.role === 'user',
    ),
  );
  assert.equal(payloads.length, 60);
  const app = buildApp(
    new OllamaClassifier({
      baseUrl: 'http://localhost:11434',
      model: 'llama3.1:8b',
      timeoutMs: 30000,
    }),
  );
  t.after(() => app.close());
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/incidents/classify',
        payload: { description: 'Incidencia de prueba.' },
      })
    ).statusCode,
    200,
  );
  assert.equal(payloads.at(-1)!.messages[0]!.content, classificationInstructions);
  assert.equal(sha256(classificationInstructions), baselinePrompt.sha256);
  const source = await readFile('src/main.ts', 'utf8');
  assert.ok(source.includes('new OllamaClassifier(loadConfig())'));
});

test('I003-AC-03 informes históricos I002 conservan formato y validación', async (t) => {
  const { root, dataset } = await experimentProject(t);
  const path = 'evals/datasets/incidents-v1.json';
  const loaded = await loadDataset(join(root, path), path);
  const run = await runEvaluation(dataset.examples, {
    async classify() {
      return { category: 'BUG' };
    },
  });
  const report = buildReport(
    loaded,
    { baseUrl: 'http://localhost:11434', model: 'llama3.1:8b', timeoutMs: 30000 },
    run,
    null,
  );
  assert.equal(report.schemaVersion, 1);
  validateReport(report);
  validateAnyReport(report);
  const saved = await writeReport(join(root, 'historical'), report);
  assert.deepEqual(JSON.parse(await readFile(saved, 'utf8')), report);
  assert.equal(report.prompt.sha256, baselinePrompt.sha256);
});

test('I003-AC-04 I003-AC-05 autorización, aprobación y hash bloquean antes de inferir', async (t) => {
  let calls = 0;
  const createClassifier = () => {
    calls++;
    throw new Error('No debe crearse el proveedor');
  };
  const unauthorized = await experimentProject(t, { developmentAuthorized: false });
  assert.deepEqual(unauthorized.manifest.authorization, { development: false, validation: false });
  assert.equal(unauthorized.manifest.datasets.validation.reviewStatus, 'pending');
  assert.equal(unauthorized.manifest.datasets.validation.frozen, false);
  assert.equal(unauthorized.manifest.datasets.validation.approvedBy, null);
  assert.equal(unauthorized.manifest.selection.promptId, null);
  assert.equal(
    (await executeExperiment(unauthorized.root, 'development', 'h1', {}, createClassifier))
      .exitCode,
    1,
  );
  const { root, manifest } = await experimentProject(t);
  assert.equal(
    (await executeExperiment(root, 'validation', 'h1', {}, createClassifier)).exitCode,
    1,
  );
  assert.equal(
    (await executeExperiment(root, 'development', 'h1', { OLLAMA_MODEL: 'otro' }, createClassifier))
      .exitCode,
    1,
  );
  manifest.datasets.development.sha256 = 'f'.repeat(64);
  await writeFile(join(root, 'evals/experiments/i003-manifest.json'), JSON.stringify(manifest));
  assert.equal(
    (await executeExperiment(root, 'development', 'h1', {}, createClassifier)).exitCode,
    1,
  );
  assert.equal(calls, 0);
  await assert.rejects(readdir(join(root, 'evals/reports')), { code: 'ENOENT' });
  for (const validationApproved of [false, true]) {
    const fixture = await experimentProject(t, { validationApproved });
    assert.equal(fixture.manifest.authorization.development, true);
    assert.equal(fixture.manifest.authorization.validation, false);
    assert.equal(fixture.manifest.datasets.validation.frozen, validationApproved);
    assert.equal(
      fixture.manifest.datasets.validation.reviewStatus,
      validationApproved ? 'approved' : 'pending',
    );
    assert.equal(
      (await executeExperiment(fixture.root, 'validation', 'i001-original', {}, createClassifier))
        .exitCode,
      1,
    );
  }

  const pending = await experimentProject(t, { validationAuthorized: true });
  assert.equal(
    (await executeExperiment(pending.root, 'validation', 'i001-original', {}, createClassifier))
      .exitCode,
    1,
  );
  assert.equal(calls, 0);

  for (const phase of ['development', 'validation'] as const) {
    const fixture = await experimentProject(t, {
      validationAuthorized: phase === 'validation',
      validationApproved: true,
    });
    let inferences = 0;
    let compositions = 0;
    const result = await executeExperiment(
      fixture.root,
      phase,
      'i001-original',
      {},
      (config, text) => {
        compositions++;
        assert.equal(config.model, 'llama3.1:8b');
        assert.equal(text, classificationInstructions);
        return {
          async classify() {
            inferences++;
            return { category: 'BUG' };
          },
        };
      },
    );
    assert.equal(result.exitCode, 0, result.output);
    assert.equal(compositions, 1);
    assert.equal(inferences, 60);
  }

  for (const missing of ['approval', 'freeze'] as const) {
    const fixture = await experimentProject(t, {
      validationAuthorized: true,
      validationApproved: true,
    });
    if (missing === 'approval') {
      fixture.manifest.datasets.validation.reviewStatus = 'pending';
      fixture.manifest.datasets.validation.approvedBy = null;
      fixture.manifest.preparation.validationApproved = false;
    } else {
      fixture.manifest.datasets.validation.frozen = false;
    }
    await writeFile(
      join(fixture.root, 'evals/experiments/i003-manifest.json'),
      JSON.stringify(fixture.manifest),
    );
    assert.equal(
      (await executeExperiment(fixture.root, 'validation', 'i001-original', {}, createClassifier))
        .exitCode,
      1,
    );
    await assert.rejects(readdir(join(fixture.root, 'evals/reports')), { code: 'ENOENT' });
  }
  assert.equal(calls, 0);
  assert.deepEqual(parseExperimentArguments(['--prompt', 'h1', '--phase', 'development']), {
    promptId: 'h1',
    phase: 'development',
  });
  for (const args of [
    [],
    ['--prompt', 'h1'],
    ['--prompt', 'h1', '--phase', 'unknown'],
    ['--prompt', 'unknown', '--phase', 'development'],
    ['--prompt', 'h1', '--prompt', 'h2'],
  ]) {
    assert.throws(() => parseExperimentArguments(args));
  }
});

test('I003-AC-01 I003-AC-02 I003-AC-03 I003-AC-04 H4 seleccionable y compatible sin Ollama', async (t) => {
  const prompt = findPrompt('h4');
  assert.equal(prompt.version, 1);
  assert.equal(prompt.role, 'candidate');
  assert.equal(prompt.module, 'src/infrastructure/ollama/prompts/h4.ts');
  assert.equal(prompt.sha256, 'dd75c06bc6af00966cc27ad7795d0e89a695e3075f0076b332482c5aa7a8e4a4');
  assert.equal(prompt.byteLength, 1605);
  assert.ok(prompt.text.startsWith(`${classificationInstructions}\n\n`));
  assert.deepEqual(parseExperimentArguments(['--prompt', 'h4', '--phase', 'development']), {
    promptId: 'h4',
    phase: 'development',
  });
  const documentation = await readFile('evals/experiments/i003-candidates.md', 'utf8');
  const documentedText = documentation
    .split('## h4 — versión 1')[1]!
    .split('```text\n')[1]!
    .split('\n```')[0];
  assert.equal(documentedText, prompt.text);
  const { candidate, config, manifest } = await fixturePair(t, 'h4');
  validateAnyReport(candidate);
  assert.equal(candidate.prompt.id, 'h4');
  assert.equal(candidate.prompt.sha256, prompt.sha256);
  assert.ok(manifest.prompts.some((entry) => entry.id === 'h4' && entry.sha256 === prompt.sha256));

  const payloads: Record<string, unknown>[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: unknown, options?: RequestInit) => {
    payloads.push(JSON.parse(String(options?.body)));
    return new Response(
      JSON.stringify({
        done: true,
        done_reason: 'stop',
        message: { role: 'assistant', content: '{"category":"BUG"}' },
      }),
    );
  });
  const description = 'Incidencia sintética del proveedor simulado.';
  assert.deepEqual(await new OllamaClassifier(config, prompt.text).classify(description), {
    category: 'BUG',
  });
  assert.deepEqual(payloads[0], {
    model: config.model,
    stream: ollamaInference.stream,
    options: ollamaInference.options,
    format: ollamaInference.format,
    messages: [
      { role: 'system', content: prompt.text },
      { role: 'user', content: description },
    ],
  });
  await new OllamaClassifier(config).classify(description);
  assert.deepEqual(payloads[1], {
    ...payloads[0],
    messages: [
      { role: 'system', content: classificationInstructions },
      { role: 'user', content: description },
    ],
  });
  assert.equal(payloads.length, 2);
});

test('I003-AC-04 I003-AC-11 autorización baseline-only impide candidatos y repeticiones', async (t) => {
  const { root, manifest } = await experimentProject(t, {
    developmentAuthorized: false,
    validationApproved: true,
  });
  manifest.authorization.validation = 'baseline-only';
  const path = join(root, 'evals/experiments/i003-manifest.json');
  let compositions = 0;
  let inferences = 0;
  const createClassifier = () => {
    compositions++;
    return {
      async classify() {
        inferences++;
        return { category: 'BUG' as const };
      },
    };
  };

  for (const id of ['h1', 'h2', 'h3', 'h4']) {
    manifest.selection = { promptId: id, approvedBy: 'Fixture reviewer' };
    await writeFile(path, JSON.stringify(manifest));
    assert.equal(
      (await executeExperiment(root, 'validation', id, {}, createClassifier)).exitCode,
      1,
    );
  }
  assert.equal(compositions, 0);
  assert.equal(inferences, 0);
  await assert.rejects(readdir(join(root, 'evals/reports')), { code: 'ENOENT' });

  manifest.selection = { promptId: null, approvedBy: null };
  await writeFile(path, JSON.stringify(manifest));
  assert.equal(
    (await executeExperiment(root, 'development', 'i001-original', {}, createClassifier)).exitCode,
    1,
  );
  assert.equal(compositions, 0);
  const allowed = await executeExperiment(
    root,
    'validation',
    'i001-original',
    {},
    createClassifier,
  );
  assert.equal(allowed.exitCode, 0, allowed.output);
  assert.equal(compositions, 1);
  assert.equal(inferences, 60);
  assert.equal(
    (await executeExperiment(root, 'validation', 'i001-original', {}, createClassifier)).exitCode,
    1,
  );
  assert.equal(inferences, 60);

  manifest.authorization.validation = false;
  await writeFile(path, JSON.stringify(manifest));
  const priorCompositions = compositions;
  assert.equal(
    (await executeExperiment(root, 'validation', 'i001-original', {}, createClassifier)).exitCode,
    1,
  );
  assert.equal(compositions, priorCompositions);
  assert.equal(inferences, 60);

  const invalid = structuredClone(manifest);
  const invalidAuthorization = { ...invalid.authorization, development: 'baseline-only' };
  assert.throws(() => validateManifest({ ...invalid, authorization: invalidAuthorization }));
});
