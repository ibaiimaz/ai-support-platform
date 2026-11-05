import type { Category } from '../domain/classification.js';
import type { ProviderFailure } from '../application/classification-errors.js';

export const difficulties = ['obvious', 'complex', 'adversarial'] as const;

export type Difficulty = (typeof difficulties)[number];

export interface EvaluationExample {
  id: string;
  description: string;
  expectedCategory: Category;
  difficulty: Difficulty;
  tags: string[];
  rationale: string;
}

export interface EvaluationDataset {
  schemaVersion: 1;
  id: string;
  version: number;
  examples: EvaluationExample[];
}

export interface LoadedDataset {
  dataset: EvaluationDataset;
  sha256: string;
  path: string;
}

export interface ResultReference {
  id: string;
  expectedCategory: Category;
  difficulty: Difficulty;
  tags: string[];
  durationMs: number;
}

export type EvaluationResult = ResultReference &
  (
    | { status: 'correct' | 'incorrect'; predictedCategory: Category }
    | { status: 'error'; errorKind: ProviderFailure | 'unexpected_error' }
  );

export interface EvaluationRun {
  complete: boolean;
  termination: 'unexpected_error' | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  results: EvaluationResult[];
}

export interface CategoryMetrics {
  plannedSupport: number;
  validSupport: number;
  errorCount: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface EvaluationMetrics {
  accuracy: number | null;
  endToEndSuccessRate: number;
  executionSuccessRate: number;
  macroF1: number | null;
  categoryOrder: readonly Category[];
  confusionMatrix: Record<Category, Record<Category, number>>;
  byCategory: Record<Category, CategoryMetrics>;
}
