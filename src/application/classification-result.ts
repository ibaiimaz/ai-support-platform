import type { Category } from '../domain/classification.js';

export type ClassificationResult =
  | {
      status: 'CLASSIFIED';
      category: Category;
    }
  | {
      status: 'INSUFFICIENT_CONTEXT';
      category: null;
      toolUnavailable: boolean;
    };
