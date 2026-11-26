import type { Config } from './config.js';
import type { ApplicationDependencies } from './http/app.js';
import type { RagConfig } from './knowledge/config.js';
import { createKnowledgeDependencies } from './knowledge/composition.js';
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

export async function createApplicationDependencies(
  classificationConfig: Config,
  knowledgeConfig: RagConfig,
  factories = {
    classification: createClassificationDependencies,
    knowledge: createKnowledgeDependencies,
  },
): Promise<{ dependencies: ApplicationDependencies; close(): Promise<void> }> {
  const knowledge = factories.knowledge(knowledgeConfig);
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= Promise.resolve().then(() => knowledge.close());
    return closing;
  };
  try {
    const classification = factories.classification(classificationConfig);
    return {
      dependencies: {
        classification,
        knowledge: {
          dependencies: knowledge.dependencies,
          maxQuestionLength: knowledgeConfig.maxQuestionLength,
        },
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
