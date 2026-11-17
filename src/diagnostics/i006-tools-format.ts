import { classifyIncident } from '../application/classify-incident.js';
import {
  ClassificationError,
  isInvalidResponseDiagnostic,
  type InvalidResponseDiagnostic,
} from '../application/classification-errors.js';
import { classificationTimeouts } from '../application/classification-timeouts.js';
import {
  GlobalDeadlineExceededError,
  InvalidToolCallError,
} from '../application/tool-calling-errors.js';
import { readIncidentId } from '../application/get-incident-by-id.js';
import type { LlmResponse } from '../application/classification-llm.js';
import { createClassificationDependencies } from '../composition.js';
import type { Config } from '../config.js';
import {
  incidentLookupTool,
  toolCallingFinalSchema,
} from '../infrastructure/ollama/tool-calling-protocol.js';
import { createGuardedTransport, smokeCase, SmokeOperationalError } from './i006-smoke.js';
import { createSingleSendTransport } from './i006-first-inference.js';

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

class ScenarioStopped extends Error {}

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

async function runScenario(options: {
  scenario: Scenario;
  description: string;
  config: Pick<Config, 'baseUrl' | 'model'>;
  request: typeof fetch;
  reserve: (scenario: Scenario, attempt: number) => Promise<void>;
  verify: () => void;
  now?: () => number;
}): Promise<ScenarioResult> {
  const now = options.now ?? (() => performance.now());
  const started = now();
  let expiresAt = started;
  let closed = false;
  const result: ScenarioResult = {
    scenario: options.scenario,
    status: 'OBSERVED',
    firstResponse: null,
    finalResponse: null,
    directClassificationValid: options.scenario === 'A' ? false : null,
    nativeToolCallMatched: options.scenario === 'B' ? false : null,
    continuationValid: options.scenario === 'B' ? false : null,
    semanticCorrect: null,
    toolExecutions: 0,
    toolOutcome: null,
    error: null,
    reservedAttempts: 0,
    dispatchesObserved: 0,
    validatedResponses: 0,
    uncertainDispatches: 0,
    latencyMs: 0,
  };
  const controls = {
    baseUrl: options.config.baseUrl,
    async reserve(attempt: number) {
      result.reservedAttempts++;
      await options.reserve(options.scenario, attempt);
    },
    beforeDispatch() {
      try {
        options.verify();
      } catch {
        throw new ToolsFormatOperationalError();
      }
      if (now() >= started + classificationTimeouts.overallMs) {
        throw new GlobalDeadlineExceededError();
      }
      if (now() >= expiresAt) {
        throw new ClassificationError('timeout');
      }
    },
    async request(input: Parameters<typeof fetch>[0], init?: RequestInit) {
      result.dispatchesObserved++;
      return options.request(input, init);
    },
  };
  const guard =
    options.scenario === 'A'
      ? createSingleSendTransport(controls)
      : createGuardedTransport(controls);
  const dependencies = createClassificationDependencies(
    options.config,
    withFirstRequestFormat(guard.request, options.config.model),
  );
  const llm = dependencies.llm;
  const repository = dependencies.repository;
  dependencies.llm = {
    async infer(messages, settings) {
      expiresAt = now() + settings.timeoutMs;
      const response = await llm.infer(messages, settings);
      if (closed) {
        throw new ToolsFormatOperationalError();
      }
      result.validatedResponses++;
      if (settings.toolsEnabled) {
        result.firstResponse =
          response.type === 'classification'
            ? { type: response.type, category: response.category }
            : response.type === 'tool_calls'
              ? { type: response.type, callCount: response.calls.length }
              : { type: response.type };
        if (options.scenario === 'A') {
          if (response.type !== 'tool_calls') {
            result.finalResponse =
              response.type === 'classification'
                ? { type: response.type, category: response.category }
                : { type: response.type };
          }
          result.directClassificationValid = response.type === 'classification';
          result.semanticCorrect =
            response.type === 'classification' ? response.category === 'BUG' : null;
          throw new ScenarioStopped();
        }
        let matched = false;
        if (response.type === 'tool_calls' && response.calls.length === 1) {
          try {
            matched = readIncidentId(response.calls[0]!) === 'INC-142';
          } catch {
            /* No repair or alternative request. */
          }
        }
        result.nativeToolCallMatched = matched;
        if (!matched) {
          throw new ScenarioStopped();
        }
      }
      return response;
    },
  };
  dependencies.repository = {
    async getById(id, settings) {
      if (
        closed ||
        options.scenario !== 'B' ||
        id !== 'INC-142' ||
        !result.nativeToolCallMatched ||
        result.toolExecutions !== 0
      ) {
        throw new ToolsFormatOperationalError();
      }
      result.toolExecutions++;
      let incident;
      try {
        incident = await repository.getById(id, settings);
      } catch {
        throw new ToolsFormatOperationalError();
      }
      if (!closed) {
        result.toolOutcome = incident === null ? 'NOT_FOUND' : 'FOUND';
      }
      if (incident === null) {
        throw new ScenarioStopped();
      }
      return incident;
    },
  };
  try {
    const final = await classifyIncident({ ...dependencies, now }, options.description);
    result.continuationValid = true;
    result.finalResponse =
      final.status === 'CLASSIFIED'
        ? { type: 'classification', category: final.category }
        : { type: 'abstention' };
    result.semanticCorrect = final.status === 'CLASSIFIED' ? final.category === 'BUG' : null;
  } catch (cause) {
    if (cause instanceof ScenarioStopped || cause instanceof InvalidToolCallError) {
      // Valid protocol with a scenario deviation is not a provider failure.
    } else if (cause instanceof SmokeOperationalError) {
      result.status = 'OPERATIONAL_FAILURE';
    } else if (
      cause instanceof ClassificationError ||
      cause instanceof GlobalDeadlineExceededError
    ) {
      result.status = 'TECHNICAL_ERROR';
      result.error = cause.kind;
      if (
        cause instanceof ClassificationError &&
        cause.kind === 'invalid_response' &&
        isInvalidResponseDiagnostic(cause.diagnostic)
      ) {
        result.diagnostic = cause.diagnostic;
      }
    } else {
      result.status = 'TECHNICAL_ERROR';
      result.error = 'unexpected_error';
    }
  } finally {
    closed = true;
    guard.close();
    await guard.settle();
  }
  if (guard.operationalFailure() || ('blocked' in guard && guard.blocked())) {
    result.status = 'OPERATIONAL_FAILURE';
  }
  result.uncertainDispatches = result.dispatchesObserved - result.validatedResponses;
  result.latencyMs = Math.max(0, now() - started);
  return result;
}

export async function runToolsFormat(options: {
  description: string;
  config: Pick<Config, 'baseUrl' | 'model'>;
  request: typeof fetch;
  reserve: (scenario: Scenario, attempt: number) => Promise<void>;
  record: (result: ScenarioResult) => Promise<void>;
  verify: () => void;
  now?: () => number;
}) {
  const results: ScenarioResult[] = [];
  for (const scenario of toolsFormatProtocol.scenarioOrder) {
    options.verify();
    const result = await runScenario({
      ...options,
      scenario,
      description: scenario === 'A' ? options.description : smokeCase.description,
    });
    await options.record(result);
    results.push(result);
    if (result.status !== 'OBSERVED') {
      break;
    }
  }
  const complete = results.length === 2 && results.every((result) => result.status === 'OBSERVED');
  const compatible =
    complete &&
    results[0]!.directClassificationValid === true &&
    results[1]!.nativeToolCallMatched === true &&
    results[1]!.continuationValid === true &&
    results[1]!.toolOutcome === 'FOUND';
  return {
    status: !complete
      ? 'INCOMPLETE'
      : compatible && results.every((result) => result.semanticCorrect === true)
        ? 'COMPLETE_PASSED'
        : 'COMPLETE_FAILED',
    compatibilityObserved: compatible,
    results,
    accounting: {
      scope: 'I006_TOOLS_FORMAT',
      maximumAttempts: 4,
      scenarioLimits: toolsFormatProtocol.scenarioLimits,
      reservedAttempts: results.reduce((sum, result) => sum + result.reservedAttempts, 0),
      dispatchesObserved: results.reduce((sum, result) => sum + result.dispatchesObserved, 0),
      validatedResponses: results.reduce((sum, result) => sum + result.validatedResponses, 0),
      uncertainDispatches: results.reduce((sum, result) => sum + result.uncertainDispatches, 0),
      experimentalBudgetTouched: false,
    },
  };
}
