import type { IncidentClassifier } from './incident-classifier.js';
import type { Classification } from '../domain/classification.js';
import type { ClassificationLlm, LlmMessage } from './classification-llm.js';
import type { ClassificationResult } from './classification-result.js';
import type { IncidentRepository } from './incident-repository.js';
import { ClassificationDeadline } from './classification-deadline.js';
import { assertLlmResponse, classificationResult } from './classification-response.js';
import { getIncidentById, type IncidentToolResult } from './get-incident-by-id.js';
import { IncidentRepositoryError, InvalidToolCallError } from './tool-calling-errors.js';

export interface ToolCallingDependencies {
  llm: ClassificationLlm;
  repository: IncidentRepository;
  systemInstructions: string;
  now?: () => number;
}

async function orchestrateClassification(
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
  assertLlmResponse(first);
  deadline.check();
  if (first.type !== 'tool_calls') {
    return classificationResult(first, false);
  }

  if (first.calls.length !== 1) {
    throw new InvalidToolCallError();
  }

  const call = first.calls[0]!;
  let toolResult: IncidentToolResult;
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

  const secondMessages: LlmMessage[] = [
    ...messages,
    { role: 'assistant', toolCalls: first.calls },
    {
      role: 'tool',
      name: call.name,
      content: JSON.stringify(toolResult),
      ...(call.callId !== undefined ? { callId: call.callId } : {}),
    },
  ];
  const second = await deadline.run('llm', (timeoutMs) =>
    dependencies.llm.infer(secondMessages, { timeoutMs, toolsEnabled: false }),
  );
  assertLlmResponse(second);
  deadline.check();
  if (second.type === 'tool_calls') {
    throw new InvalidToolCallError();
  }

  return classificationResult(second, toolResult.status === 'UNAVAILABLE');
}

export function classifyIncident(
  classifier: IncidentClassifier,
  description: string,
): Promise<Classification>;

export function classifyIncident(
  dependencies: ToolCallingDependencies,
  description: string,
): Promise<ClassificationResult>;

export function classifyIncident(
  dependencies: IncidentClassifier | ToolCallingDependencies,
  description: string,
): Promise<Classification | ClassificationResult> {
  // Temporary compatibility path until HTTP and historical runners migrate separately.
  if ('classify' in dependencies) {
    return dependencies.classify(description);
  }

  return orchestrateClassification(dependencies, description);
}
