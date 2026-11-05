import { performance } from 'node:perf_hooks';
import { classifyIncident } from '../application/classify-incident.js';
import { ClassificationError } from '../application/classification-errors.js';
import type { IncidentClassifier } from '../application/incident-classifier.js';
import type { EvaluationExample, EvaluationResult, EvaluationRun } from './types.js';

export async function runEvaluation(
  examples: readonly EvaluationExample[],
  classifier: IncidentClassifier,
): Promise<EvaluationRun> {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const results: EvaluationResult[] = [];
  let termination: EvaluationRun['termination'] = null;

  for (const example of examples) {
    const exampleStart = performance.now();
    const reference = {
      id: example.id,
      expectedCategory: example.expectedCategory,
      difficulty: example.difficulty,
      tags: [...example.tags],
    };

    try {
      const classification = await classifyIncident(classifier, example.description.trim());

      results.push({
        ...reference,
        status: classification.category === example.expectedCategory ? 'correct' : 'incorrect',
        predictedCategory: classification.category,
        durationMs: performance.now() - exampleStart,
      });
    } catch (error) {
      const errorKind = error instanceof ClassificationError ? error.kind : 'unexpected_error';

      results.push({
        ...reference,
        status: 'error',
        errorKind,
        durationMs: performance.now() - exampleStart,
      });

      if (errorKind === 'unexpected_error') {
        termination = 'unexpected_error';
        break;
      }
    }
  }

  return {
    complete: termination === null,
    termination,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: performance.now() - start,
    results,
  };
}
