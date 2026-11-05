import { categories, type Category } from '../domain/classification.js';
import type { EvaluationMetrics, EvaluationResult } from './types.js';

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function calculateMetrics(
  results: readonly EvaluationResult[],
  plannedCategories: readonly Category[] = results.map((result) => result.expectedCategory),
): EvaluationMetrics {
  const confusionMatrix: EvaluationMetrics['confusionMatrix'] = {
    BUG: { BUG: 0, FEATURE: 0, QUESTION: 0 },
    FEATURE: { BUG: 0, FEATURE: 0, QUESTION: 0 },
    QUESTION: { BUG: 0, FEATURE: 0, QUESTION: 0 },
  };
  let validCount = 0;
  let correctCount = 0;

  for (const result of results) {
    if (result.status !== 'error') {
      confusionMatrix[result.expectedCategory][result.predictedCategory]++;
      validCount++;

      if (result.status === 'correct') {
        correctCount++;
      }
    }
  }

  const byCategory = {} as EvaluationMetrics['byCategory'];

  for (const category of categories) {
    const truePositives = confusionMatrix[category][category];
    const validSupport = categories.reduce(
      (sum, predicted) => sum + confusionMatrix[category][predicted],
      0,
    );
    const predictedCount = categories.reduce(
      (sum, expected) => sum + confusionMatrix[expected][category],
      0,
    );

    byCategory[category] = {
      plannedSupport: plannedCategories.filter((expected) => expected === category).length,
      validSupport,
      errorCount: results.filter(
        (result) => result.expectedCategory === category && result.status === 'error',
      ).length,
      precision: validCount === 0 ? null : ratio(truePositives, predictedCount),
      recall: validCount === 0 ? null : ratio(truePositives, validSupport),
      f1: validCount === 0 ? null : ratio(2 * truePositives, predictedCount + validSupport),
    };
  }

  return {
    accuracy: validCount === 0 ? null : correctCount / validCount,
    endToEndSuccessRate: ratio(correctCount, plannedCategories.length),
    executionSuccessRate: ratio(validCount, plannedCategories.length),
    macroF1:
      validCount === 0
        ? null
        : categories.reduce((sum, category) => sum + (byCategory[category].f1 ?? 0), 0) /
          categories.length,
    categoryOrder: [...categories],
    confusionMatrix,
    byCategory,
  };
}
