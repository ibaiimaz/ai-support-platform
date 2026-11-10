import type { EvaluationResult } from '../types.js';
import { categories } from '../../domain/classification.js';
import { pairResults } from '../paired-results.js';

export function xorshift32(seed = 5005) {
  let state = seed >>> 0;
  if (state === 0) {
    throw new Error('Semilla nula.');
  }
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2 ** 32;
  };
}

export function pairedBootstrap(
  baseline: readonly EvaluationResult[],
  candidate: readonly EvaluationResult[],
) {
  const { pairs } = pairResults(baseline, candidate);
  if (pairs.length !== 90) {
    throw new Error('Se requieren 90 pares completos.');
  }
  const strata: number[][] = [];
  for (const category of categories) {
    for (const [difficulty, n] of [
      ['obvious', 15],
      ['complex', 10],
      ['adversarial', 5],
    ] as const) {
      const selected = pairs
        .filter((p) => p.expectedCategory === category && p.difficulty === difficulty)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      if (selected.length !== n) {
        throw new Error('Estratos incompletos.');
      }
      strata.push(
        selected.map(
          (p) => Number(p.candidateStatus === 'correct') - Number(p.baselineStatus === 'correct'),
        ),
      );
    }
  }
  const random = xorshift32();
  const replicates: number[] = [];
  for (let b = 0; b < 10000; b++) {
    let sum = 0;
    for (const stratum of strata) {
      for (let i = 0; i < stratum.length; i++) {
        sum += stratum[Math.floor(random() * stratum.length)]!;
      }
    }
    replicates.push(sum / 90);
  }
  replicates.sort((a, b) => a - b);
  return {
    estimand: 'paired_end_to_end_difference',
    method: 'stratified_paired_percentile',
    confidenceLevel: 0.95,
    resamples: 10000,
    generator: 'xorshift32',
    seed: 5005,
    strataOrder: 'BUG/FEATURE/QUESTION x obvious/complex/adversarial',
    pairOrder: 'ascending_id',
    quantile: 'nearest_rank',
    lowerIndex: 249,
    upperIndex: 9749,
    estimate: strata.flat().reduce((a, b) => a + b, 0) / 90,
    lower: replicates[249]!,
    upper: replicates[9749]!,
    degenerate: replicates[0] === replicates.at(-1),
    limitation:
      'Approximate conditional interval for synthetic strata; not model-run variability or guaranteed population coverage.',
  };
}

export function practicalDecision(
  gain: number | null,
  complete: boolean,
  errors: number,
  uncertain: number,
) {
  let outcome: string;
  if (!complete || uncertain > 0 || gain === null) {
    outcome = 'incomplete_or_uncertain';
  } else if (errors > 0) {
    outcome = 'technical_inconclusive';
  } else if (gain >= 9) {
    outcome = 'practical_confirmation_on_this_dataset';
  } else if (gain > 0) {
    outcome = 'improvement_below_threshold';
  } else if (gain === 0) {
    outcome = 'net_tie';
  } else {
    outcome = 'gemma_worse';
  }
  return {
    outcome,
    netCorrectGain: gain,
    practicalThreshold: 9,
    promotionAuthorized: false,
    statisticalGate: false,
    humanReviewRequired: true,
  };
}
