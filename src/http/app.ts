import Fastify, { LogController, type FastifyServerOptions } from 'fastify';
import type { ToolCallingDependencies } from '../application/classify-incident.js';
import { registerClassifyRoute } from './classify-route.js';
import { registerErrors } from './error-handler.js';
import type { AskDependencies } from '../knowledge/use-cases.js';
import { registerKnowledgeRoute } from './knowledge-route.js';

export interface ApplicationDependencies {
  classification: ToolCallingDependencies;
  knowledge: {
    dependencies: AskDependencies;
    maxQuestionLength: number;
  };
}

export function buildApp(
  dependencies: ApplicationDependencies,
  logger: FastifyServerOptions['logger'] = false,
) {
  const app = Fastify({
    bodyLimit: 32768,
    logger,
    logController: new LogController({ disableRequestLogging: true }),
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false, useDefaults: false } },
  });

  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        route: request.routeOptions.url ?? 'unmatched',
        status: reply.statusCode,
        durationMs: reply.elapsedTime,
      },
      'Request completed',
    );
  });

  registerErrors(app);
  registerClassifyRoute(app, dependencies.classification);
  registerKnowledgeRoute(
    app,
    dependencies.knowledge.dependencies,
    dependencies.knowledge.maxQuestionLength,
  );

  return app;
}
