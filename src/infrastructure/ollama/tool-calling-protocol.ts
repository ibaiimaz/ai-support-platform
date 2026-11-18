import { Ajv } from 'ajv';
import { categories } from '../../domain/classification.js';
import {
  ClassificationError,
  type InvalidResponseDiagnostic,
} from '../../application/classification-errors.js';
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
}).compile<Exclude<LlmResponse, { type: 'tool_calls' } | { type: 'no_lookup' }>>(
  toolCallingFinalSchema,
);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string, diagnostic: InvalidResponseDiagnostic): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ClassificationError('invalid_response', diagnostic);
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
    throw new ClassificationError('invalid_response', 'TOOL_CALL_STRUCTURE_INVALID');
  }

  return {
    name: value.function.name,
    arguments: value.function.arguments,
    ...(typeof value.id === 'string' ? { callId: value.id } : {}),
  };
}

export function parseToolCallingResponse(text: string, decisionPhase = false): LlmResponse {
  const envelope = parseJson(text, 'ENVELOPE_JSON_INVALID');
  if (!isObject(envelope) || !isObject(envelope.message) || envelope.message.role !== 'assistant') {
    throw new ClassificationError('invalid_response', 'ENVELOPE_INVALID');
  }

  if (envelope.done !== true || envelope.done_reason !== 'stop') {
    throw new ClassificationError('invalid_response', 'TERMINATION_INVALID');
  }

  const message = envelope.message;
  if (Object.hasOwn(message, 'tool_calls')) {
    if (!Array.isArray(message.tool_calls)) {
      throw new ClassificationError('invalid_response', 'TOOL_CALL_STRUCTURE_INVALID');
    }
    if (Object.hasOwn(message, 'content') && message.content !== '') {
      throw new ClassificationError('invalid_response', 'MIXED_CONTENT_AND_TOOLS');
    }

    // Preserve every request, even an empty list, for application-level authorization.
    return { type: 'tool_calls', calls: message.tool_calls.map(readToolCall) };
  }

  if (decisionPhase) {
    if (Object.hasOwn(message, 'content') && typeof message.content !== 'string') {
      throw new ClassificationError('invalid_response', 'ENVELOPE_INVALID');
    }
    return { type: 'no_lookup' };
  }

  if (typeof message.content !== 'string') {
    throw new ClassificationError('invalid_response', 'FINAL_CONTENT_INVALID');
  }

  const result = parseJson(message.content, 'FINAL_JSON_INVALID');
  if (!validateFinal(result)) {
    throw new ClassificationError('invalid_response', 'FINAL_SCHEMA_INVALID');
  }

  return result;
}
