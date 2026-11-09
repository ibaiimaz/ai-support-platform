import { isDeepStrictEqual } from 'node:util';
import type { EvaluationResult } from './types.js';

export function pairResults(
  baseline: readonly EvaluationResult[],
  candidate: readonly EvaluationResult[],
) {
  const baselineById = new Map(baseline.map((result) => [result.id, result]));
  if (
    baseline.length !== candidate.length ||
    baselineById.size !== baseline.length ||
    new Set(candidate.map((r) => r.id)).size !== candidate.length
  ) {
    throw new Error('Referencias de ejemplos no compatibles.');
  }
  const transitions = {
    correct: { correct: 0, incorrect: 0, error: 0 },
    incorrect: { correct: 0, incorrect: 0, error: 0 },
    error: { correct: 0, incorrect: 0, error: 0 },
  };
  const pairs = candidate.map((result) => {
    const control = baselineById.get(result.id);
    if (
      !control ||
      control.expectedCategory !== result.expectedCategory ||
      control.difficulty !== result.difficulty ||
      !isDeepStrictEqual(control.tags, result.tags)
    ) {
      throw new Error('Referencias de ejemplos no compatibles.');
    }
    transitions[control.status][result.status]++;
    return {
      id: result.id,
      expectedCategory: result.expectedCategory,
      difficulty: result.difficulty,
      baselineStatus: control.status,
      candidateStatus: result.status,
      baselinePredicted: control.status === 'error' ? null : control.predictedCategory,
      candidatePredicted: result.status === 'error' ? null : result.predictedCategory,
    };
  });
  return { pairs, transitions };
}
