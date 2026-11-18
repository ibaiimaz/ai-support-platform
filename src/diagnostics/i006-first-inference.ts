import type { InvalidResponseDiagnostic } from '../application/classification-errors.js';
import type { Category } from '../domain/classification.js';
import { createGuardedTransport } from './i006-smoke.js';
import { RetiredI006DiagnosticError } from './retired-i006.js';

export const firstInferenceCase = { id: 'I006-001', maximumAttempts: 1 } as const;

export class FirstInferenceOperationalError extends Error {
  constructor() {
    super('First-inference diagnostic blocked by operational controls');
  }
}

export class DiagnosticSendLimitError extends Error {
  constructor() {
    super('Second diagnostic send blocked');
  }
}

type FirstObservation =
  | { type: 'classification'; category: Category }
  | { type: 'abstention' }
  | { type: 'tool_calls'; callCount: number };

export interface FirstInferenceResult {
  status:
    'FIRST_RESPONSE_OBSERVED' | 'TECHNICAL_ERROR' | 'SECOND_SEND_BLOCKED' | 'OPERATIONAL_FAILURE';
  firstResponse: FirstObservation | null;
  error:
    | 'invalid_response'
    | 'timeout'
    | 'connection_error'
    | 'http_error'
    | 'global_deadline_exceeded'
    | 'unexpected_error'
    | null;
  diagnostic?: InvalidResponseDiagnostic;
  accounting: {
    scope: 'I006_FIRST_INFERENCE';
    maximumAttempts: 1;
    reservedAttempts: number;
    dispatchesObserved: number;
    validatedResponses: number;
    uncertainDispatches: number;
    experimentalBudgetTouched: false;
  };
  latencyMs: number;
}

export function createSingleSendTransport(options: {
  request: typeof fetch;
  baseUrl: string;
  reserve: (attempt: number) => Promise<void>;
  beforeDispatch: () => void;
}) {
  let claimed = false;
  let closed = false;
  let blocked = false;
  let reserved = 0;
  let dispatched = 0;
  const guarded = createGuardedTransport({
    ...options,
    async reserve(attempt) {
      if (attempt !== 1) {
        throw new FirstInferenceOperationalError();
      }
      reserved = 1;
      await options.reserve(attempt);
    },
    async request(input, init) {
      dispatched++;
      return options.request(input, init);
    },
  });
  const request: typeof fetch = async (input, init) => {
    // Claim before awaiting persistence: concurrent and later sends cannot enter the guard.
    if (claimed || closed) {
      blocked = true;
      throw new DiagnosticSendLimitError();
    }
    claimed = true;
    return guarded.request(input, init);
  };
  return {
    request,
    close() {
      closed = true;
      guarded.close();
    },
    settle: guarded.settle,
    blocked: () => blocked,
    operationalFailure: guarded.operationalFailure,
    accounting(validated: number): FirstInferenceResult['accounting'] {
      return {
        scope: 'I006_FIRST_INFERENCE',
        maximumAttempts: 1,
        reservedAttempts: reserved,
        dispatchesObserved: dispatched,
        validatedResponses: validated,
        uncertainDispatches: dispatched - validated,
        experimentalBudgetTouched: false,
      };
    },
  };
}

export async function runFirstInference(_options: unknown): Promise<never> {
  throw new RetiredI006DiagnosticError();
}
