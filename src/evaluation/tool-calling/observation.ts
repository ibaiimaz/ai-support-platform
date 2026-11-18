import type { ToolCallingDependencies } from '../../application/classify-incident.js';
import {
  assertFinalResponse,
  assertLookupDecision,
} from '../../application/classification-response.js';
import { readIncidentId } from '../../application/get-incident-by-id.js';
import { IncidentRepositoryError } from '../../application/tool-calling-errors.js';
import type {
  EvaluationCase,
  Observation,
  CaseResult,
  InferencePhase,
  AttemptAccounting,
} from './types.js';

export function observe(dependencies: ToolCallingDependencies, example: EvaluationCase) {
  const observation: Observation = {
    toolRequested: false,
    toolRequestValid: null,
    toolExecuted: false,
    toolOutcome: null,
    toolDecisionCorrect: null,
    requestCount: 0,
    executionCount: 0,
    inferenceCount: 0,
    requestedIds: [],
    violations: [],
  };
  let closed = false;
  let active: CaseResult['failurePhase'] = 'control';
  const phases: CaseResult['phases'] = {
    decision: {
      started: false,
      attempts: 0,
      dispatched: 0,
      reservationUncertain: false,
      status: 'NOT_STARTED',
    },
    classification: {
      started: false,
      attempts: 0,
      dispatched: 0,
      reservationUncertain: false,
      status: 'NOT_STARTED',
    },
  };
  const wrapped: ToolCallingDependencies = {
    ...dependencies,
    llm: {
      async infer(messages, options) {
        const phase: InferencePhase = options.toolsEnabled ? 'decision' : 'classification';
        if (closed || phases[phase].attempts !== 0) {
          throw new Error('Evaluation phase repeated or closed');
        }
        active = phase;
        // Port-only simulations observe a provider invocation here. The controlled runner
        // replaces these counters with durable reservations and actual transport dispatches.
        phases[phase] = {
          started: true,
          attempts: 1,
          dispatched: 1,
          reservationUncertain: false,
          status: 'TECHNICAL_ERROR',
        };
        try {
          const response = await dependencies.llm.infer(messages, options);
          if (closed) {
            return response;
          }
          if (options.toolsEnabled) {
            assertLookupDecision(response);
          } else {
            assertFinalResponse(response);
          }
          phases[phase].status = 'COMPLETED';
          if (response.type === 'tool_calls') {
            observation.toolRequested = true;
            observation.requestCount += Math.max(1, response.calls.length);
            let valid = response.calls.length === 1 && options.toolsEnabled;
            for (const call of response.calls) {
              try {
                observation.requestedIds.push(readIncidentId(call));
              } catch {
                valid = false;
              }
            }
            observation.toolRequestValid = observation.toolRequestValid === false ? false : valid;
            if (!valid) {
              observation.violations.push('INVALID_MULTIPLE_OR_ADDITIONAL_REQUEST');
            }
          }
          return response;
        } catch (error) {
          if (!closed && options.toolsEnabled && observation.toolRequested !== true) {
            observation.toolRequested = null;
          }
          throw error;
        }
      },
    },
    repository: {
      async getById(id, options) {
        if (closed) {
          throw new Error('Closed evaluation observation');
        }
        active = 'tool';
        observation.toolExecuted = true;
        observation.executionCount++;
        try {
          const incident = await dependencies.repository.getById(id, options);
          if (!closed) {
            observation.toolOutcome = incident === null ? 'NOT_FOUND' : 'FOUND';
          }
          return incident;
        } catch (error) {
          if (!closed && error instanceof IncidentRepositoryError) {
            observation.toolOutcome = 'UNAVAILABLE';
          }
          throw error;
        }
      },
    },
  };
  return {
    dependencies: wrapped,
    phaseResult(
      outcome: CaseResult['outcome'],
      accounting?: AttemptAccounting,
      controlFailure = false,
    ) {
      if (outcome !== 'COMPLETED' && (active === 'decision' || active === 'classification')) {
        phases[active].status =
          outcome === 'POLICY_VIOLATION' ? 'POLICY_REJECTED' : 'TECHNICAL_ERROR';
      }
      if (accounting) {
        for (const phase of ['decision', 'classification'] as const) {
          phases[phase].attempts = accounting[phase].reserved;
          phases[phase].dispatched = accounting[phase].dispatched;
          phases[phase].reservationUncertain = accounting[phase].reservationUncertain;
        }
      }
      observation.inferenceCount = phases.decision.attempts + phases.classification.attempts;
      return {
        phases: structuredClone(phases),
        failurePhase: outcome === 'COMPLETED' ? null : controlFailure ? 'control' : active,
      };
    },
    close(evaluable: boolean): Observation {
      closed = true;
      if (!phases.decision.started) {
        observation.toolRequested = null;
      }
      observation.toolDecisionCorrect = !evaluable
        ? null
        : example.toolExpected
          ? observation.toolRequested === true &&
            observation.toolRequestValid === true &&
            observation.requestCount === 1 &&
            observation.requestedIds[0] === example.expectedTool?.incidentId &&
            observation.violations.length === 0
          : observation.toolRequested === false && observation.violations.length === 0;
      return structuredClone(observation);
    },
  };
}
