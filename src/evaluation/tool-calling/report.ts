import { classificationProtocolId } from './protocol.js';
import { invalidResponseDiagnostics } from '../../application/classification-errors.js';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import { persist, synchronization } from '../durable-files.js';
import { sha256 } from '../dataset.js';
import { calculateDiagnostics, calculateMetrics } from './metrics.js';
import type { CaseResult, EvaluationDataset, EvaluationReport, RunIdentity } from './types.js';

const count = { type: 'integer', minimum: 0 };
const nullableBoolean = { type: ['boolean', 'null'] };
const object = (properties: Record<string, unknown>, optional: string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties).filter((key) => !optional.includes(key)),
  properties,
});
const validateResult = new Ajv({ strictTypes: false }).compile<CaseResult>(
  object(
    {
      diagnostic: { enum: [...invalidResponseDiagnostics] },
      phases: object({
        decision: object({
          started: { type: 'boolean' },
          attempts: { type: 'integer', minimum: 0, maximum: 1 },
          dispatched: { type: 'integer', minimum: 0, maximum: 1 },
          reservationUncertain: { type: 'boolean' },
          status: { enum: ['NOT_STARTED', 'COMPLETED', 'POLICY_REJECTED', 'TECHNICAL_ERROR'] },
        }),
        classification: object({
          started: { type: 'boolean' },
          attempts: { type: 'integer', minimum: 0, maximum: 1 },
          dispatched: { type: 'integer', minimum: 0, maximum: 1 },
          reservationUncertain: { type: 'boolean' },
          status: { enum: ['NOT_STARTED', 'COMPLETED', 'POLICY_REJECTED', 'TECHNICAL_ERROR'] },
        }),
      }),
      failurePhase: { enum: [null, 'decision', 'tool', 'classification', 'control'] },
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
        requestedIds: {
          type: 'array',
          items: { type: 'string', pattern: '^INC-[1-9][0-9]{0,5}$' },
        },
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
          'control_error',
        ],
      },
      latencyMs: { type: 'number', minimum: 0 },
    },
    ['diagnostic'],
  ),
);

export function buildReport(
  dataset: EvaluationDataset,
  identity: RunIdentity,
  results: CaseResult[],
  startedAt: string,
  runId: string = randomUUID(),
): EvaluationReport {
  if (identity.protocolId !== classificationProtocolId) {
    throw new Error('Incompatible evaluation protocol');
  }
  for (const result of results) {
    if (
      !validateResult(result) ||
      result.phases.decision.attempts + result.phases.classification.attempts !==
        result.observation.inferenceCount ||
      Object.values(result.phases).some(
        (phase) =>
          !phase.started !== (phase.status === 'NOT_STARTED') ||
          (!phase.started &&
            (phase.attempts !== 0 || phase.dispatched !== 0 || phase.reservationUncertain)) ||
          phase.dispatched > phase.attempts ||
          (phase.reservationUncertain && phase.dispatched !== 0) ||
          (phase.status === 'COMPLETED' &&
            (phase.attempts !== 1 || phase.dispatched !== 1 || phase.reservationUncertain)),
      ) ||
      (result.outcome === 'COMPLETED' &&
        (result.phases.decision.status !== 'COMPLETED' ||
          result.phases.classification.status !== 'COMPLETED')) ||
      (result.outcome === 'COMPLETED') !== (result.failurePhase === null) ||
      (result.outcome === 'POLICY_VIOLATION' &&
        (result.error !== 'invalid_tool_call' ||
          (result.failurePhase !== 'decision' && result.failurePhase !== 'classification') ||
          result.phases[result.failurePhase].status !== 'POLICY_REJECTED')) ||
      (result.outcome === 'TECHNICAL_ERROR' && result.error === 'invalid_tool_call') ||
      (result.error === 'control_error') !== (result.failurePhase === 'control') ||
      (Object.values(result.phases).some((phase) => phase.reservationUncertain) &&
        result.error !== 'control_error') ||
      (result.diagnostic !== undefined &&
        (result.error !== 'invalid_response' || result.outcome !== 'TECHNICAL_ERROR')) ||
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
    schemaVersion: 2,
    protocolId: classificationProtocolId,
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
