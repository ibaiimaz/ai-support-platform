import type { LlmResponse } from '../application/classification-llm.js';
import type { InvalidResponseDiagnostic } from '../application/classification-errors.js';
import {
  incidentLookupTool,
  toolCallingFinalSchema,
} from '../infrastructure/ollama/tool-calling-protocol.js';
import { smokeCase, SmokeOperationalError } from './i006-smoke.js';
import { RetiredI006DiagnosticError } from './retired-i006.js';

export const toolsFormatProtocol = {
  id: 'I006_TOOLS_FORMAT',
  scenarioOrder: ['A', 'B'],
  maximumAttempts: 4,
  scenarioLimits: { A: 1, B: 2 },
  directCaseId: 'I006-001',
  lookupCaseId: smokeCase.id,
} as const;

export type Scenario = 'A' | 'B';

export class ToolsFormatOperationalError extends SmokeOperationalError {}

export interface ScenarioResult {
  scenario: Scenario;
  status: 'OBSERVED' | 'TECHNICAL_ERROR' | 'OPERATIONAL_FAILURE';
  firstResponse: {
    type: LlmResponse['type'];
    category?: 'BUG' | 'FEATURE' | 'QUESTION';
    callCount?: number;
  } | null;
  finalResponse:
    | { type: 'classification'; category: 'BUG' | 'FEATURE' | 'QUESTION' }
    | { type: 'abstention' }
    | null;
  directClassificationValid: boolean | null;
  nativeToolCallMatched: boolean | null;
  continuationValid: boolean | null;
  semanticCorrect: boolean | null;
  toolExecutions: number;
  toolOutcome: 'FOUND' | 'NOT_FOUND' | null;
  error:
    | 'invalid_response'
    | 'timeout'
    | 'connection_error'
    | 'http_error'
    | 'global_deadline_exceeded'
    | 'unexpected_error'
    | null;
  diagnostic?: InvalidResponseDiagnostic;
  reservedAttempts: number;
  dispatchesObserved: number;
  validatedResponses: number;
  uncertainDispatches: number;
  latencyMs: number;
}

// Applies only to this diagnostic; the production adapter continues building its original payload.
export function withFirstRequestFormat(request: typeof fetch, model: string): typeof fetch {
  let calls = 0;
  return async (input, init) => {
    let body: Record<string, unknown>;
    try {
      if (typeof init?.body !== 'string') {
        throw new ToolsFormatOperationalError();
      }
      body = JSON.parse(init.body);
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        body.model !== model ||
        body.stream !== false ||
        JSON.stringify(body.options) !== JSON.stringify({ temperature: 0 })
      ) {
        throw new ToolsFormatOperationalError();
      }
      if (calls === 0) {
        if (
          Object.hasOwn(body, 'format') ||
          JSON.stringify(body.tools) !== JSON.stringify([incidentLookupTool])
        ) {
          throw new ToolsFormatOperationalError();
        }
      } else if (
        Object.hasOwn(body, 'tools') ||
        JSON.stringify(body.format) !== JSON.stringify(toolCallingFinalSchema)
      ) {
        throw new ToolsFormatOperationalError();
      }
    } catch {
      throw new ToolsFormatOperationalError();
    }
    const first = calls++ === 0;
    return request(
      input,
      first ? { ...init, body: JSON.stringify({ ...body, format: toolCallingFinalSchema }) } : init,
    );
  };
}

export function createToolsFormatBudget(
  persistReservation: (scenario: Scenario, attempt: number) => Promise<void>,
) {
  let total = 0;
  let failed = false;
  let active = false;
  const counts = { A: 0, B: 0 };
  return {
    async reserve(scenario: Scenario, attempt: number) {
      if (active) {
        failed = true;
        throw new ToolsFormatOperationalError();
      }
      if (
        failed ||
        total >= toolsFormatProtocol.maximumAttempts ||
        attempt !== counts[scenario] + 1 ||
        attempt > toolsFormatProtocol.scenarioLimits[scenario] ||
        (scenario === 'A' && counts.B > 0) ||
        (scenario === 'B' && counts.A !== 1)
      ) {
        throw new ToolsFormatOperationalError();
      }
      active = true;
      counts[scenario]++;
      total++;
      try {
        await persistReservation(scenario, attempt);
        if (failed) {
          throw new ToolsFormatOperationalError();
        }
      } catch {
        failed = true;
        throw new ToolsFormatOperationalError();
      } finally {
        active = false;
      }
    },
    consumed: () => total,
  };
}

export async function runToolsFormat(_options: unknown): Promise<never> {
  throw new RetiredI006DiagnosticError();
}
