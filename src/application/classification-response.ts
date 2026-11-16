import { categories } from '../domain/classification.js';
import type { LlmResponse } from './classification-llm.js';
import type { ClassificationResult } from './classification-result.js';
import { ClassificationError } from './classification-errors.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Reflect.ownKeys(value).every(
      (key) => typeof key === 'string' && (required.includes(key) || optional.includes(key)),
    )
  );
}

export function assertLlmResponse(value: unknown): asserts value is LlmResponse {
  if (!isObject(value)) {
    throw new ClassificationError('invalid_response');
  }

  if (value.type === 'classification') {
    if (
      !hasKeys(value, ['type', 'category']) ||
      !categories.some((category) => category === value.category)
    ) {
      throw new ClassificationError('invalid_response');
    }

    return;
  }

  if (value.type === 'abstention') {
    if (!hasKeys(value, ['type'])) {
      throw new ClassificationError('invalid_response');
    }

    return;
  }

  if (
    value.type === 'tool_calls' &&
    hasKeys(value, ['type', 'calls']) &&
    Array.isArray(value.calls)
  ) {
    for (const call of value.calls) {
      if (
        !isObject(call) ||
        !hasKeys(call, ['name', 'arguments'], ['callId']) ||
        typeof call.name !== 'string' ||
        (Object.hasOwn(call, 'callId') && typeof call.callId !== 'string')
      ) {
        throw new ClassificationError('invalid_response');
      }
    }

    // Count, tool names and argument semantics are policy, not structural validation.
    return;
  }

  throw new ClassificationError('invalid_response');
}

export function classificationResult(
  response: Exclude<LlmResponse, { type: 'tool_calls' }>,
  toolUnavailable: boolean,
): ClassificationResult {
  if (response.type === 'classification') {
    return { status: 'CLASSIFIED', category: response.category };
  }

  return { status: 'INSUFFICIENT_CONTEXT', category: null, toolUnavailable };
}
