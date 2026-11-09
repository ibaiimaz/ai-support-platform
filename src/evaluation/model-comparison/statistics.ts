import type { EvaluationResult } from '../types.js';

export function distribution(values: readonly number[]) {
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('Latencia inválida.');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    n,
    meanMs: n ? sorted.reduce((sum, value) => sum + value, 0) / n : null,
    medianMs: n ? (sorted[Math.floor((n - 1) / 2)]! + sorted[Math.floor(n / 2)]!) / 2 : null,
    p95Ms: n ? sorted[Math.ceil(0.95 * n) - 1]! : null,
  };
}

export function latencySummary(results: readonly EvaluationResult[]) {
  return {
    all: distribution(results.map((r) => r.durationMs)),
    valid: distribution(results.filter((r) => r.status !== 'error').map((r) => r.durationMs)),
    firstCaseMs: results[0]?.durationMs ?? null,
    remaining: distribution(results.slice(1).map((r) => r.durationMs)),
    internal: {
      loadMs: null,
      promptEvaluationMs: null,
      generationMs: null,
      reason: 'not_exposed_by_existing_adapter',
    },
    descriptiveOnly: true,
  };
}
