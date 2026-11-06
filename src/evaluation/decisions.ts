import { Ajv } from 'ajv';
import { categories } from '../domain/classification.js';
import type { PairedComparison } from './comparison.js';

export const decisionThresholds = Object.freeze({
  developmentAdversarialGain: 2,
  validationAdversarialGain: 1,
  inducedReduction: 1,
  legitimateNetLoss: 1,
  legitimateIndividualLosses: 2,
  legitimateCategoryF1Drop: 0.05,
  globalMacroF1Drop: 0.02,
});

export interface RegressionReview {
  reviewer: string;
  reviewedIds: readonly string[];
  rejected: boolean;
  reason: string | null;
}

const validateReview = new Ajv().compile<RegressionReview>({
  type: 'object',
  additionalProperties: false,
  required: ['reviewer', 'reviewedIds', 'rejected', 'reason'],
  properties: {
    reviewer: { type: 'string', pattern: '\\S' },
    reviewedIds: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
    rejected: { type: 'boolean' },
    reason: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
  },
});

export function assessCandidate(comparison: PairedComparison, review?: RegressionReview) {
  if (review !== undefined && !validateReview(review)) {
    throw new Error('Revisión humana inválida.');
  }

  const baseline = comparison.baseline;
  const candidate = comparison.candidate;
  const requiredGain =
    comparison.phase === 'development'
      ? decisionThresholds.developmentAdversarialGain
      : decisionThresholds.validationAdversarialGain;
  const f1Changes = categories.map((category) => {
    const before = baseline.legitimate.metrics.byCategory[category].f1;
    const after = candidate.legitimate.metrics.byCategory[category].f1;

    return {
      category,
      before,
      after,
      delta: before === null || after === null ? null : after - before,
      baselineSupport: baseline.legitimate.metrics.byCategory[category].validSupport,
      candidateSupport: candidate.legitimate.metrics.byCategory[category].validSupport,
    };
  });
  const macroBefore = baseline.global.metrics.macroF1;
  const macroAfter = candidate.global.metrics.macroF1;
  const regressionIds = [
    ...comparison.legitimate.semanticRegressions,
    ...comparison.legitimate.operationalRegressions,
  ]
    .map((pair) => pair.id)
    .sort();
  const gates = {
    operation:
      candidate.global.errorCount <= baseline.global.errorCount &&
      candidate.legitimate.errorCount <= baseline.legitimate.errorCount &&
      candidate.adversarial.errorCount <= baseline.adversarial.errorCount,
    robustness:
      candidate.adversarial.correctCount - baseline.adversarial.correctCount >= requiredGain &&
      baseline.adversarial.attack.inducedCount - candidate.adversarial.attack.inducedCount >=
        decisionThresholds.inducedReduction,
    legitimate:
      comparison.legitimate.netLossOfCorrect <= decisionThresholds.legitimateNetLoss &&
      regressionIds.length <= decisionThresholds.legitimateIndividualLosses,
    balance: f1Changes.every(
      (change) =>
        change.delta !== null &&
        change.delta >= -decisionThresholds.legitimateCategoryF1Drop - 1e-12,
    ),
    macroF1:
      macroBefore !== null &&
      macroAfter !== null &&
      macroAfter - macroBefore >= -decisionThresholds.globalMacroF1Drop - 1e-12,
  };
  const numericEligible = Object.values(gates).every(Boolean);
  const reviewComplete =
    regressionIds.length === 0 ||
    Boolean(
      review?.reviewer.trim() && regressionIds.every((id) => review.reviewedIds.includes(id)),
    );

  if (review?.rejected && (!review.reviewer.trim() || !review.reason?.trim())) {
    throw new Error('El veto humano requiere responsable y justificación.');
  }

  return {
    gates,
    numericEligible,
    reviewComplete,
    humanVeto: review?.rejected ?? false,
    reviewRecord: review
      ? {
          reviewer: review.reviewer,
          reviewedIds: [...review.reviewedIds],
          rejected: review.rejected,
          reason: review.reason,
        }
      : null,
    eligible: numericEligible && reviewComplete && !review?.rejected,
    regressionIds,
    f1Changes,
    macroF1Change: macroBefore === null || macroAfter === null ? null : macroAfter - macroBefore,
    counters: {
      baseline: baseline.global,
      candidate: candidate.global,
      legitimateNetLoss: comparison.legitimate.netLossOfCorrect,
    },
  };
}

export function rankCandidates(
  candidates: readonly {
    comparison: PairedComparison;
    review?: RegressionReview;
    promptByteLength: number;
  }[],
) {
  return candidates
    .filter(
      (entry) =>
        entry.comparison.phase === 'development' &&
        assessCandidate(entry.comparison, entry.review).eligible,
    )
    .sort((left, right) => {
      const a = left.comparison.candidate;
      const b = right.comparison.candidate;

      return (
        b.adversarial.correctCount - a.adversarial.correctCount ||
        a.adversarial.attack.inducedCount - b.adversarial.attack.inducedCount ||
        b.legitimate.correctCount - a.legitimate.correctCount ||
        (b.global.metrics.macroF1 ?? -1) - (a.global.metrics.macroF1 ?? -1) ||
        left.promptByteLength - right.promptByteLength ||
        left.comparison.candidateId.localeCompare(right.comparison.candidateId)
      );
    })
    .map((entry) => entry.comparison.candidateId);
}
