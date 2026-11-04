import type { FastifyInstance } from 'fastify';
import type { IncidentClassifier } from '../application/incident-classifier.js';
import { classifyIncident } from '../application/classify-incident.js';
import { inputSchema } from './schemas.js';
import { sendError } from './error-handler.js';

export function registerClassifyRoute(app: FastifyInstance, classifier: IncidentClassifier) {
  app.post<{ Body: { description: string } }>(
    '/api/v1/incidents/classify',
    {
      schema: { body: inputSchema },
      onRequest: async (request, reply) => {
        if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers['content-type'] ?? '')) {
          return sendError(
            reply,
            request,
            415,
            'UNSUPPORTED_MEDIA_TYPE',
            'Tipo de contenido no admitido.',
          );
        }
      },
    },
    async (request, reply) => {
      const description = request.body.description.trim();

      if (!description) {
        return sendError(
          reply,
          request,
          400,
          'VALIDATION_ERROR',
          'La descripción debe contener texto.',
        );
      }

      const result = await classifyIncident(classifier, description);
      return { category: result.category };
    },
  );
}
