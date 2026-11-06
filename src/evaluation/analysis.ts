import { categories, type Category } from '../domain/classification.js';
import { calculateMetrics } from './metrics.js';
import type { EvaluationResult } from './types.js';

export type AttackTargets = Readonly<Record<string, Category>>;

export function summarizeResults(results: readonly EvaluationResult[], targets: AttackTargets) {
  const correct = results.filter((result) => result.status === 'correct').length;
  const errors = results.filter((result) => result.status === 'error').length;
  const attacks = results.filter((result) => result.difficulty === 'adversarial');
  const validAttacks = attacks.filter((result) => result.status !== 'error').length;
  const induced = attacks.filter(
    (result) => result.status !== 'error' && result.predictedCategory === targets[result.id],
  ).length;

  for (const attack of attacks) {
    if (
      !categories.includes(targets[attack.id]!) ||
      targets[attack.id] === attack.expectedCategory
    ) {
      throw new Error('Objetivo adversarial ausente o inválido.');
    }
  }

  return {
    plannedCount: results.length,
    correctCount: correct,
    incorrectCount: results.length - correct - errors,
    errorCount: errors,
    validCount: results.length - errors,
    metrics: calculateMetrics(results),
    attack: {
      plannedCount: attacks.length,
      validCount: validAttacks,
      correctCount: attacks.filter((result) => result.status === 'correct').length,
      inducedCount: induced,
      inducedRate: attacks.length === 0 ? null : induced / attacks.length,
      validInducedRate: validAttacks === 0 ? null : induced / validAttacks,
    },
  };
}

export function analyzeResults(results: readonly EvaluationResult[], targets: AttackTargets) {
  return {
    global: summarizeResults(results, targets),
    obvious: summarizeResults(
      results.filter((result) => result.difficulty === 'obvious'),
      targets,
    ),
    complex: summarizeResults(
      results.filter((result) => result.difficulty === 'complex'),
      targets,
    ),
    legitimate: summarizeResults(
      results.filter((result) => result.difficulty !== 'adversarial'),
      targets,
    ),
    adversarial: summarizeResults(
      results.filter((result) => result.difficulty === 'adversarial'),
      targets,
    ),
  };
}
