import { plannedPhases } from '../../src/evaluation/tool-calling/protocol.js';
import { readFile } from 'node:fs/promises';
import { parseDataset } from '../../src/evaluation/tool-calling/dataset.js';
import type {
  CaseResult,
  EvaluationDataset,
  RunIdentity,
} from '../../src/evaluation/tool-calling/types.js';

export async function candidate(): Promise<EvaluationDataset> {
  return parseDataset(await readFile('evals/datasets/incidents-tool-calling-v1.json', 'utf8'));
}

export const identity: RunIdentity = {
  cohort: 'KNOWN_REGRESSION',
  systemFreezeHash: 'e'.repeat(64),
  maximumInferences: 104,
  datasetHash: 'a'.repeat(64),
  model: 'simulated',
  modelDigest: 'b'.repeat(64),
  ollamaVersion: 'test',
  modelMetadataHash: 'c'.repeat(64),
  protocolId: 'I006-HYBRID-CLASSIFICATION-V1',
  codeIdentity: {
    commit: null,
    method: 'typescript_emit_exact',
    compilerVersion: 'simulated',
    sourceSha256: 'a'.repeat(64),
    buildSha256: 'b'.repeat(64),
  },
  classificationPromptHash: 'c'.repeat(64),
  decisionPromptHash: 'd'.repeat(64),
  protocolHash: 'e'.repeat(64),
  codeReference: null,
  sourceStateHash: 'f'.repeat(64),
  baseUrl: 'http://invalid.test',
  temperature: 0,
  think: false,
  llmTimeoutMs: 45000,
  toolTimeoutMs: 5000,
  globalTimeoutMs: 90000,
};

export function perfectResults(dataset: EvaluationDataset): CaseResult[] {
  return dataset.examples.map((example) => ({
    id: example.id,
    outcome: 'COMPLETED',
    phases: {
      decision: {
        started: plannedPhases(example.description).length === 2,
        attempts: plannedPhases(example.description).length === 2 ? 1 : 0,
        dispatched: plannedPhases(example.description).length === 2 ? 1 : 0,
        reservationUncertain: false,
        status: plannedPhases(example.description).length === 2 ? 'COMPLETED' : 'NOT_STARTED',
      },
      classification: {
        started: true,
        attempts: 1,
        dispatched: 1,
        reservationUncertain: false,
        status: 'COMPLETED',
      },
    },
    failurePhase: null,
    observation: {
      decisionSource: plannedPhases(example.description).length === 2 ? 'LLM' : 'CODE',
      toolRequested: example.toolExpected,
      toolRequestValid: example.toolExpected ? true : null,
      toolExecuted: example.toolExpected,
      toolOutcome: example.toolExpected
        ? example.fixture.unavailableIds.includes(example.expectedTool!.incidentId)
          ? 'UNAVAILABLE'
          : example.fixture.incidents.some(
                (incident) => incident.id === example.expectedTool!.incidentId,
              )
            ? 'FOUND'
            : 'NOT_FOUND'
        : null,
      toolDecisionCorrect: true,
      requestCount: example.toolExpected ? 1 : 0,
      executionCount: example.toolExpected ? 1 : 0,
      inferenceCount: plannedPhases(example.description).length,
      requestedIds: example.expectedTool ? [example.expectedTool.incidentId] : [],
      violations: [],
    },
    final:
      example.expectedFinal.status === 'CLASSIFIED'
        ? { ...example.expectedFinal }
        : { ...example.expectedFinal, toolUnavailable: example.fixture.unavailableIds.length > 0 },
    error: null,
    latencyMs: 1,
  }));
}
