import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import { isDeepStrictEqual } from 'node:util';
import { calculateMetrics } from '../metrics.js';
import { analyzeResults } from '../analysis.js';
import { latencySummary } from '../model-comparison/statistics.js';
import { summarizeMemory, type MemorySample } from '../model-comparison/memory.js';
import type { Snapshot, Residency } from '../model-comparison/observer.js';
import { objectSchema, hashSchema, identitySchema } from '../model-comparison/protocol.js';
import { evaluationResultSchema } from '../model-comparison/budget.js';
import { persist, synchronization, type DiskSynchronization } from '../durable-files.js';
import { sha256 } from '../dataset.js';
import { baselinePrompt } from '../prompts.js';
import type { CodeIdentity } from './code-state.js';
import type { EvaluationResult } from '../types.js';
import {
  validateOperation,
  requirePermission,
  protocolHash,
  models,
  type Operation,
  type Model,
  type loadFrozenInputs,
} from './protocol.js';
import { freezeSha256 } from './references.js';

export type FrozenInputs = Awaited<ReturnType<typeof loadFrozenInputs>>;

export type Termination =
  | 'timeout_not_quiescent'
  | 'unexpected_error'
  | 'observation_error'
  | 'transport_not_quiescent'
  | 'residency_anomaly'
  | 'code_changed'
  | null;

export interface ReportInput {
  model: Model;
  operation: Operation;
  operationSha256: string;
  inputs: FrozenInputs;
  reservationId: string;
  root: string;
  codeReference: CodeIdentity;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  preparation: { startedAt: string; finishedAt: string; durationMs: number };
  attempted: number;
  results: EvaluationResult[];
  termination: Termination;
  snapshot: Snapshot;
  residency: Residency[];
  memory: { samples: MemorySample[]; summary: ReturnType<typeof summarizeMemory> };
}

export function residencyAnomalies(
  observations: readonly Residency[],
  model: Model,
  digest: string | null,
) {
  return observations.flatMap((observation, observationIndex) => {
    const reasons: ('initial_residence_not_empty' | 'multiple_models' | 'unexpected_identity')[] =
      [];
    if (observationIndex === 0 && observation.models.length > 0) {
      reasons.push('initial_residence_not_empty');
    }
    if (observation.models.length > 1) {
      reasons.push('multiple_models');
    }
    if (
      observation.models.some((resident) => resident.model !== model || resident.digest !== digest)
    ) {
      reasons.push('unexpected_identity');
    }
    return reasons.length ? [{ observationIndex, reasons }] : [];
  });
}

export function buildIndependentReport(input: ReportInput) {
  const results = structuredClone(input.results);
  const complete = input.termination === null && results.length === 90 && input.attempted === 90;
  const correctCount = results.filter((r) => r.status === 'correct').length;
  const errorCount = results.filter((r) => r.status === 'error').length;
  return {
    schemaVersion: 4 as const,
    experimentId: 'I005' as const,
    runId: randomUUID(),
    complete,
    termination: input.termination,
    model: { name: input.model, requested: input.model, ...input.snapshot.identity },
    freezeManifestSha256: freezeSha256,
    protocolSha256: protocolHash(input.operation),
    operationSha256: input.operationSha256,
    operation: input.operation,
    reservationId: input.reservationId,
    dataset: input.inputs.artifacts.dataset,
    prompt: {
      id: baselinePrompt.id,
      version: baselinePrompt.version,
      sha256: baselinePrompt.sha256,
    },
    configuration: {
      timeoutMs: 45000,
      providerOrigin: input.operation.protocol.providerOrigin,
      ...input.operation.protocol.inference,
      normalization: 'trim',
      execution: 'sequential',
      retries: 0,
    },
    codeReference: structuredClone(input.codeReference),
    preparation: input.preparation,
    execution: {
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      durationMs: input.durationMs,
      plannedCount: 90,
      reservedCount: 90,
      attemptedCount: input.attempted,
      persistedCount: results.length,
      uncertainCount: input.attempted - results.length,
      unattemptedCount: 90 - input.attempted,
      correctCount,
      incorrectCount: results.length - correctCount - errorCount,
      validCount: results.length - errorCount,
      errorCount,
    },
    results,
    metrics: complete
      ? calculateMetrics(
          results,
          input.inputs.loaded.dataset.examples.map((e) => e.expectedCategory),
        )
      : null,
    analysisScope: complete ? 'complete' : 'attempted_only',
    analysis: analyzeResults(results, input.inputs.targets),
    latency: latencySummary(results),
    environment: input.snapshot,
    memory: input.memory,
    residency: input.residency,
    anomalies: {
      residency: residencyAnomalies(input.residency, input.model, input.snapshot.identity.digest),
    },
    promotionAuthorized: false,
  };
}

export type IndependentReport = ReturnType<typeof buildIndependentReport>;

const text = { type: 'string', minLength: 1 };
const count = { type: 'integer', minimum: 0 };
const duration = { type: 'number', minimum: 0 };
const nullable = (s: unknown) => ({ anyOf: [s, { type: 'null' }] });
const time = objectSchema({ startedAt: text, finishedAt: text, durationMs: duration });
const artifact = objectSchema({
  path: text,
  id: text,
  version: { type: 'integer', minimum: 1 },
  encoding: { const: 'UTF-8' },
  bytes: count,
  hashAlgorithm: { const: 'SHA-256' },
  sha256: hashSchema,
});
const host = objectSchema({
  platform: text,
  arch: text,
  release: text,
  cpu: text,
  cpuCount: count,
  totalMemoryBytes: count,
  nodeVersion: text,
});
const sample = objectSchema({
  elapsedMs: duration,
  complete: { type: 'boolean' },
  reason: { enum: [null, 'unavailable', 'unattributed'] },
  processes: {
    type: 'array',
    items: objectSchema({ pid: { type: 'integer', minimum: 1 }, ppid: count, rssKiB: count }),
  },
});
const residency = objectSchema({
  recordedAt: text,
  models: {
    type: 'array',
    maxItems: 64,
    items: objectSchema({
      model: { type: 'string', minLength: 1, maxLength: 256 },
      digest: hashSchema,
      size: duration,
      sizeVram: duration,
      contextLength: nullable(duration),
    }),
  },
});
const schema = new Ajv().compile<IndependentReport>(
  objectSchema({
    schemaVersion: { const: 4 },
    experimentId: { const: 'I005' },
    runId: { type: 'string', pattern: '^[a-f0-9-]{36}$' },
    complete: { type: 'boolean' },
    termination: {
      enum: [
        null,
        'timeout_not_quiescent',
        'unexpected_error',
        'observation_error',
        'transport_not_quiescent',
        'residency_anomaly',
        'code_changed',
      ],
    },
    model: objectSchema({
      name: { enum: models },
      requested: { enum: models },
      ...identitySchema.properties,
    }),
    freezeManifestSha256: { const: freezeSha256 },
    protocolSha256: hashSchema,
    operationSha256: hashSchema,
    operation: { type: 'object' },
    reservationId: text,
    dataset: artifact,
    prompt: {
      const: {
        id: baselinePrompt.id,
        version: baselinePrompt.version,
        sha256: baselinePrompt.sha256,
      },
    },
    configuration: { type: 'object' },
    codeReference: objectSchema({
      commit: nullable(text),
      method: { const: 'typescript_emit_exact' },
      compilerVersion: text,
      sourceSha256: hashSchema,
      buildSha256: hashSchema,
    }),
    preparation: time,
    execution: objectSchema({
      ...time.properties,
      plannedCount: { const: 90 },
      reservedCount: { const: 90 },
      attemptedCount: { type: 'integer', minimum: 0, maximum: 90 },
      persistedCount: count,
      uncertainCount: count,
      unattemptedCount: count,
      correctCount: count,
      incorrectCount: count,
      validCount: count,
      errorCount: count,
    }),
    results: { type: 'array', maxItems: 90, items: evaluationResultSchema },
    metrics: nullable({ type: 'object' }),
    analysisScope: { enum: ['complete', 'attempted_only'] },
    analysis: { type: 'object' },
    latency: { type: 'object' },
    environment: objectSchema({
      identity: identitySchema,
      ollamaVersion: text,
      host,
      hostSha256: hashSchema,
    }),
    memory: objectSchema({
      samples: { type: 'array', minItems: 2, items: sample },
      summary: { type: 'object' },
    }),
    residency: { type: 'array', minItems: 1, items: residency },
    anomalies: objectSchema({
      residency: {
        type: 'array',
        items: objectSchema({
          observationIndex: { type: 'integer', minimum: 0 },
          reasons: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: {
              enum: ['initial_residence_not_empty', 'multiple_models', 'unexpected_identity'],
            },
          },
        }),
      },
    }),
    promotionAuthorized: { const: false },
  }),
);

export function validateIndependentReport(
  value: unknown,
  inputs: FrozenInputs,
): asserts value is IndependentReport {
  if (!schema(value)) {
    throw new Error('Informe I005 inválido.');
  }
  validateOperation(value.operation);
  const op = value.operation;
  requirePermission(op, value.model.name);
  const e = value.execution;
  const references = inputs.loaded.dataset.examples;
  const expectedResults = references.slice(0, value.results.length);
  const correct = value.results.filter((r) => r.status === 'correct').length;
  const errors = value.results.filter((r) => r.status === 'error').length;
  const complete =
    value.termination === null && value.results.length === 90 && e.attemptedCount === 90;
  const expectedMemory = summarizeMemory(value.memory.samples, value.memory.summary.durationMs);
  if (
    value.complete !== complete ||
    (!value.complete && value.termination === null) ||
    value.protocolSha256 !== protocolHash(op) ||
    !isDeepStrictEqual(value.dataset, inputs.artifacts.dataset) ||
    value.model.requested !== value.model.name ||
    !isDeepStrictEqual(value.model, {
      name: value.model.name,
      requested: value.model.name,
      ...op.models[value.model.name],
    }) ||
    !isDeepStrictEqual(value.environment.identity, op.models[value.model.name]) ||
    value.environment.ollamaVersion !== op.environment.ollamaVersion ||
    value.environment.hostSha256 !== op.environment.hostSha256 ||
    sha256(JSON.stringify(value.environment.host)) !== value.environment.hostSha256 ||
    value.results.some((r, i) => {
      const ref = expectedResults[i]!;
      return (
        r.id !== ref.id ||
        r.expectedCategory !== ref.expectedCategory ||
        r.difficulty !== ref.difficulty ||
        !isDeepStrictEqual(r.tags, ref.tags) ||
        (r.status !== 'error' &&
          (r.status === 'correct') !== (r.predictedCategory === r.expectedCategory))
      );
    }) ||
    e.persistedCount !== value.results.length ||
    e.attemptedCount < e.persistedCount ||
    e.attemptedCount - e.persistedCount > 1 ||
    e.uncertainCount !== e.attemptedCount - e.persistedCount ||
    e.unattemptedCount !== 90 - e.attemptedCount ||
    e.correctCount !== correct ||
    e.errorCount !== errors ||
    e.incorrectCount !== value.results.length - correct - errors ||
    e.validCount !== value.results.length - errors ||
    value.analysisScope !== (complete ? 'complete' : 'attempted_only') ||
    !isDeepStrictEqual(
      value.metrics,
      complete
        ? calculateMetrics(
            value.results,
            references.map((r) => r.expectedCategory),
          )
        : null,
    ) ||
    !isDeepStrictEqual(value.analysis, analyzeResults(value.results, inputs.targets)) ||
    !isDeepStrictEqual(value.latency, latencySummary(value.results)) ||
    !isDeepStrictEqual(value.configuration, {
      timeoutMs: 45000,
      providerOrigin: op.protocol.providerOrigin,
      ...op.protocol.inference,
      normalization: 'trim',
      execution: 'sequential',
      retries: 0,
    }) ||
    !Number.isFinite(value.memory.summary.durationMs) ||
    value.memory.summary.durationMs < 0 ||
    !isDeepStrictEqual(value.memory.summary, expectedMemory) ||
    value.memory.samples.some(
      (s, i) => i > 0 && s.elapsedMs < value.memory.samples[i - 1]!.elapsedMs,
    ) ||
    !isDeepStrictEqual(
      value.anomalies.residency,
      residencyAnomalies(value.residency, value.model.name, value.model.digest),
    ) ||
    (complete && value.anomalies.residency.length > 0) ||
    (complete && value.residency.length !== 91) ||
    !Number.isFinite(Date.parse(e.startedAt)) ||
    !Number.isFinite(Date.parse(e.finishedAt)) ||
    Date.parse(e.finishedAt) < Date.parse(e.startedAt)
  ) {
    throw new Error('Informe I005 inconsistente.');
  }
}

export async function writeIndependentReport(
  directory: string,
  report: IndependentReport,
  inputs: FrozenInputs,
  disk: DiskSynchronization = synchronization,
) {
  validateIndependentReport(report, inputs);
  const bytes = JSON.stringify(report, null, 2) + '\n';
  const path = join(directory, report.runId + '.json');
  await persist(path, bytes, true, disk);
  return { path, sha256: sha256(bytes) };
}
