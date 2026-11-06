import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import { categories } from '../domain/classification.js';
import type { Config } from '../config.js';
import { classificationInstructions } from '../infrastructure/ollama/classification-instructions.js';
import { ollamaInference } from '../infrastructure/ollama/inference-descriptor.js';
import { sha256 } from './dataset.js';
import { calculateMetrics } from './metrics.js';
import type { RegisteredPrompt } from './prompts.js';
import { difficulties, type EvaluationRun, type LoadedDataset } from './types.js';

export function buildReport(
  loaded: LoadedDataset,
  config: Config,
  run: EvaluationRun,
  codeReference: string | null,
) {
  const examples = loaded.dataset.examples;
  const correctCount = run.results.filter((result) => result.status === 'correct').length;
  const incorrectCount = run.results.filter((result) => result.status === 'incorrect').length;
  const errorCount = run.results.filter((result) => result.status === 'error').length;
  const distribution = categories.map((category) => ({
    category,
    count: examples.filter((example) => example.expectedCategory === category).length,
    difficulties: Object.fromEntries(
      difficulties.map((difficulty) => [
        difficulty,
        examples.filter(
          (example) => example.expectedCategory === category && example.difficulty === difficulty,
        ).length,
      ]),
    ),
  }));

  return {
    schemaVersion: 1 as const,
    runId: randomUUID(),
    complete: run.complete,
    termination: run.termination,
    dataset: {
      id: loaded.dataset.id,
      version: loaded.dataset.version,
      sha256: loaded.sha256,
      path: loaded.path,
      plannedCount: examples.length,
      distribution,
    },
    model: { provider: 'ollama', name: config.model, digest: null },
    prompt: {
      sha256: sha256(classificationInstructions),
      module: 'src/infrastructure/ollama/classification-instructions.ts',
    },
    configuration: {
      timeoutMs: config.timeoutMs,
      providerOrigin: new URL(config.baseUrl).origin,
      ...ollamaInference,
      normalization: 'trim',
      execution: 'sequential',
      retries: 0,
    },
    codeReference,
    execution: {
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
      nodeVersion: process.version,
      platform: process.platform,
      plannedCount: examples.length,
      attemptedCount: run.results.length,
      validCount: correctCount + incorrectCount,
      correctCount,
      incorrectCount,
      errorCount,
      unattemptedCount: examples.length - run.results.length,
    },
    results: run.results,
    metrics: run.complete
      ? calculateMetrics(
          run.results,
          examples.map((example) => example.expectedCategory),
        )
      : null,
  };
}

export type EvaluationReport = ReturnType<typeof buildReport>;

// Local JSON-schema helpers describe only the report format, not provider conversion.
function strictObject(properties: Record<string, unknown>) {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

const text = { type: 'string', minLength: 1 };
const count = { type: 'integer', minimum: 0 };
const duration = { type: 'number', minimum: 0 };
const proportion = { type: 'number', minimum: 0, maximum: 1 };
const nullableProportion = { anyOf: [proportion, { type: 'null' }] };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const timestamp = {
  type: 'string',
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
};
const resultReference = {
  id: text,
  expectedCategory: { enum: [...categories] },
  difficulty: { enum: [...difficulties] },
  tags: { type: 'array', minItems: 1, uniqueItems: true, items: text },
  durationMs: duration,
};
const matrixRow = strictObject(Object.fromEntries(categories.map((category) => [category, count])));
const categoryMetrics = strictObject({
  plannedSupport: count,
  validSupport: count,
  errorCount: count,
  precision: nullableProportion,
  recall: nullableProportion,
  f1: nullableProportion,
});
const metricsSchema = strictObject({
  accuracy: nullableProportion,
  endToEndSuccessRate: proportion,
  executionSuccessRate: proportion,
  macroF1: nullableProportion,
  categoryOrder: { const: [...categories] },
  confusionMatrix: strictObject(
    Object.fromEntries(categories.map((category) => [category, matrixRow])),
  ),
  byCategory: strictObject(
    Object.fromEntries(categories.map((category) => [category, categoryMetrics])),
  ),
});
const reportSchema = strictObject({
  schemaVersion: { const: 1 },
  runId: { type: 'string', pattern: '^[a-f0-9-]{36}$' },
  complete: { type: 'boolean' },
  termination: { enum: [null, 'unexpected_error'] },
  dataset: strictObject({
    id: text,
    version: { type: 'integer', minimum: 1 },
    sha256: hash,
    path: text,
    plannedCount: { const: 60 },
    distribution: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: strictObject({
        category: { enum: [...categories] },
        count: { const: 20 },
        difficulties: strictObject({
          obvious: { const: 10 },
          complex: { const: 7 },
          adversarial: { const: 3 },
        }),
      }),
    },
  }),
  model: strictObject({ provider: { const: 'ollama' }, name: text, digest: { type: 'null' } }),
  prompt: strictObject({
    sha256: hash,
    module: { const: 'src/infrastructure/ollama/classification-instructions.ts' },
  }),
  configuration: strictObject({
    timeoutMs: { type: 'integer', minimum: 1, maximum: 2147483647 },
    providerOrigin: text,
    endpoint: { const: ollamaInference.endpoint },
    stream: { const: ollamaInference.stream },
    options: { const: ollamaInference.options },
    format: { const: ollamaInference.format },
    normalization: { const: 'trim' },
    execution: { const: 'sequential' },
    retries: { const: 0 },
  }),
  codeReference: { anyOf: [text, { type: 'null' }] },
  execution: strictObject({
    startedAt: timestamp,
    finishedAt: timestamp,
    durationMs: duration,
    nodeVersion: text,
    platform: text,
    plannedCount: { const: 60 },
    attemptedCount: count,
    validCount: count,
    correctCount: count,
    incorrectCount: count,
    errorCount: count,
    unattemptedCount: count,
  }),
  results: {
    type: 'array',
    maxItems: 60,
    items: {
      oneOf: [
        strictObject({
          ...resultReference,
          status: { enum: ['correct', 'incorrect'] },
          predictedCategory: { enum: [...categories] },
        }),
        strictObject({
          ...resultReference,
          status: { const: 'error' },
          errorKind: {
            enum: [
              'timeout',
              'connection_error',
              'http_error',
              'invalid_response',
              'unexpected_error',
            ],
          },
        }),
      ],
    },
  },
  metrics: { anyOf: [metricsSchema, { type: 'null' }] },
});

const validate = new Ajv().compile<EvaluationReport>(reportSchema);

export function validateReport(report: unknown): asserts report is EvaluationReport {
  if (!validate(report)) {
    throw new Error('Contrato de informe inválido.');
  }

  const counts = report.execution;
  const correct = report.results.filter((result) => result.status === 'correct').length;
  const incorrect = report.results.filter((result) => result.status === 'incorrect').length;
  const errors = report.results.filter((result) => result.status === 'error').length;
  const ids = new Set(report.results.map((result) => result.id));
  const unexpected = report.results.filter(
    (result) => result.status === 'error' && result.errorKind === 'unexpected_error',
  );

  if (
    counts.attemptedCount !== report.results.length ||
    ids.size !== report.results.length ||
    counts.correctCount !== correct ||
    counts.incorrectCount !== incorrect ||
    counts.errorCount !== errors ||
    counts.validCount !== correct + incorrect ||
    counts.plannedCount !== counts.attemptedCount + counts.unattemptedCount ||
    report.complete !== (report.termination === null) ||
    (report.complete &&
      (counts.unattemptedCount !== 0 || report.metrics === null || unexpected.length !== 0)) ||
    (!report.complete &&
      (report.metrics !== null ||
        unexpected.length !== 1 ||
        report.results.at(-1)?.status !== 'error')) ||
    !Number.isFinite(Date.parse(counts.startedAt)) ||
    !Number.isFinite(Date.parse(counts.finishedAt)) ||
    Date.parse(counts.finishedAt) < Date.parse(counts.startedAt)
  ) {
    throw new Error('Contadores o finalización del informe inconsistentes.');
  }

  for (const result of report.results) {
    if (
      result.status !== 'error' &&
      (result.status === 'correct') !== (result.expectedCategory === result.predictedCategory)
    ) {
      throw new Error('Estado individual inconsistente.');
    }
  }
}

export async function writeReport(
  directory: string,
  report: EvaluationReport | ExperimentReport,
): Promise<string> {
  validateAnyReport(report);
  await mkdir(directory, { recursive: true });
  const filePath = join(directory, `${report.runId}.json`);
  await writeFile(filePath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });

  return filePath;
}

export interface ExperimentContext {
  phase: 'development' | 'validation';
  manifestSha256: string;
  protocolSha256: string;
  reservationId: string;
}

export function buildExperimentReport(
  loaded: LoadedDataset,
  config: Config,
  run: EvaluationRun,
  codeReference: string | null,
  prompt: RegisteredPrompt,
  context: ExperimentContext,
) {
  const base = buildReport(loaded, config, run, codeReference);

  return {
    ...base,
    schemaVersion: 2 as const,
    prompt: {
      id: prompt.id,
      version: prompt.version,
      role: prompt.role,
      sha256: sha256(prompt.text),
      module: prompt.module,
    },
    experiment: { id: 'I003' as const, ...context },
  };
}

export type ExperimentReport = ReturnType<typeof buildExperimentReport>;

const validateExperiment = new Ajv().compile<ExperimentReport>({
  ...reportSchema,
  required: [...reportSchema.required, 'experiment'],
  properties: {
    ...reportSchema.properties,
    schemaVersion: { const: 2 },
    prompt: strictObject({
      id: text,
      version: { type: 'integer', minimum: 1 },
      role: { enum: ['baseline', 'candidate'] },
      sha256: hash,
      module: text,
    }),
    experiment: strictObject({
      id: { const: 'I003' },
      phase: { enum: ['development', 'validation'] },
      manifestSha256: hash,
      protocolSha256: hash,
      reservationId: text,
    }),
  },
});

export function validateAnyReport(
  report: unknown,
): asserts report is EvaluationReport | ExperimentReport {
  if (
    typeof report !== 'object' ||
    report === null ||
    !('schemaVersion' in report) ||
    report.schemaVersion !== 2
  ) {
    validateReport(report);
    return;
  }

  if (!validateExperiment(report)) {
    throw new Error('Contrato de informe experimental inválido.');
  }

  const { experiment: _experiment, ...base } = report;
  validateReport({
    ...base,
    schemaVersion: 1,
    prompt: {
      sha256: base.prompt.sha256,
      module: 'src/infrastructure/ollama/classification-instructions.ts',
    },
  });
}
