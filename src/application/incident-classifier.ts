import type { Classification } from '../domain/classification.js';

export interface IncidentClassifier {
  classify(description: string): Promise<Classification>;
}
