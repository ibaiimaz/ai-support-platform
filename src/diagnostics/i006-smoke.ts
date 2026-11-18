import { ClassificationError } from '../application/classification-errors.js';
import type { LlmResponse } from '../application/classification-llm.js';
import type { ClassificationResult } from '../application/classification-result.js';
import { RetiredI006DiagnosticError } from './retired-i006.js';

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

export async function runSmoke(_options: unknown): Promise<never> {
  throw new RetiredI006DiagnosticError();
}
