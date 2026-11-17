import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import { persist, synchronization } from '../durable-files.js';
import { sha256 } from '../dataset.js';
import { calculateDiagnostics, calculateMetrics } from './metrics.js';
import type { CaseResult, EvaluationDataset, EvaluationReport, RunIdentity } from './types.js';

const count = { type: 'integer', minimum: 0 };
const nullableBoolean = { type: ['boolean', 'null'] };
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const validateResult = new Ajv({ strictTypes: false }).compile<CaseResult>(
  object({
    id: { type: 'string', pattern: '^I006-[0-9]{3}$' },
    outcome: { enum: ['COMPLETED', 'POLICY_VIOLATION', 'TECHNICAL_ERROR'] },
    observation: object({
      toolRequested: nullableBoolean,
      toolRequestValid: nullableBoolean,
      toolExecuted: { type: 'boolean' },
      toolOutcome: { enum: [null, 'FOUND', 'NOT_FOUND', 'UNAVAILABLE'] },
      toolDecisionCorrect: nullableBoolean,
      requestCount: count,
      executionCount: { ...count, maximum: 1 },
      inferenceCount: { ...count, maximum: 2 },
      requestedIds: { type: 'array', items: { type: 'string', pattern: '^INC-[1-9][0-9]{0,5}$' } },
      violations: { type: 'array', items: { const: 'INVALID_MULTIPLE_OR_ADDITIONAL_REQUEST' } },
    }),
    final: {
      anyOf: [
        object({
          status: { const: 'CLASSIFIED' },
          category: { enum: ['BUG', 'FEATURE', 'QUESTION'] },
        }),
        object({
          status: { const: 'INSUFFICIENT_CONTEXT' },
          category: { type: 'null' },
          toolUnavailable: { type: 'boolean' },
        }),
        { type: 'null' },
      ],
    },
    error: {
      enum: [
        null,
        'invalid_tool_call',
        'timeout',
        'connection_error',
        'http_error',
        'invalid_response',
        'global_deadline_exceeded',
        'unexpected_error',
      ],
    },
    latencyMs: { type: 'number', minimum: 0 },
  }),
);

export function buildReport(
  dataset: EvaluationDataset,
  identity: RunIdentity,
  results: CaseResult[],
  startedAt: string,
  runId: string = randomUUID(),
): EvaluationReport {
  for (const result of results) {
    if (
      !validateResult(result) ||
      (result.outcome === 'COMPLETED') !== (result.final !== null) ||
      (result.outcome === 'COMPLETED') !== (result.error === null) ||
      (result.outcome === 'TECHNICAL_ERROR') !== (result.observation.toolDecisionCorrect === null)
    ) {
      throw new Error('Invalid or unsafe I006 result');
    }
  }
  const metrics = calculateMetrics(dataset, results);
  const complete = results.length === 60 && metrics.evaluable === 60 && metrics.excludedPairs === 0;
  const passed =
    complete &&
    [
      metrics.precision,
      metrics.recall,
      metrics.classification,
      metrics.abstention,
      metrics.counterfactual,
    ].every((metric) => metric.passed);
  return {
    schemaVersion: 1,
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    identity,
    dataset: {
      id: dataset.id,
      schemaVersion: dataset.schemaVersion,
      version: dataset.version,
      cases: dataset.examples.length,
      pairs: dataset.counterfactualPairs.length,
    },
    results: structuredClone(results),
    metrics,
    diagnostics: calculateDiagnostics(dataset, results),
    status: !complete ? 'INCOMPLETE' : passed ? 'COMPLETE_PASSED' : 'COMPLETE_FAILED',
    deterministicGate: 'NOT_EVALUATED',
    experimentalGate: !complete ? 'INCOMPLETE' : passed ? 'PASSED' : 'FAILED',
    totalLatencyMs: results.reduce((sum, result) => sum + result.latencyMs, 0),
  };
}

export async function saveReport(directory: string, report: EvaluationReport): Promise<string> {
  if (!/^[a-f0-9-]{36}$/.test(report.runId)) {
    throw new Error('Invalid run ID');
  }
  const path = join(directory, `${report.runId}-${report.results.length}-${report.status}.json`);
  const bytes = JSON.stringify(report, null, 2) + '\n';
  await persist(path, bytes, true, synchronization);
  await persist(`${path}.sha256`, sha256(bytes) + '\n', true, synchronization);
  return path;
}
