import {
  classifyIncident,
  type ToolCallingDependencies,
} from '../../application/classify-incident.js';
import {
  ClassificationError,
  isInvalidResponseDiagnostic,
} from '../../application/classification-errors.js';
import {
  GlobalDeadlineExceededError,
  InvalidToolCallError,
} from '../../application/tool-calling-errors.js';
import { fixtureRepository } from './fixture-repository.js';
import { observe } from './observation.js';
import type { CaseResult, EvaluationCase, EvaluationDataset } from './types.js';

export interface RunControl {
  runId?: string;
  reserve(example: EvaluationCase): Promise<void>;
  record(result: CaseResult): Promise<void>;
}

export async function runEvaluation(
  dataset: EvaluationDataset,
  dependencies: ToolCallingDependencies,
  control: RunControl,
  now: () => number = () => performance.now(),
): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const example of dataset.examples) {
    await control.reserve(example);
    const observed = observe(
      { ...dependencies, repository: fixtureRepository(example.fixture) },
      example,
    );
    const start = now();
    let final: CaseResult['final'] = null;
    let error: CaseResult['error'] = null;
    let diagnostic: CaseResult['diagnostic'];
    let outcome: CaseResult['outcome'] = 'COMPLETED';
    try {
      final = await classifyIncident(observed.dependencies, example.description);
    } catch (cause) {
      if (cause instanceof InvalidToolCallError) {
        outcome = 'POLICY_VIOLATION';
        error = 'invalid_tool_call';
      } else {
        if (
          cause instanceof ClassificationError &&
          cause.kind === 'invalid_response' &&
          isInvalidResponseDiagnostic(cause.diagnostic)
        ) {
          diagnostic = cause.diagnostic;
        }
        outcome = 'TECHNICAL_ERROR';
        error =
          cause instanceof ClassificationError || cause instanceof GlobalDeadlineExceededError
            ? cause.kind
            : 'unexpected_error';
      }
    }
    const result: CaseResult = {
      id: example.id,
      outcome,
      observation: observed.close(outcome !== 'TECHNICAL_ERROR'),
      final,
      error,
      ...(diagnostic !== undefined ? { diagnostic } : {}),
      latencyMs: Math.max(0, now() - start),
    };
    await control.record(result);
    results.push(result);
    if (outcome === 'TECHNICAL_ERROR') {
      break;
    }
  }
  return results;
}
