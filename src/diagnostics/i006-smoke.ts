import { classifyIncident } from '../application/classify-incident.js';
import { ClassificationError } from '../application/classification-errors.js';
import { classificationTimeouts } from '../application/classification-timeouts.js';
import {
  GlobalDeadlineExceededError,
  InvalidToolCallError,
} from '../application/tool-calling-errors.js';
import { readIncidentId } from '../application/get-incident-by-id.js';
import { createClassificationDependencies } from '../composition.js';
import type { Config } from '../config.js';
import type { LlmResponse } from '../application/classification-llm.js';
import type { ClassificationResult } from '../application/classification-result.js';

export const smokeCase = {
  id: 'I006-SMOKE-INC-142',
  description:
    'Retomo el asunto de INC-142. Los detalles de lo que necesito están en esa incidencia',
  maximumAttempts: 2,
} as const;

export class SmokeOperationalError extends Error {
  constructor() {
    super('Smoke diagnostic blocked by operational controls');
  }
}

export interface SmokeAccounting {
  scope: 'I006_SMOKE_COMPATIBILITY';
  maximumAttempts: 2;
  reservedAttempts: number;
  dispatchesObserved: number;
  validatedResponses: number;
  notDispatched: number;
  uncertainDispatches: number;
  experimentalBudgetTouched: false;
  maximumExperimentalAttempts: 120;
  maximumCombinedAttempts: 122;
}

export interface SmokeResult {
  technicalStatus:
    | 'VALID_OBSERVED'
    | 'PROTOCOL_ERROR'
    | 'TRANSPORT_ERROR'
    | 'HTTP_ERROR'
    | 'TIMEOUT'
    | 'UNEXPECTED_ERROR'
    | 'NOT_OBSERVED';
  scenarioStatus: 'PASSED' | 'FAILED' | 'NOT_EXERCISED' | 'INCOMPLETE';
  operationalStatus: 'OK' | 'FAILED';
  reason:
    | 'EXPECTED_PATH'
    | 'TOOL_NOT_REQUESTED'
    | 'WRONG_TOOL_DECISION'
    | 'WRONG_FINAL_RESULT'
    | 'POLICY_VIOLATION'
    | 'TECHNICAL_FAILURE'
    | 'OPERATIONAL_FAILURE';
  firstResponse: LlmResponse['type'] | null;
  secondResponse: LlmResponse['type'] | null;
  expectedToolMatched: boolean | null;
  toolExecutions: number;
  toolOutcome: 'FOUND' | 'NOT_FOUND' | null;
  final: ClassificationResult | null;
  accounting: SmokeAccounting;
  latencyMs: number;
}

export function createGuardedTransport(options: {
  request: typeof fetch;
  baseUrl: string;
  reserve: (attempt: number) => Promise<void>;
  beforeDispatch: () => void;
}) {
  let closed = false;
  let failed = false;
  let active = false;
  let reserved = 0;
  let dispatched = 0;
  const pending = new Set<Promise<void>>();
  const request: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (
      closed ||
      failed ||
      active ||
      reserved >= smokeCase.maximumAttempts ||
      url !== new URL('/api/chat', options.baseUrl).href ||
      init?.method !== 'POST'
    ) {
      failed = true;
      throw new SmokeOperationalError();
    }
    active = true;
    reserved++;
    let reservation: Promise<void> | undefined;
    try {
      reservation = Promise.resolve().then(() => options.reserve(reserved));
      pending.add(reservation);
      try {
        await reservation;
      } catch {
        failed = true;
        throw new SmokeOperationalError();
      }
      options.beforeDispatch();
      if (init.signal?.aborted) {
        throw new ClassificationError('timeout');
      }
      if (closed || failed) {
        throw new SmokeOperationalError();
      }
      dispatched++;
      return await options.request(input, init);
    } catch (error) {
      // Any failed attempt closes this transport to subsequent dispatches.
      closed = true;
      if (error instanceof SmokeOperationalError) {
        failed = true;
      }
      throw error;
    } finally {
      if (reservation) {
        pending.delete(reservation);
      }
      active = false;
    }
  };
  return {
    request,
    close() {
      closed = true;
    },
    async settle() {
      await Promise.allSettled([...pending]);
    },
    accounting(validatedResponses: number): SmokeAccounting {
      return {
        scope: 'I006_SMOKE_COMPATIBILITY',
        maximumAttempts: 2,
        reservedAttempts: reserved,
        dispatchesObserved: dispatched,
        validatedResponses,
        notDispatched: reserved - dispatched,
        uncertainDispatches: dispatched - validatedResponses,
        experimentalBudgetTouched: false,
        maximumExperimentalAttempts: 120,
        maximumCombinedAttempts: 122,
      };
    },
    operationalFailure() {
      return failed;
    },
  };
}

export async function runSmoke(options: {
  config: Pick<Config, 'baseUrl' | 'model'>;
  request: typeof fetch;
  reserve: (attempt: number) => Promise<void>;
  verify: () => void;
  now?: () => number;
}): Promise<SmokeResult> {
  const now = options.now ?? (() => performance.now());
  const started = now();
  let callExpiresAt = started;
  const transport = createGuardedTransport({
    request: options.request,
    baseUrl: options.config.baseUrl,
    reserve: options.reserve,
    beforeDispatch() {
      try {
        options.verify();
      } catch {
        throw new SmokeOperationalError();
      }
      if (now() >= started + classificationTimeouts.overallMs) {
        throw new GlobalDeadlineExceededError();
      }
      if (now() >= callExpiresAt) {
        throw new ClassificationError('timeout');
      }
    },
  });
  const dependencies = createClassificationDependencies(options.config, transport.request);
  const llm = dependencies.llm;
  const repository = dependencies.repository;
  let validated = 0;
  let first: LlmResponse['type'] | null = null;
  let second: LlmResponse['type'] | null = null;
  let expectedToolMatched: boolean | null = null;
  let executions = 0;
  let toolOutcome: SmokeResult['toolOutcome'] = null;
  let final: ClassificationResult | null = null;
  let technicalStatus: SmokeResult['technicalStatus'] = 'NOT_OBSERVED';
  let scenarioStatus: SmokeResult['scenarioStatus'] = 'INCOMPLETE';
  let reason: SmokeResult['reason'] = 'TECHNICAL_FAILURE';
  let operationalStatus: SmokeResult['operationalStatus'] = 'OK';
  dependencies.llm = {
    async infer(messages, settings) {
      callExpiresAt = now() + settings.timeoutMs;
      const response = await llm.infer(messages, settings);
      validated++;
      if (settings.toolsEnabled) {
        first = response.type;
        expectedToolMatched = false;
        if (response.type === 'tool_calls' && response.calls.length === 1) {
          try {
            expectedToolMatched = readIncidentId(response.calls[0]!) === 'INC-142';
          } catch {
            // Application still receives the original request and enforces its policy.
          }
        }
      } else {
        second = response.type;
      }
      return response;
    },
  };
  dependencies.repository = {
    async getById(id, settings) {
      executions++;
      const incident = await repository.getById(id, settings);
      toolOutcome = incident === null ? 'NOT_FOUND' : 'FOUND';
      return incident;
    },
  };
  try {
    final = await classifyIncident({ ...dependencies, now }, smokeCase.description);
    technicalStatus = 'VALID_OBSERVED';
    if (first !== 'tool_calls') {
      scenarioStatus = 'NOT_EXERCISED';
      reason = 'TOOL_NOT_REQUESTED';
    } else if (!expectedToolMatched || executions !== 1 || toolOutcome !== 'FOUND') {
      scenarioStatus = 'FAILED';
      reason = 'WRONG_TOOL_DECISION';
    } else if (final.status !== 'CLASSIFIED' || final.category !== 'BUG') {
      scenarioStatus = 'FAILED';
      reason = 'WRONG_FINAL_RESULT';
    } else {
      scenarioStatus = 'PASSED';
      reason = 'EXPECTED_PATH';
    }
  } catch (error) {
    if (error instanceof InvalidToolCallError) {
      technicalStatus = 'VALID_OBSERVED';
      scenarioStatus = 'FAILED';
      reason = 'POLICY_VIOLATION';
    } else if (error instanceof SmokeOperationalError) {
      operationalStatus = 'FAILED';
      reason = 'OPERATIONAL_FAILURE';
    } else if (error instanceof GlobalDeadlineExceededError) {
      technicalStatus = 'TIMEOUT';
    } else if (error instanceof ClassificationError) {
      technicalStatus =
        error.kind === 'invalid_response'
          ? 'PROTOCOL_ERROR'
          : error.kind === 'timeout'
            ? 'TIMEOUT'
            : error.kind === 'http_error'
              ? 'HTTP_ERROR'
              : 'TRANSPORT_ERROR';
    } else {
      technicalStatus = 'UNEXPECTED_ERROR';
    }
  } finally {
    // Close first, then await outstanding reservations before releasing the process lock.
    // A late disk completion must never dispatch after application timeout.
    transport.close();
    await transport.settle();
  }
  if (transport.operationalFailure()) {
    operationalStatus = 'FAILED';
    reason = 'OPERATIONAL_FAILURE';
  }
  return {
    technicalStatus,
    scenarioStatus,
    operationalStatus,
    reason,
    firstResponse: first,
    secondResponse: second,
    expectedToolMatched,
    toolExecutions: executions,
    toolOutcome,
    final,
    accounting: transport.accounting(validated),
    latencyMs: Math.max(0, now() - started),
  };
}
