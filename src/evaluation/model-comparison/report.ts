import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import { isDeepStrictEqual } from 'node:util';
import { buildReport } from '../report.js';
import { calculateMetrics } from '../metrics.js';
import { analyzeResults } from '../analysis.js';
import { baselinePrompt } from '../prompts.js';
import { sha256 } from '../dataset.js';
import { latencySummary } from './statistics.js';
import { summarizeMemory, type MemorySample } from './memory.js';
import { evaluationResultSchema } from './budget.js';
import {
  validateManifest,
  objectSchema,
  hashSchema,
  identitySchema,
  models,
  phases,
  type Manifest,
  type Model,
  type Phase,
} from './protocol.js';
import type { Residency, Snapshot } from './observer.js';
import type { EvaluationRun, LoadedDataset } from '../types.js';
import type { Config } from '../../config.js';

export type Termination =
  'compatibility_error' | 'unexpected_error' | 'observation_error' | 'timeout_not_quiescent' | null;

export function buildModelReport(input: {
  loaded: LoadedDataset;
  config: Config;
  run: EvaluationRun;
  phase: Phase;
  model: Model;
  manifest: Manifest;
  manifestSha256: string;
  protocolSha256: string;
  reservationId: string;
  snapshot: Snapshot;
  memory: { samples: MemorySample[]; summary: ReturnType<typeof summarizeMemory> };
  residency: Residency[];
  termination: Termination;
  codeReference: string | null;
  preparation: { startedAt: string; finishedAt: string; durationMs: number };
}) {
  const base = buildReport(input.loaded, input.config, input.run, input.codeReference);
  return {
    ...base,
    schemaVersion: 3 as const,
    runId: randomUUID(),
    termination: input.termination,
    model: {
      provider: 'ollama' as const,
      name: input.model,
      requested: input.model,
      ...input.snapshot.identity,
    },
    prompt: { ...base.prompt, id: baselinePrompt.id, version: baselinePrompt.version },
    experiment: {
      id: 'I004' as const,
      phase: input.phase,
      manifestSha256: input.manifestSha256,
      protocolSha256: input.protocolSha256,
      reservationId: input.reservationId,
    },
    manifest: input.manifest,
    preparation: input.preparation,
    environment: input.snapshot,
    memory: input.memory,
    residency: input.residency,
    analysisScope: 'attempted_only' as const,
    analysis: analyzeResults(input.run.results, input.manifest.targets),
    latency: latencySummary(input.run.results),
  };
}

export type ModelReport = ReturnType<typeof buildModelReport>;

const text = { type: 'string', minLength: 1 };
const count = { type: 'integer', minimum: 0 };
const duration = { type: 'number', minimum: 0 };
const nullable = (schema: unknown) => ({ anyOf: [schema, { type: 'null' }] });
const hostSchema = objectSchema({
  platform: text,
  arch: text,
  release: text,
  cpu: text,
  cpuCount: { type: 'integer', minimum: 1 },
  totalMemoryBytes: { type: 'integer', minimum: 1 },
  nodeVersion: text,
});
const processSchema = objectSchema({
  pid: { type: 'integer', minimum: 1 },
  ppid: count,
  rssKiB: count,
});
const residentSchema = objectSchema({
  recordedAt: text,
  models: {
    type: 'array',
    items: objectSchema({
      model: text,
      digest: hashSchema,
      size: duration,
      sizeVram: duration,
      contextLength: nullable(duration),
    }),
  },
});
const validateSchema = new Ajv().compile<ModelReport>(
  objectSchema({
    schemaVersion: { const: 3 },
    runId: text,
    complete: { type: 'boolean' },
    termination: {
      enum: [
        null,
        'compatibility_error',
        'unexpected_error',
        'observation_error',
        'timeout_not_quiescent',
      ],
    },
    dataset: objectSchema({
      id: text,
      version: { type: 'integer', minimum: 1 },
      sha256: hashSchema,
      path: text,
      plannedCount: { enum: [3, 60] },
      distribution: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: objectSchema({
          category: { enum: ['BUG', 'FEATURE', 'QUESTION'] },
          count,
          difficulties: objectSchema({ obvious: count, complex: count, adversarial: count }),
        }),
      },
    }),
    model: objectSchema({
      provider: { const: 'ollama' },
      name: { enum: models },
      requested: { enum: models },
      ...identitySchema.properties,
    }),
    prompt: objectSchema({
      sha256: { const: baselinePrompt.sha256 },
      module: { const: baselinePrompt.module },
      id: { const: baselinePrompt.id },
      version: { const: baselinePrompt.version },
    }),
    configuration: objectSchema({
      timeoutMs: { const: 45000 },
      providerOrigin: text,
      endpoint: { const: '/api/chat' },
      stream: { const: false },
      options: { type: 'object' },
      format: { type: 'object' },
      normalization: { const: 'trim' },
      execution: { const: 'sequential' },
      retries: { const: 0 },
    }),
    codeReference: nullable(text),
    execution: objectSchema({
      startedAt: text,
      finishedAt: text,
      durationMs: duration,
      nodeVersion: text,
      platform: text,
      plannedCount: { enum: [3, 60] },
      attemptedCount: count,
      validCount: count,
      correctCount: count,
      incorrectCount: count,
      errorCount: count,
      unattemptedCount: count,
    }),
    results: { type: 'array', maxItems: 60, items: evaluationResultSchema },
    metrics: nullable({ type: 'object' }),
    experiment: objectSchema({
      id: { const: 'I004' },
      phase: { enum: phases },
      manifestSha256: hashSchema,
      protocolSha256: hashSchema,
      reservationId: text,
    }),
    manifest: { type: 'object' },
    preparation: objectSchema({ startedAt: text, finishedAt: text, durationMs: duration }),
    environment: objectSchema({
      identity: identitySchema,
      ollamaVersion: text,
      host: hostSchema,
      hostSha256: hashSchema,
    }),
    memory: objectSchema({
      samples: {
        type: 'array',
        minItems: 2,
        items: objectSchema({
          elapsedMs: duration,
          processes: { type: 'array', items: processSchema },
          complete: { type: 'boolean' },
          reason: { enum: [null, 'unavailable', 'unattributed'] },
        }),
      },
      summary: { type: 'object' },
    }),
    residency: { type: 'array', minItems: 1, items: residentSchema },
    analysisScope: { const: 'attempted_only' },
    analysis: { type: 'object' },
    latency: { type: 'object' },
  }),
);

export function validateModelReport(value: unknown): asserts value is ModelReport {
  if (!validateSchema(value)) {
    throw new Error('Informe I004 inválido.');
  }
  validateManifest(value.manifest);
  const m = value.manifest;
  const phase = value.experiment.phase;
  const identity = m.models[value.model.name];
  const { authorization: _authorization, ...frozen } = m;
  const dataset = phase === 'benchmark' ? m.benchmark : m.compatibility;
  const planned = phase === 'benchmark' ? 60 : 3;
  const results = value.results;
  const correct = results.filter((r) => r.status === 'correct').length;
  const errors = results.filter((r) => r.status === 'error').length;
  const plannedCategories = ['BUG', 'FEATURE', 'QUESTION'].flatMap((c) =>
    Array.from({ length: planned / 3 }, () => c),
  ) as ('BUG' | 'FEATURE' | 'QUESTION')[];
  const expectedDistribution = ['BUG', 'FEATURE', 'QUESTION'].map((category) => ({
    category,
    count: planned / 3,
    difficulties:
      phase === 'benchmark'
        ? { obvious: 10, complex: 7, adversarial: 3 }
        : { obvious: 1, complex: 0, adversarial: 0 },
  }));
  const expectedMetrics = value.complete ? calculateMetrics(results, plannedCategories) : null;
  if (
    value.model.name !== value.model.requested ||
    !identity.digest ||
    !isDeepStrictEqual(value.environment.identity, identity) ||
    !isDeepStrictEqual(value.model, {
      provider: 'ollama',
      name: value.model.name,
      requested: value.model.name,
      ...identity,
    }) ||
    value.environment.hostSha256 !== sha256(JSON.stringify(value.environment.host)) ||
    value.environment.hostSha256 !== m.environment.hostSha256 ||
    value.environment.ollamaVersion !== m.environment.ollamaVersion ||
    value.experiment.protocolSha256 !== sha256(JSON.stringify(frozen)) ||
    value.dataset.sha256 !== dataset.sha256 ||
    value.dataset.id !== dataset.id ||
    value.dataset.version !== dataset.version ||
    value.dataset.path !== dataset.path ||
    !isDeepStrictEqual(value.dataset.distribution, expectedDistribution) ||
    value.dataset.plannedCount !== planned ||
    value.execution.plannedCount !== planned ||
    results.length > planned ||
    new Set(results.map((r) => r.id)).size !== results.length ||
    results.some(
      (r) =>
        r.status !== 'error' &&
        (r.status === 'correct') !== (r.expectedCategory === r.predictedCategory),
    ) ||
    value.execution.attemptedCount !== results.length ||
    value.execution.correctCount !== correct ||
    value.execution.incorrectCount !== results.length - correct - errors ||
    value.execution.errorCount !== errors ||
    value.execution.validCount !== results.length - errors ||
    value.execution.unattemptedCount !== planned - results.length ||
    (value.complete && (results.length !== planned || value.termination !== null)) ||
    (!value.complete && value.termination === null) ||
    (phase === 'compatibility' && value.complete && errors > 0) ||
    !isDeepStrictEqual(value.metrics, expectedMetrics) ||
    !isDeepStrictEqual(value.analysis, analyzeResults(results, m.targets)) ||
    !isDeepStrictEqual(value.latency, latencySummary(results)) ||
    !isDeepStrictEqual(
      value.memory.summary,
      summarizeMemory(value.memory.samples, value.memory.summary.durationMs),
    ) ||
    !isDeepStrictEqual(value.configuration, {
      timeoutMs: 45000,
      providerOrigin: m.protocol.providerOrigin,
      ...m.protocol.inference,
      normalization: 'trim',
      execution: 'sequential',
      retries: 0,
    }) ||
    !Number.isFinite(value.memory.summary.durationMs) ||
    value.memory.summary.durationMs < 0 ||
    (value.complete &&
      (value.residency.length !== results.length + 1 ||
        value.residency[0]!.models.length !== 0 ||
        value.residency.some(
          (snapshot) =>
            snapshot.models.length > 1 ||
            snapshot.models.some(
              (resident) =>
                resident.model !== value.model.name || resident.digest !== identity.digest,
            ),
        ))) ||
    !Number.isFinite(Date.parse(value.execution.startedAt)) ||
    !Number.isFinite(Date.parse(value.execution.finishedAt))
  ) {
    throw new Error('Informe I004 inconsistente.');
  }
}

export async function writeModelReport(directory: string, report: ModelReport) {
  validateModelReport(report);
  await mkdir(directory, { recursive: true });
  const bytes = JSON.stringify(report, null, 2) + '\n';
  const path = join(directory, `${report.runId}.json`);
  await writeFile(path, bytes, { flag: 'wx' });
  return { path, sha256: sha256(bytes) };
}
