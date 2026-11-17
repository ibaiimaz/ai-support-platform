import type { ToolCall } from './classification-llm.js';
import type { IncidentRepository } from './incident-repository.js';
import { IncidentRepositoryError, InvalidToolCallError } from './tool-calling-errors.js';
import type { Incident } from '../domain/incident.js';

export type IncidentToolResult =
  | {
      status: 'FOUND';
      incident: Incident;
    }
  | {
      status: 'NOT_FOUND';
      incidentId: string;
    }
  | {
      status: 'UNAVAILABLE';
    };

export function readIncidentId(call: ToolCall): string {
  if (
    call.name !== 'getIncidentById' ||
    typeof call.arguments !== 'object' ||
    call.arguments === null ||
    Array.isArray(call.arguments)
  ) {
    throw new InvalidToolCallError();
  }

  const keys = Reflect.ownKeys(call.arguments);
  if (keys.length !== 1 || keys[0] !== 'incidentId') {
    throw new InvalidToolCallError();
  }

  const incidentId = (call.arguments as { incidentId: unknown }).incidentId;
  if (typeof incidentId !== 'string') {
    throw new InvalidToolCallError();
  }

  const normalizedId = incidentId.replace(/^inc-/i, 'INC-');
  const match = /^INC-[1-9][0-9]{0,5}$/.exec(normalizedId);
  // JavaScript's $ also matches before a final newline: require the entire input.
  if (match?.[0] !== normalizedId) {
    throw new InvalidToolCallError();
  }

  return normalizedId;
}

export async function getIncidentById(
  repository: IncidentRepository,
  call: ToolCall,
  options: {
    timeoutMs: number;
  },
): Promise<IncidentToolResult> {
  const incidentId = readIncidentId(call);
  let incident: Incident | null;

  try {
    incident = await repository.getById(incidentId, options);
  } catch (error) {
    if (error instanceof IncidentRepositoryError) {
      return { status: 'UNAVAILABLE' };
    }

    throw error;
  }

  if (incident === null) {
    return { status: 'NOT_FOUND', incidentId };
  }

  // Copy only allowed data fields; never interpret retrieved text as instructions.
  return {
    status: 'FOUND',
    incident: {
      id: incident.id,
      title: Array.from(incident.title).slice(0, 200).join(''),
      description: Array.from(incident.description).slice(0, 2_000).join(''),
      category: incident.category,
    },
  };
}
