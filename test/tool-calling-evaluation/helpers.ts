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
  datasetHash: 'a'.repeat(64),
  model: 'simulated',
  modelDigest: 'b'.repeat(64),
  ollamaVersion: 'test',
  modelMetadataHash: 'c'.repeat(64),
  promptHash: 'd'.repeat(64),
  protocolHash: 'e'.repeat(64),
  codeReference: null,
  sourceStateHash: 'f'.repeat(64),
  baseUrl: 'http://invalid.test',
  temperature: 0,
  llmTimeoutMs: 45000,
  toolTimeoutMs: 5000,
  globalTimeoutMs: 90000,
};

export function perfectResults(dataset: EvaluationDataset): CaseResult[] {
  return dataset.examples.map((example) => ({
    id: example.id,
    outcome: 'COMPLETED',
    observation: {
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
      inferenceCount: example.toolExpected ? 2 : 1,
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
