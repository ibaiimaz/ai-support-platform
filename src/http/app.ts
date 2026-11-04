import Fastify, { LogController, type FastifyServerOptions } from 'fastify';
import type { IncidentClassifier } from '../application/incident-classifier.js';
import { registerClassifyRoute } from './classify-route.js';
import { registerErrors } from './error-handler.js';

export function buildApp(
  classifier: IncidentClassifier,
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
  registerClassifyRoute(app, classifier);

  return app;
}
