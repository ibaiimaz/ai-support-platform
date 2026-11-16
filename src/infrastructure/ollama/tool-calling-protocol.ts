import { Ajv } from 'ajv';
import { categories } from '../../domain/classification.js';
import { ClassificationError } from '../../application/classification-errors.js';
import type { LlmMessage, LlmResponse, ToolCall } from '../../application/classification-llm.js';

export const toolCallingFinalSchema = {
  oneOf: [
    {
      type: 'object',
      required: ['type', 'category'],
      additionalProperties: false,
      properties: {
        type: { const: 'classification' },
        category: { type: 'string', enum: [...categories] },
      },
    },
    {
      type: 'object',
      required: ['type'],
      additionalProperties: false,
      properties: {
        type: { const: 'abstention' },
      },
    },
  ],
};

export const incidentLookupTool = {
  type: 'function',
  function: {
    name: 'getIncidentById',
    description: 'Consultar una incidencia anterior por su identificador cuando falte contexto.',
    parameters: {
      type: 'object',
      required: ['incidentId'],
      additionalProperties: false,
      properties: {
        incidentId: {
          type: 'string',
          description: 'Identificador de incidencia, por ejemplo INC-142.',
        },
      },
    },
  },
};

const validateFinal = new Ajv({
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
}).compile<Exclude<LlmResponse, { type: 'tool_calls' }>>(toolCallingFinalSchema);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

export function toOllamaMessages(messages: LlmMessage[]) {
  return messages.map((message) => {
    if (message.role === 'assistant' && 'toolCalls' in message) {
      return {
        role: 'assistant',
        content: '',
        tool_calls: message.toolCalls.map((call) => ({
          ...(call.callId !== undefined ? { id: call.callId } : {}),
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }

    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_name: message.name,
        content: message.content,
        ...(message.callId !== undefined ? { tool_call_id: message.callId } : {}),
      };
    }

    return { role: message.role, content: message.content };
  });
}

function readToolCall(value: unknown): ToolCall {
  if (
    !isObject(value) ||
    ('type' in value && value.type !== 'function') ||
    ('id' in value && typeof value.id !== 'string') ||
    !isObject(value.function) ||
    typeof value.function.name !== 'string' ||
    !Object.hasOwn(value.function, 'arguments')
  ) {
    throw new ClassificationError('invalid_response');
  }

  return {
    name: value.function.name,
    arguments: value.function.arguments,
    ...(typeof value.id === 'string' ? { callId: value.id } : {}),
  };
}

export function parseToolCallingResponse(text: string): LlmResponse {
  const envelope = parseJson(text);
  if (
    !isObject(envelope) ||
    envelope.done !== true ||
    envelope.done_reason !== 'stop' ||
    !isObject(envelope.message) ||
    envelope.message.role !== 'assistant'
  ) {
    throw new ClassificationError('invalid_response');
  }

  const message = envelope.message;
  if (Object.hasOwn(message, 'tool_calls')) {
    if (
      !Array.isArray(message.tool_calls) ||
      (Object.hasOwn(message, 'content') && message.content !== '')
    ) {
      throw new ClassificationError('invalid_response');
    }

    // Preserve every request, even an empty list, for application-level authorization.
    return { type: 'tool_calls', calls: message.tool_calls.map(readToolCall) };
  }

  if (typeof message.content !== 'string') {
    throw new ClassificationError('invalid_response');
  }

  const result = parseJson(message.content);
  if (!validateFinal(result)) {
    throw new ClassificationError('invalid_response');
  }

  return result;
}
