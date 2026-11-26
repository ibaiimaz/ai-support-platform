import type { ToolCallingDependencies } from '../../src/application/classify-incident.js';
import { buildApp } from '../../src/http/app.js';
import { dependencies } from '../knowledge/helpers.js';

export function buildClassificationTestApp(
  classification: ToolCallingDependencies,
  logger: Parameters<typeof buildApp>[1] = false,
) {
  return buildApp(
    { classification, knowledge: { dependencies: dependencies(), maxQuestionLength: 2000 } },
    logger,
  );
}

export function classificationFixture(): ToolCallingDependencies {
  return {
    systemInstructions: 'Synthetic lookup instructions',
    classificationInstructions: 'Synthetic classification instructions',
    llm: {
      async infer() {
        throw new Error('Unexpected classification inference in a knowledge-only test');
      },
    },
    repository: {
      async getById() {
        throw new Error('Unexpected incident lookup in a knowledge-only test');
      },
    },
  };
}
