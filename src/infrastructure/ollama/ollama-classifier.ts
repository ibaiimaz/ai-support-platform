import { Ajv } from 'ajv';
import { categories, type Classification } from '../../domain/classification.js';
import type { IncidentClassifier } from '../../application/incident-classifier.js';
import { ClassificationError } from '../../application/classification-errors.js';
import type { Config } from '../../config.js';
import { classificationInstructions } from './classification-instructions.js';

const schema = {
  type: 'object',
  required: ['category'],
  additionalProperties: false,
  properties: { category: { type: 'string', enum: [...categories] } },
};

const validate = new Ajv({
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
}).compile<Classification>(schema);

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Node fetch wraps network failures in TypeError.cause. TypeError alone is not
// evidence of a transport failure: programming errors must reach HTTP as 500.
const transportCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_DESTROYED',
  'UND_ERR_CLOSED',
  'UND_ERR_RES_CONTENT_LENGTH_MISMATCH',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function isTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if ('code' in error && typeof error.code === 'string' && transportCodes.has(error.code)) {
    return true;
  }

  if (error instanceof AggregateError) {
    return error.errors.length > 0 && error.errors.every(isTransportError);
  }

  return error.cause !== undefined && isTransportError(error.cause);
}

async function transport<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (
      signal.aborted &&
      (error === signal.reason || (error instanceof DOMException && error.name === 'AbortError'))
    ) {
      throw new ClassificationError('timeout');
    }

    if (isTransportError(error)) {
      throw new ClassificationError('connection_error');
    }

    throw error;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ClassificationError('invalid_response');
    }

    throw error;
  }
}

export class OllamaClassifier implements IncidentClassifier {
  constructor(private readonly config: Config) {}

  async classify(description: string): Promise<Classification> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const url = new URL('/api/chat', this.config.baseUrl);
      const response = await transport(
        () =>
          fetch(url, {
            method: 'POST',
            signal: controller.signal,
            redirect: 'manual',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              model: this.config.model,
              stream: false,
              format: schema,
              options: { temperature: 0 },
              messages: [
                { role: 'system', content: classificationInstructions },
                { role: 'user', content: description },
              ],
            }),
          }),
        controller.signal,
      );

      if (!response.ok) {
        if (response.body) {
          await transport(() => response.body!.cancel(), controller.signal);
        }
        throw new ClassificationError('http_error');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new ClassificationError('invalid_response');
      }

      const chunks: Uint8Array[] = [];
      let size = 0;

      try {
        while (true) {
          const { done, value } = await transport(() => reader.read(), controller.signal);
          if (done) {
            break;
          }

          size += value.byteLength;
          if (size > 65536) {
            await transport(() => reader.cancel(), controller.signal);
            throw new ClassificationError('invalid_response');
          }

          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }

      const envelope = parseJson(Buffer.concat(chunks).toString('utf8'));
      if (
        !object(envelope) ||
        envelope.done !== true ||
        envelope.done_reason !== 'stop' ||
        !object(envelope.message) ||
        envelope.message.role !== 'assistant' ||
        typeof envelope.message.content !== 'string'
      ) {
        throw new ClassificationError('invalid_response');
      }

      const result = parseJson(envelope.message.content);
      if (!validate(result)) {
        throw new ClassificationError('invalid_response');
      }

      return result;
    } finally {
      clearTimeout(timer);
    }
  }
}
