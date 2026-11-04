import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ClassificationError } from '../application/classification-errors.js';

export function sendError(
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  code: string,
  message: string,
) {
  request.log.info({ errorCode: code }, 'Request error');
  return reply.code(status).send({ error: { code, message, requestId: request.id } });
}

export function registerErrors(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) =>
    sendError(reply, request, 404, 'NOT_FOUND', 'Ruta inexistente.'),
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ClassificationError) {
      request.log.warn({ providerCause: error.kind }, 'Provider failure');
      return sendError(
        reply,
        request,
        502,
        'PROVIDER_ERROR',
        'No se pudo completar la clasificación.',
      );
    }

    const frameworkError: { code?: string; validation?: unknown } =
      error instanceof Error ? (error as Error & { code?: string; validation?: unknown }) : {};

    if (frameworkError.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return sendError(reply, request, 413, 'PAYLOAD_TOO_LARGE', 'Cuerpo demasiado grande.');
    }

    if (frameworkError.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return sendError(
        reply,
        request,
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'Tipo de contenido no admitido.',
      );
    }

    if (frameworkError.validation) {
      return sendError(reply, request, 400, 'VALIDATION_ERROR', 'Petición inválida.');
    }

    if (
      frameworkError.code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
      frameworkError.code === 'FST_ERR_CTP_EMPTY_JSON_BODY'
    ) {
      return sendError(reply, request, 400, 'INVALID_JSON', 'JSON inválido.');
    }

    return sendError(reply, request, 500, 'INTERNAL_ERROR', 'Error interno.');
  });
}
