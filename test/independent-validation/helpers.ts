import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import type { TestContext } from 'node:test';
import { sha256 } from '../../src/evaluation/dataset.js';
import { initializeLedger } from '../../src/evaluation/independent-validation/budget.js';
import {
  loadFrozenInputs,
  type Operation,
  type Model,
} from '../../src/evaluation/independent-validation/protocol.js';
import { executeCli } from '../../src/evaluation/independent-validation/main.js';
import type { Dependencies } from '../../src/evaluation/independent-validation/execute.js';
import type { Classification } from '../../src/domain/classification.js';
import type { Snapshot, Observer } from '../../src/evaluation/model-comparison/observer.js';
import type { IndependentReport } from '../../src/evaluation/independent-validation/report.js';

export const fixtureCodeIdentity = {
  commit: null,
  method: 'typescript_emit_exact' as const,
  compilerVersion: 'fixture',
  sourceSha256: 'a'.repeat(64),
  buildSha256: 'b'.repeat(64),
};

export async function fixture(t: TestContext, initialize = true) {
  const root = await mkdtemp(join(tmpdir(), 'i005-tests-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const freeze = JSON.parse(await readFile('evals/experiments/i005-manifest.json', 'utf8'));
  for (const name of [
    'evals/experiments/i005-manifest.json',
    'evals/experiments/i005-manifest.json.sha256',
    ...Object.values(freeze.artifacts).map((a) => (a as { path: string }).path),
  ]) {
    await mkdir(resolve(root, name, '..'), { recursive: true });
    await writeFile(join(root, name), await readFile(name));
  }
  const op: Operation = JSON.parse(await readFile('evals/experiments/i005-operation.json', 'utf8'));
  op.environment.serverPid = 10;
  op.environment.dedicated = true;
  const approval = { approved: true, approvedBy: 'Fixture reviewer', date: '2026-11-09' };
  op.authorization.initialize = { ...approval };
  op.authorization['llama3.1:8b'] = { ...approval };
  op.authorization['gemma3:12b'].approved = false;
  const saveOperation = () =>
    writeFile(
      join(root, 'evals/experiments/i005-operation.json'),
      JSON.stringify(op, null, 2) + '\n',
    );
  await saveOperation();
  const inputs = await loadFrozenInputs(root);
  const directory = join(root, 'evals/reports/i005');
  if (initialize) {
    await initializeLedger(directory);
  }
  const host = {
    platform: 'darwin',
    arch: 'arm64',
    release: '25.6.0',
    cpu: 'Apple M2 Max',
    cpuCount: 12,
    totalMemoryBytes: 34359738368,
    nodeVersion: 'v22.22.0',
  };
  let currentModel: Model = 'llama3.1:8b';
  let resident: Model | null = null;
  let observerCreations = 0;
  let active = 0;
  let maxActive = 0;
  const calls: { model: Model; description: string }[] = [];
  let transform: (description: string, index: number) => Promise<Classification> = async (
    description,
  ) => ({
    category: inputs.loaded.dataset.examples.find((e) => e.description.trim() === description)!
      .expectedCategory,
  });
  const snapshot = (model: Model): Snapshot => ({
    identity: structuredClone(op.models[model]),
    host,
    hostSha256: sha256(JSON.stringify(host)),
    ollamaVersion: '0.40.14',
  });
  const observer: Observer = {
    async snapshot(model) {
      currentModel = model;
      return snapshot(model);
    },
    async prepare() {
      resident = null;
      return { recordedAt: new Date().toISOString(), models: [] };
    },
    async residency() {
      return {
        recordedAt: new Date().toISOString(),
        models: resident
          ? [
              {
                model: resident,
                digest: op.models[resident].digest!,
                size: 1000,
                sizeVram: 1000,
                contextLength: 32768,
              },
            ]
          : [],
      };
    },
    async readMemory() {
      return [{ pid: 10, ppid: 1, rssKiB: 100 }];
    },
    async confirmIdleAfterTimeout() {
      throw new Error('No idle heuristic authorized by I005.');
    },
  };
  const dependencies: Dependencies = {
    code: () => ({ identity: fixtureCodeIdentity, verify() {} }),
    observer() {
      observerCreations++;
      return observer;
    },
    classifier(config) {
      if (config.model !== currentModel || config.timeoutMs !== 45000) {
        throw new Error('Fixture configuration mismatch.');
      }
      let index = 0;
      return {
        async classify(description) {
          const ledger = JSON.parse(await readFile(join(directory, 'budget.json'), 'utf8'));
          const attempt = ledger.attempts.at(-1);
          if (
            attempt.reserved !== 90 ||
            attempt.attempted !== index + 1 ||
            attempt.results.length !== index
          ) {
            throw new Error('Attempt must be persisted before provider.');
          }
          calls.push({ model: currentModel, description });
          resident = currentModel;
          active++;
          maxActive = Math.max(maxActive, active);
          try {
            return await transform(description, index++);
          } finally {
            active--;
          }
        },
      };
    },
  };
  const run = (model: Model) =>
    executeCli(root, ['--phase', 'validation', '--model', model], dependencies);
  const report = async (output: string) =>
    JSON.parse(
      await readFile(join(root, JSON.parse(output).reportPath), 'utf8'),
    ) as IndependentReport;
  const approveGemma = async (hash: string) => {
    op.authorization['gemma3:12b'] = { ...approval };
    op.llamaReview = { ...approval, reportSha256: hash };
    await saveOperation();
  };
  return {
    root,
    directory,
    inputs,
    op,
    observer,
    snapshot,
    dependencies,
    saveOperation,
    run,
    report,
    calls,
    counters: () => ({ observerCreations, maxActive }),
    approveGemma,
    setClassifier(fn: typeof transform) {
      transform = fn;
    },
  };
}
