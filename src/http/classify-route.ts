import type { FastifyInstance } from 'fastify';
import {
  classifyIncident,
  type ToolCallingDependencies,
} from '../application/classify-incident.js';
import { inputSchema } from './schemas.js';
import { sendError } from './error-handler.js';

export function registerClassifyRoute(app: FastifyInstance, dependencies: ToolCallingDependencies) {
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

      const result = await classifyIncident(dependencies, description);
      if (result.status === 'CLASSIFIED') {
        return { category: result.category };
      }

      if (result.toolUnavailable) {
        return sendError(
          reply,
          request,
          503,
          'CLASSIFICATION_UNAVAILABLE',
          'No se pudo completar la clasificación.',
        );
      }

      return sendError(
        reply,
        request,
        422,
        'INSUFFICIENT_CONTEXT',
        'No hay contexto suficiente para clasificar la incidencia.',
      );
    },
  );
}
