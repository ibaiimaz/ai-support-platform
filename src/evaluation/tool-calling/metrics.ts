import type {
  CaseResult,
  EvaluationDataset,
  EvaluationMetrics,
  EvaluationCase,
  Metric,
  DiagnosticMetric,
  EvaluationDiagnostics,
} from './types.js';

function metric(numerator: number, denominator: number, threshold: number): Metric {
  return {
    numerator,
    denominator,
    percentage: denominator === 0 ? null : (100 * numerator) / denominator,
    threshold,
    passed: denominator > 0 && 100 * numerator >= threshold * denominator,
  };
}

export function finalCorrect(example: EvaluationCase, result: CaseResult): boolean {
  return (
    result.final !== null &&
    result.final.status === example.expectedFinal.status &&
    result.final.category === example.expectedFinal.category
  );
}

export function calculateMetrics(
  dataset: EvaluationDataset,
  results: CaseResult[],
): EvaluationMetrics {
  const byId = new Map(results.map((result) => [result.id, result]));
  if (
    byId.size !== results.length ||
    results.some((result, index) => dataset.examples[index]?.id !== result.id) ||
    results.slice(0, -1).some((result) => result.outcome === 'TECHNICAL_ERROR')
  ) {
    throw new Error('Results must be a unique ordered prefix ending at first technical failure');
  }
  const evaluable = dataset.examples.filter((example) => {
    const result = byId.get(example.id);
    return result !== undefined && result.outcome !== 'TECHNICAL_ERROR';
  });
  const correctRequests = evaluable.filter(
    (example) =>
      example.toolExpected && byId.get(example.id)!.observation.toolDecisionCorrect === true,
  ).length;
  const classified = evaluable.filter((example) => example.expectedFinal.status === 'CLASSIFIED');
  const pairs = dataset.counterfactualPairs.filter((pair) =>
    pair.caseIds.every((id) => evaluable.some((example) => example.id === id)),
  );
  return {
    precision: metric(
      correctRequests,
      evaluable.filter((example) => byId.get(example.id)!.observation.toolRequested === true)
        .length,
      90,
    ),
    recall: metric(correctRequests, evaluable.filter((example) => example.toolExpected).length, 90),
    classification: metric(
      classified.filter((example) => finalCorrect(example, byId.get(example.id)!)).length,
      classified.length,
      85,
    ),
    abstention: metric(
      evaluable.filter(
        (example) => byId.get(example.id)!.final?.status === example.expectedFinal.status,
      ).length,
      evaluable.length,
      85,
    ),
    counterfactual: metric(
      pairs.filter((pair) =>
        pair.caseIds.every((id) => {
          const example = dataset.examples.find((item) => item.id === id)!;
          const result = byId.get(id)!;
          return result.observation.toolDecisionCorrect === true && finalCorrect(example, result);
        }),
      ).length,
      pairs.length,
      90,
    ),
    evaluable: evaluable.length,
    technicalErrors: results.filter((result) => result.outcome === 'TECHNICAL_ERROR').length,
    notAttempted: dataset.examples.length - results.length,
    plannedPairs: dataset.counterfactualPairs.length,
    excludedPairs: dataset.counterfactualPairs.length - pairs.length,
  };
}

function diagnosticMetric(numerator: number, denominator: number): DiagnosticMetric {
  return {
    numerator,
    denominator,
    percentage: denominator === 0 ? null : (100 * numerator) / denominator,
  };
}

// buildReport validates the ordered result prefix and its final responses first.
export function calculateDiagnostics(
  dataset: EvaluationDataset,
  results: CaseResult[],
): EvaluationDiagnostics {
  let expectedAbstentions = 0;
  let predictedAbstentions = 0;
  let correctAbstentions = 0;
  const examples = new Map(dataset.examples.map((example) => [example.id, example]));
  for (const result of results) {
    if (result.outcome === 'TECHNICAL_ERROR') {
      continue;
    }
    const example = examples.get(result.id);
    if (!example) {
      throw new Error('Unknown I006 diagnostic case');
    }
    const expected = example.expectedFinal.status === 'INSUFFICIENT_CONTEXT';
    const predicted =
      result.outcome === 'COMPLETED' && result.final?.status === 'INSUFFICIENT_CONTEXT';
    if (expected) {
      expectedAbstentions++;
    }
    if (predicted) {
      predictedAbstentions++;
    }
    if (expected && predicted) {
      correctAbstentions++;
    }
  }
  return {
    abstentionRecall: diagnosticMetric(correctAbstentions, expectedAbstentions),
    abstentionPrecision: diagnosticMetric(correctAbstentions, predictedAbstentions),
  };
}
