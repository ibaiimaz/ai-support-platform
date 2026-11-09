import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { OllamaClassifier } from '../../infrastructure/ollama/ollama-classifier.js';
import { loadConfig, type Config } from '../../config.js';
import type { IncidentClassifier } from '../../application/incident-classifier.js';
import { runEvaluation } from '../run-evaluation.js';
import type { EvaluationRun, LoadedDataset } from '../types.js';
import { sha256 } from '../dataset.js';
import { findCodeReference } from '../code-reference.js';
import {
  loadManifest,
  loadInputs,
  requireAuthorization,
  approved,
  type Phase,
  type Model,
  type Manifest,
} from './protocol.js';
import { withLedger, reserve } from './budget.js';
import { createObserver, type Observer, type Snapshot, type Residency } from './observer.js';
import { startMemorySampler } from './memory.js';
import {
  buildModelReport,
  writeModelReport,
  validateModelReport,
  type Termination,
} from './report.js';

export interface Dependencies {
  observer: (manifest: Manifest) => Observer;
  classifier: (config: Config) => IncidentClassifier;
}

function verifySnapshot(snapshot: Snapshot, manifest: Manifest, model: Model) {
  if (
    !isDeepStrictEqual(snapshot.identity, manifest.models[model]) ||
    snapshot.ollamaVersion !== manifest.environment.ollamaVersion ||
    snapshot.hostSha256 !== manifest.environment.hostSha256 ||
    snapshot.hostSha256 !== sha256(JSON.stringify(snapshot.host))
  ) {
    throw new Error('Entorno o identidad divergentes.');
  }
}

export async function executeModelEvaluation(
  root: string,
  phase: Phase,
  model: Model,
  dependencies: Dependencies = {
    observer: createObserver,
    classifier: (config) => new OllamaClassifier(config),
  },
): Promise<{ exitCode: number; output: string }> {
  try {
    const preparationStart = performance.now();
    const preparationStartedAt = new Date().toISOString();
    const source = await loadManifest(root);
    const manifest = source.manifest;
    requireAuthorization(manifest, phase, model);
    const inputs = await loadInputs(root, manifest);
    const loaded: LoadedDataset =
      phase === 'benchmark'
        ? inputs.benchmark
        : {
            path: manifest.compatibility.path,
            sha256: manifest.compatibility.sha256,
            dataset: inputs.compatibility,
          };
    const directory = resolve(root, 'evals/reports/i004');
    const config = loadConfig({
      OLLAMA_BASE_URL: manifest.protocol.providerOrigin,
      OLLAMA_MODEL: model,
      OLLAMA_TIMEOUT_MS: '45000',
    });
    return await withLedger(directory, async (ledger, save) => {
      // Reserve in memory first to reject duplicates/order before any external observation.
      // No inference or persisted consumption occurs until all preflight checks pass.
      const attempt = reserve(ledger, phase, model, source.protocolSha256);
      for (const prior of ledger.attempts.slice(0, -1)) {
        const bytes = await readFile(join(directory, `${prior.reportId}.json`));
        if (sha256(bytes) !== prior.reportSha256) {
          throw new Error('Evidencia previa alterada.');
        }
        const report: unknown = JSON.parse(bytes.toString('utf8'));
        validateModelReport(report);
        if (
          !report.complete ||
          report.experiment.reservationId !== prior.id ||
          !isDeepStrictEqual(report.results, prior.results) ||
          report.model.name !== prior.model ||
          report.experiment.phase !== prior.phase ||
          report.experiment.protocolSha256 !== source.protocolSha256 ||
          (prior.phase === 'compatibility' && report.execution.errorCount > 0)
        ) {
          throw new Error('Falta compatibilidad completa o control previo.');
        }
      }
      const observer = dependencies.observer(manifest);
      for (const observedModel of ['llama3.1:8b', 'gemma3:12b'] as const) {
        verifySnapshot(await observer.snapshot(observedModel), manifest, observedModel);
      }
      const snapshot = await observer.snapshot(model);
      verifySnapshot(snapshot, manifest, model);
      const residency: Residency[] = [await observer.prepare()];
      if (residency[0]!.models.length !== 0) {
        throw new Error('Residencia inicial no vacía.');
      }
      let memoryAvailable = false;
      try {
        memoryAvailable = (await observer.readMemory()).length > 0;
      } catch {
        memoryAvailable = false;
      }
      if (!memoryAvailable && !approved(manifest.environment.memoryUnavailable)) {
        throw new Error('Memoria no medible; requiere revisión antes de inferir.');
      }
      const manifestPath = join(directory, `${source.sha256}.manifest.json`);
      try {
        await writeFile(manifestPath, source.bytes, { flag: 'wx' });
      } catch (error) {
        if (
          !(error instanceof Error && 'code' in error && error.code === 'EEXIST') ||
          sha256(await readFile(manifestPath)) !== source.sha256
        ) {
          throw error;
        }
      }
      const classifier = dependencies.classifier(config);
      await save();
      const preparation = {
        startedAt: preparationStartedAt,
        finishedAt: new Date().toISOString(),
        durationMs: performance.now() - preparationStart,
      };
      const startedAt = new Date().toISOString();
      const start = performance.now();
      const sampler = startMemorySampler(() => observer.readMemory());
      await sampler.ready;
      let termination: Termination = null;
      try {
        for (const example of loaded.dataset.examples) {
          const current = await loadManifest(root);
          if (current.sha256 !== source.sha256) {
            throw new Error('Manifiesto cambiado durante ejecución.');
          }
          // Persist the attempt before invoking the classifier, including failed/aborted calls.
          attempt.attempted++;
          await save();
          const single = await runEvaluation([example], classifier);
          const result = single.results[0]!;
          attempt.results.push(result);
          await save();
          if (result.status === 'error' && result.errorKind === 'unexpected_error') {
            termination = 'unexpected_error';
          } else if (phase === 'compatibility' && result.status === 'error') {
            termination = 'compatibility_error';
          } else if (
            result.status === 'error' &&
            result.errorKind === 'timeout' &&
            !(await observer.confirmIdleAfterTimeout())
          ) {
            termination = 'timeout_not_quiescent';
          }
          // Metadata calls do not classify and are outside per-case latency.
          const resident = await observer.residency();
          residency.push(resident);
          if (
            resident.models.length > 1 ||
            resident.models.some(
              (item) => item.model !== model || item.digest !== snapshot.identity.digest,
            )
          ) {
            throw new Error('Residencia ajena o divergente.');
          }
          verifySnapshot(await observer.snapshot(model), manifest, model);
          if (termination) {
            break;
          }
        }
      } catch {
        termination ??= 'observation_error';
      }
      const memory = await sampler.stop();
      const complete = termination === null && attempt.results.length === attempt.reserved;
      const run: EvaluationRun = {
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: performance.now() - start,
        complete,
        termination: complete ? null : 'unexpected_error',
        results: attempt.results,
      };
      const report = buildModelReport({
        loaded,
        config,
        run,
        phase,
        model,
        manifest,
        manifestSha256: source.sha256,
        protocolSha256: source.protocolSha256,
        reservationId: attempt.id,
        snapshot,
        memory,
        residency,
        termination: complete ? null : (termination ?? 'observation_error'),
        codeReference: findCodeReference(root),
        preparation,
      });
      const written = await writeModelReport(directory, report);
      attempt.status = complete ? 'completed' : 'incomplete';
      attempt.allowsNext = complete && (phase === 'benchmark' || report.execution.errorCount === 0);
      attempt.reportId = report.runId;
      attempt.reportSha256 = written.sha256;
      await save();
      return {
        exitCode: complete ? 0 : 1,
        output: JSON.stringify({
          experimentId: 'I004',
          runId: report.runId,
          phase,
          model,
          complete,
          reportPath: `evals/reports/i004/${report.runId}.json`,
          execution: report.execution,
          reservedTotal: ledger.attempts.reduce((sum, item) => sum + item.reserved, 0),
          attemptedTotal: ledger.attempts.reduce((sum, item) => sum + item.attempted, 0),
        }),
      };
    });
  } catch {
    return {
      exitCode: 1,
      output:
        'I004 no ejecutado o incompleto. Revise permisos, preflight, presupuesto y evidencia; no se realizarán reintentos.',
    };
  }
}
