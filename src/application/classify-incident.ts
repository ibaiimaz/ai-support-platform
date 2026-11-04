import type { IncidentClassifier } from './incident-classifier.js';

export function classifyIncident(classifier: IncidentClassifier, description: string) {
  return classifier.classify(description);
}
