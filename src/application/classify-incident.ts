import type { ClassificationLlm, LlmMessage } from './classification-llm.js';
import type { ClassificationResult } from './classification-result.js';
import type { IncidentRepository } from './incident-repository.js';
import { ClassificationDeadline } from './classification-deadline.js';
import {
  assertLookupDecision,
  assertFinalResponse,
  classificationResult,
} from './classification-response.js';
import { extractIncidentReferences } from './incident-references.js';
import { readIncidentId, getIncidentById, type IncidentToolResult } from './get-incident-by-id.js';
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
  const eligibleIncidentIds = extractIncidentReferences(description);
  const decision =
    eligibleIncidentIds.length === 0
      ? { type: 'no_lookup' as const }
      : await deadline.run('llm', (timeoutMs) =>
          dependencies.llm.infer(messages, { timeoutMs, toolsEnabled: true, eligibleIncidentIds }),
        );
  assertLookupDecision(decision);
  deadline.check();
  const classificationMessages: LlmMessage[] = [
    { role: 'system', content: dependencies.classificationInstructions },
    { role: 'user', content: description },
  ];
  let toolResult: IncidentToolResult | undefined;
  if (decision.type === 'tool_calls') {
    if (decision.calls.length !== 1) {
      throw new InvalidToolCallError();
    }
    const call = decision.calls[0]!;
    if (!eligibleIncidentIds.includes(readIncidentId(call))) {
      throw new InvalidToolCallError();
    }
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
    classificationMessages.push(
      { role: 'assistant', toolCalls: decision.calls },
      {
        role: 'tool',
        name: call.name,
        content: JSON.stringify(toolResult),
        ...(call.callId !== undefined ? { callId: call.callId } : {}),
      },
    );
  }
  const finalResponse = await deadline.run('llm', (timeoutMs) =>
    dependencies.llm.infer(classificationMessages, { timeoutMs, toolsEnabled: false }),
  );
  assertFinalResponse(finalResponse);
  deadline.check();
  if (finalResponse.type === 'tool_calls') {
    throw new InvalidToolCallError();
  }
  return classificationResult(finalResponse, toolResult?.status === 'UNAVAILABLE');
}
