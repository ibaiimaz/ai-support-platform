import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TestContext } from 'node:test';
import { sha256 } from '../../src/evaluation/dataset.js';
import { initializeLedger } from '../../src/evaluation/model-comparison/budget.js';
import {
  models,
  phases,
  type Manifest,
  type Phase,
  type Model,
} from '../../src/evaluation/model-comparison/protocol.js';
import {
  executeModelEvaluation,
  type Dependencies,
} from '../../src/evaluation/model-comparison/execute.js';
import type { ModelReport } from '../../src/evaluation/model-comparison/report.js';
import type { EvaluationDataset } from '../../src/evaluation/types.js';
import type { Classification } from '../../src/domain/classification.js';
import type { Snapshot, Residency } from '../../src/evaluation/model-comparison/observer.js';

export async function project(t: TestContext, initialize = true) {
  const root = await mkdtemp(join(tmpdir(), 'i004-tests-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const folder of ['evals/experiments', 'evals/datasets']) {
    await mkdir(join(root, folder), { recursive: true });
  }
  for (const path of [
    'evals/datasets/incidents-v1.json',
    'evals/experiments/i003-manifest.json',
    'evals/experiments/i004-compatibility-cases.json',
  ]) {
    await writeFile(join(root, path), await readFile(path));
  }
  const manifest = JSON.parse(
    await readFile('evals/experiments/i004-manifest.json', 'utf8'),
  ) as Manifest;
  const host = {
    platform: 'fixture-os',
    arch: 'fixture-arch',
    release: 'fixture-release',
    cpu: 'fixture-cpu',
    cpuCount: 1,
    totalMemoryBytes: 1000000,
    nodeVersion: process.version,
  };
  const approval = { approved: true, approvedBy: 'Fixture reviewer', date: '2026-11-06' };
  manifest.compatibility.review = { ...approval };
  manifest.environment = {
    ollamaVersion: 'fixture-version',
    hostSha256: sha256(JSON.stringify(host)),
    serverPid: 10,
    dedicated: true,
    memoryUnavailable: { approved: false, approvedBy: null, date: null },
  };
  for (const model of models) {
    manifest.models[model] = {
      digest: sha256(model),
      templateSha256: sha256(`template ${model}`),
      parametersSha256: sha256(`parameters ${model}`),
      parameters: `parameters ${model}`,
      quantization: 'Q4_K_M',
      modelContextLength: 4096,
      storedBytes: 1000,
    };
    for (const phase of phases) {
      manifest.authorization[phase][model] = { ...approval };
    }
  }
  const manifestPath = join(root, 'evals/experiments/i004-manifest.json');
  const saveManifest = async () =>
    writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  await saveManifest();
  if (initialize) {
    await initializeLedger(join(root, 'evals/reports/i004'));
  }
  const benchmark = JSON.parse(
    await readFile(join(root, manifest.benchmark.path), 'utf8'),
  ) as EvaluationDataset;
  const compatibility = JSON.parse(
    await readFile(join(root, manifest.compatibility.path), 'utf8'),
  ) as EvaluationDataset;
  const examples = [...benchmark.examples, ...compatibility.examples];
  const expected = new Map(examples.map((e) => [e.description.trim(), e.expectedCategory]));
  let calls = 0;
  let observerCreations = 0;
  let currentModel: Model = models[0];
  let resident: Residency['models'] = [];
  let invocation = 0;
  let transform: (
    description: string,
    model: Model,
    index: number,
  ) => Promise<Classification> = async (description) => ({ category: expected.get(description)! });
  const snapshot = (model: Model): Snapshot => ({
    identity: { ...manifest.models[model] },
    ollamaVersion: 'fixture-version',
    host,
    hostSha256: sha256(JSON.stringify(host)),
  });
  const dependencies: Dependencies = {
    observer() {
      observerCreations++;
      return {
        async snapshot(model) {
          currentModel = model;
          return snapshot(model);
        },
        async prepare() {
          resident = [];
          return { recordedAt: new Date().toISOString(), models: [] };
        },
        async residency() {
          return { recordedAt: new Date().toISOString(), models: resident };
        },
        async readMemory() {
          return [
            { pid: 10, ppid: 1, rssKiB: 100 },
            { pid: 11, ppid: 10, rssKiB: 200 },
          ];
        },
        async confirmIdleAfterTimeout() {
          return true;
        },
      };
    },
    classifier(config) {
      invocation = 0;
      if (config.model !== currentModel || config.timeoutMs !== 45000) {
        throw new Error('Configuración de fixture divergente.');
      }
      return {
        async classify(description) {
          calls++;
          resident = [
            {
              model: currentModel,
              digest: manifest.models[currentModel].digest!,
              size: 2000,
              sizeVram: 1000,
              contextLength: 4096,
            },
          ];
          return transform(description, currentModel, invocation++);
        },
      };
    },
  };
  const run = async (phase: Phase, model: Model) =>
    executeModelEvaluation(root, phase, model, dependencies);
  const readReport = async (output: string) =>
    JSON.parse(await readFile(join(root, JSON.parse(output).reportPath), 'utf8')) as ModelReport;
  const compatibilityRuns = async () => {
    for (const model of models) {
      const result = await run('compatibility', model);
      if (result.exitCode !== 0) {
        throw new Error(result.output);
      }
    }
  };
  return {
    root,
    manifest,
    saveManifest,
    dependencies,
    snapshot,
    benchmark,
    compatibility,
    expected,
    run,
    readReport,
    compatibilityRuns,
    counters: () => ({ calls, observerCreations }),
    setClassifier: (fn: typeof transform) => {
      transform = fn;
    },
  };
}
