import type { FastifyInstance } from 'fastify';
import { KnowledgeError } from '../knowledge/domain.js';
import { askKnowledgeQuestion, type AskDependencies } from '../knowledge/use-cases.js';
import { sendError } from './error-handler.js';

export function registerKnowledgeRoute(
  app: FastifyInstance,
  dependencies: AskDependencies,
  maxQuestionLength: number,
) {
  app.post<{ Body: { question: string } }>(
    '/api/v1/knowledge/ask',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['question'],
          properties: { question: { type: 'string', minLength: 1, maxLength: maxQuestionLength } },
        },
      },
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
      const question = request.body.question.trim();
      if (!question) {
        return sendError(
          reply,
          request,
          400,
          'VALIDATION_ERROR',
          'La pregunta debe contener texto.',
        );
      }
      try {
        return await askKnowledgeQuestion(dependencies, question);
      } catch (error) {
        if (!(error instanceof KnowledgeError)) {
          throw error;
        }
        if (error.kind.endsWith('_TIMEOUT')) {
          return sendError(
            reply,
            request,
            504,
            'KNOWLEDGE_PROVIDER_TIMEOUT',
            'Tiempo de espera del proveedor agotado.',
          );
        }
        if (error.kind.startsWith('INVALID_')) {
          return sendError(
            reply,
            request,
            502,
            'KNOWLEDGE_INVALID_RESPONSE',
            'Respuesta del proveedor no válida.',
          );
        }
        return sendError(
          reply,
          request,
          503,
          'KNOWLEDGE_UNAVAILABLE',
          'Servicio de conocimiento no disponible.',
        );
      }
    },
  );
}
