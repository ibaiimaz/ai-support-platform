import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { OllamaClassifier } from '../../infrastructure/ollama/ollama-classifier.js';
import { loadConfig, type Config } from '../../config.js';
import type { IncidentClassifier } from '../../application/incident-classifier.js';
import { runEvaluation } from '../run-evaluation.js';
import { sha256 } from '../dataset.js';
import { persist, synchronization, type DiskSynchronization } from '../durable-files.js';
import { createObserver, type Observer, type Snapshot } from '../model-comparison/observer.js';
import { startMemorySampler } from '../model-comparison/memory.js';
import { withLedger, reserve } from './budget.js';
import { captureCodeIdentity, type CodeVerification } from './code-state.js';
import {
  loadOperation,
  loadFrozenInputs,
  requirePermission,
  approved,
  models,
  type Model,
  type Operation,
} from './protocol.js';
import {
  buildIndependentReport,
  validateIndependentReport,
  writeIndependentReport,
  type Termination,
} from './report.js';

export interface Dependencies {
  observer: (operation: Operation) => Observer;
  classifier: (config: Config) => IncidentClassifier;
  synchronization?: DiskSynchronization;
  code?: (root: string) => CodeVerification;
}

function verifySnapshot(snapshot: Snapshot, op: Operation, model: Model) {
  if (
    !isDeepStrictEqual(snapshot.identity, op.models[model]) ||
    snapshot.ollamaVersion !== op.environment.ollamaVersion ||
    snapshot.hostSha256 !== op.environment.hostSha256 ||
    sha256(JSON.stringify(snapshot.host)) !== snapshot.hostSha256
  ) {
    throw new Error('Identidad o entorno no aprobado.');
  }
}

export async function executeIndependent(
  root: string,
  model: Model,
  deps: Dependencies = {
    observer: createObserver,
    classifier: (config) => new OllamaClassifier(config),
  },
  startup?: import('./build-snapshot.js').BuildSnapshot,
) {
  try {
    const preparationStart = performance.now();
    const preparationStartedAt = new Date().toISOString();
    const source = await loadOperation(root);
    const op = source.operation;
    requirePermission(op, model);
    const inputs = await loadFrozenInputs(root);
    const directory = resolve(root, 'evals/reports/i005');
    const disk = deps.synchronization ?? synchronization;
    return await withLedger(
      directory,
      async (ledger, save) => {
        if (!deps.code && !startup) {
          throw new Error('Arranque sin identidad ejecutable.');
        }
        const code = deps.code ? deps.code(root) : captureCodeIdentity(root, startup!);
        const attempt = reserve(ledger, model, source.protocolSha256, {
          sha256: source.sha256,
          bytes: source.bytes.length,
        });
        for (const prior of ledger.attempts.slice(0, -1)) {
          const bytes = await readFile(join(directory, prior.reportId + '.json'));
          const report: unknown = JSON.parse(bytes.toString('utf8'));
          validateIndependentReport(report, inputs);
          if (
            sha256(bytes) !== prior.reportSha256 ||
            report.reservationId !== prior.id ||
            !report.complete ||
            report.execution.uncertainCount !== 0 ||
            report.model.name !== prior.model ||
            !isDeepStrictEqual(report.results, prior.results) ||
            report.protocolSha256 !== source.protocolSha256 ||
            report.codeReference.buildSha256 !== code.identity.buildSha256 ||
            report.codeReference.sourceSha256 !== code.identity.sourceSha256 ||
            report.codeReference.compilerVersion !== code.identity.compilerVersion
          ) {
            throw new Error('Brazo previo divergente.');
          }
        }
        if (
          model === 'gemma3:12b' &&
          (!approved(op.llamaReview) ||
            op.llamaReview.reportSha256 !== ledger.attempts[0]!.reportSha256)
        ) {
          throw new Error('Falta revisión humana de Llama.');
        }
        const observer = deps.observer(op);
        for (const name of models) {
          verifySnapshot(await observer.snapshot(name), op, name);
        }
        const snapshot = await observer.snapshot(model);
        verifySnapshot(snapshot, op, model);
        const residency = [await observer.prepare()];
        if (residency[0]!.models.length !== 0) {
          throw new Error('Residencia inicial no vacía.');
        }
        let measurable = false;
        try {
          measurable = (await observer.readMemory()).length > 0;
        } catch {
          measurable = false;
        }
        if (!measurable && !approved(op.environment.memoryUnavailable)) {
          throw new Error('Memoria requiere revisión previa.');
        }
        const operationPath = join(directory, source.sha256 + '.operation.json');
        try {
          await persist(operationPath, source.bytes.toString('utf8'), true, disk);
        } catch (error) {
          if (
            !(error instanceof Error && 'code' in error && error.code === 'EEXIST') ||
            sha256(await readFile(operationPath)) !== source.sha256
          ) {
            throw error;
          }
        }
        // Persist reservation and linked snapshot before creating a provider.
        await save();
        const classifier = deps.classifier(
          loadConfig({
            OLLAMA_BASE_URL: op.protocol.providerOrigin,
            OLLAMA_MODEL: model,
            OLLAMA_TIMEOUT_MS: '45000',
          }),
        );
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
        let persistenceFailed = false;
        const verifyCode = () => {
          try {
            code.verify();
          } catch (error) {
            termination ??= 'code_changed';
            throw error;
          }
        };
        const progress = async () => {
          try {
            await save();
          } catch (error) {
            persistenceFailed = true;
            throw error;
          }
        };
        try {
          for (const example of inputs.loaded.dataset.examples) {
            if ((await loadOperation(root)).sha256 !== source.sha256) {
              throw new Error('Permisos o configuración cambiados.');
            }
            await loadFrozenInputs(root);
            verifyCode();
            attempt.attempted++;
            await progress();
            const result = (await runEvaluation([example], classifier)).results[0]!;
            attempt.results.push(result);
            await progress();
            if (result.status === 'error' && result.errorKind === 'unexpected_error') {
              termination = 'unexpected_error';
            } else if (result.status === 'error' && result.errorKind === 'timeout') {
              // No acknowledgement of quiescence exists; never start another inference.
              termination = 'timeout_not_quiescent';
            } else if (result.status === 'error' && result.errorKind === 'connection_error') {
              termination = 'transport_not_quiescent';
            }
            const resident = await observer.residency();
            residency.push(resident);
            if (
              resident.models.length > 1 ||
              resident.models.some(
                (r) => r.model !== model || r.digest !== snapshot.identity.digest,
              )
            ) {
              termination ??= 'residency_anomaly';
              throw new Error('Residencia divergente.');
            }
            verifySnapshot(await observer.snapshot(model), op, model);
            verifyCode();
            if (termination) {
              break;
            }
          }
        } catch {
          termination ??= 'observation_error';
        }
        const memory = await sampler.stop();
        try {
          verifyCode();
        } catch {
          /* Preserve the captured identity in a partial report. */
        }
        if (persistenceFailed) {
          // Existing controls and snapshots remain evidence. Do not mask a failed save with another save.
          throw new Error('Persistencia incierta; revisión obligatoria.');
        }
        const report = buildIndependentReport({
          model,
          operation: op,
          operationSha256: source.sha256,
          inputs,
          reservationId: attempt.id,
          root,
          codeReference: code.identity,
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: performance.now() - start,
          preparation,
          attempted: attempt.attempted,
          results: attempt.results,
          termination,
          snapshot,
          residency,
          memory,
        });
        const written = await writeIndependentReport(directory, report, inputs, disk);
        attempt.status = report.complete ? 'completed' : 'incomplete';
        attempt.permissionClosed = true;
        attempt.reportId = report.runId;
        attempt.reportSha256 = written.sha256;
        await save();
        return {
          exitCode: report.complete ? 0 : 1,
          output: JSON.stringify({
            experimentId: 'I005',
            runId: report.runId,
            model,
            complete: report.complete,
            execution: report.execution,
            reportPath: `evals/reports/i005/${report.runId}.json`,
            reservedTotal: ledger.attempts.reduce((n, a) => n + a.reserved, 0),
            attemptedTotal: ledger.attempts.reduce((n, a) => n + a.attempted, 0),
          }),
        };
      },
      disk,
    );
  } catch {
    return {
      exitCode: 1,
      output:
        'I005 bloqueado o incompleto. Conserve controles y evidencias para revisión; sin reintentos ni recuperación automática.',
    };
  }
}
