import type { ClassificationLlm, LlmMessage } from './classification-llm.js';
import type { ClassificationResult } from './classification-result.js';
import type { IncidentRepository } from './incident-repository.js';
import { ClassificationDeadline } from './classification-deadline.js';
import {
  assertLookupDecision,
  assertFinalResponse,
  classificationResult,
} from './classification-response.js';
import { getIncidentById, type IncidentToolResult } from './get-incident-by-id.js';
import { IncidentRepositoryError, InvalidToolCallError } from './tool-calling-errors.js';

export interface ToolCallingDependencies {
  llm: ClassificationLlm;
  repository: IncidentRepository;
  systemInstructions: string;
  classificationInstructions: string;
  now?: () => number;
}

export async function classifyIncident(
  dependencies: ToolCallingDependencies,
  description: string,
): Promise<ClassificationResult> {
  const deadline = new ClassificationDeadline(dependencies.now);
  const messages: LlmMessage[] = [
    { role: 'system', content: dependencies.systemInstructions },
    { role: 'user', content: description },
  ];
  const first = await deadline.run('llm', (timeoutMs) =>
    dependencies.llm.infer(messages, { timeoutMs, toolsEnabled: true }),
  );
  assertLookupDecision(first);
  deadline.check();
  const secondMessages: LlmMessage[] = [
    { role: 'system', content: dependencies.classificationInstructions },
    { role: 'user', content: description },
  ];
  let toolResult: IncidentToolResult | undefined;
  if (first.type === 'tool_calls') {
    if (first.calls.length !== 1) {
      throw new InvalidToolCallError();
    }
    const call = first.calls[0]!;
    try {
      toolResult = await deadline.run('tool', (timeoutMs) =>
        getIncidentById(dependencies.repository, call, { timeoutMs }),
      );
    } catch (error) {
      if (!(error instanceof IncidentRepositoryError)) {
        throw error;
      }
      deadline.check();
      toolResult = { status: 'UNAVAILABLE' };
    }
    secondMessages.push(
      { role: 'assistant', toolCalls: first.calls },
      {
        role: 'tool',
        name: call.name,
        content: JSON.stringify(toolResult),
        ...(call.callId !== undefined ? { callId: call.callId } : {}),
      },
    );
  }
  const second = await deadline.run('llm', (timeoutMs) =>
    dependencies.llm.infer(secondMessages, { timeoutMs, toolsEnabled: false }),
  );
  assertFinalResponse(second);
  deadline.check();
  if (second.type === 'tool_calls') {
    throw new InvalidToolCallError();
  }
  return classificationResult(second, toolResult?.status === 'UNAVAILABLE');
}
