import { classifyIncident } from '../application/classify-incident.js';
import {
  ClassificationError,
  isInvalidResponseDiagnostic,
  type InvalidResponseDiagnostic,
} from '../application/classification-errors.js';
import { classificationTimeouts } from '../application/classification-timeouts.js';
import { GlobalDeadlineExceededError } from '../application/tool-calling-errors.js';
import { createClassificationDependencies } from '../composition.js';
import type { Config } from '../config.js';
import type { Category } from '../domain/classification.js';
import { createGuardedTransport, SmokeOperationalError } from './i006-smoke.js';

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

class FirstResponseObserved extends Error {}

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

export async function runFirstInference(options: {
  config: Pick<Config, 'baseUrl' | 'model'>;
  description: string;
  request: typeof fetch;
  reserve: (attempt: number) => Promise<void>;
  verify: () => void;
  now?: () => number;
}): Promise<FirstInferenceResult> {
  const now = options.now ?? (() => performance.now());
  const start = now();
  let expiresAt = start;
  const transport = createSingleSendTransport({
    request: options.request,
    baseUrl: options.config.baseUrl,
    reserve: options.reserve,
    beforeDispatch() {
      try {
        options.verify();
      } catch {
        throw new FirstInferenceOperationalError();
      }
      if (now() >= start + classificationTimeouts.overallMs) {
        throw new GlobalDeadlineExceededError();
      }
      if (now() >= expiresAt) {
        throw new ClassificationError('timeout');
      }
    },
  });
  const dependencies = createClassificationDependencies(options.config, transport.request);
  const llm = dependencies.llm;
  let closed = false;
  let validated = 0;
  let firstResponse: FirstObservation | null = null;
  let status: FirstInferenceResult['status'] = 'TECHNICAL_ERROR';
  let error: FirstInferenceResult['error'] = null;
  let diagnostic: InvalidResponseDiagnostic | undefined;
  dependencies.llm = {
    async infer(messages, settings) {
      expiresAt = now() + settings.timeoutMs;
      const response = await llm.infer(messages, settings);
      if (!closed) {
        validated++;
        firstResponse =
          response.type === 'tool_calls'
            ? { type: 'tool_calls', callCount: response.calls.length }
            : response.type === 'classification'
              ? { type: 'classification', category: response.category }
              : { type: 'abstention' };
      }
      // Do not return tool calls to application: stop before policy or repository access.
      throw new FirstResponseObserved();
    },
  };
  try {
    await classifyIncident({ ...dependencies, now }, options.description);
  } catch (cause) {
    if (cause instanceof FirstResponseObserved) {
      status = 'FIRST_RESPONSE_OBSERVED';
    } else if (cause instanceof DiagnosticSendLimitError) {
      status = 'SECOND_SEND_BLOCKED';
    } else if (
      cause instanceof FirstInferenceOperationalError ||
      cause instanceof SmokeOperationalError
    ) {
      status = 'OPERATIONAL_FAILURE';
    } else if (
      cause instanceof ClassificationError ||
      cause instanceof GlobalDeadlineExceededError
    ) {
      error = cause.kind;
      if (
        cause instanceof ClassificationError &&
        cause.kind === 'invalid_response' &&
        isInvalidResponseDiagnostic(cause.diagnostic)
      ) {
        diagnostic = cause.diagnostic;
      }
    } else {
      error = 'unexpected_error';
    }
  } finally {
    closed = true;
    transport.close();
    await transport.settle();
  }
  if (transport.operationalFailure()) {
    status = 'OPERATIONAL_FAILURE';
  } else if (transport.blocked()) {
    status = 'SECOND_SEND_BLOCKED';
  }
  return {
    status,
    firstResponse,
    error,
    ...(diagnostic === undefined ? {} : { diagnostic }),
    accounting: transport.accounting(validated),
    latencyMs: Math.max(0, now() - start),
  };
}
