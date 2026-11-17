import type { ToolCallingDependencies } from '../../application/classify-incident.js';
import { assertLlmResponse } from '../../application/classification-response.js';
import { readIncidentId } from '../../application/get-incident-by-id.js';
import { IncidentRepositoryError } from '../../application/tool-calling-errors.js';
import type { EvaluationCase, Observation } from './types.js';

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
  const wrapped: ToolCallingDependencies = {
    ...dependencies,
    llm: {
      async infer(messages, options) {
        observation.inferenceCount++;
        try {
          const response = await dependencies.llm.infer(messages, options);
          if (closed) {
            return response;
          }
          assertLlmResponse(response);
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
          if (!closed && observation.toolRequested !== true) {
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
    close(evaluable: boolean): Observation {
      closed = true;
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
