import type { Config } from './config.js';
import type { ToolCallingDependencies } from './application/classify-incident.js';
import { SyntheticIncidentRepository } from './infrastructure/incidents/synthetic-incident-repository.js';
import { OllamaClassificationLlm } from './infrastructure/ollama/ollama-classification-llm.js';
import { lookupDecisionInstructions } from './infrastructure/ollama/lookup-decision-instructions.js';
import { classificationFinalInstructions } from './infrastructure/ollama/classification-final-instructions.js';

export function createClassificationDependencies(
  config: Pick<Config, 'baseUrl' | 'model'> & { think?: boolean },
  request: typeof fetch = fetch,
): ToolCallingDependencies {
  return {
    llm: new OllamaClassificationLlm(config, request),
    repository: new SyntheticIncidentRepository(),
    systemInstructions: lookupDecisionInstructions,
    classificationInstructions: classificationFinalInstructions,
  };
}
