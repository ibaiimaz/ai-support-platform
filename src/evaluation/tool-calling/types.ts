import type { Category } from '../../domain/classification.js';
import type { Incident } from '../../domain/incident.js';
import type { ClassificationResult } from '../../application/classification-result.js';

export const groups = [
  'direct_without_reference',
  'direct_with_reference',
  'lookup_required',
  'lookup_unavailable',
  'adversarial_or_ambiguous',
] as const;

export type ExpectedFinal =
  { status: 'CLASSIFIED'; category: Category } | { status: 'INSUFFICIENT_CONTEXT'; category: null };

export interface EvaluationCase {
  id: string;
  group: (typeof groups)[number];
  description: string;
  toolExpected: boolean;
  expectedTool: { name: 'getIncidentById'; incidentId: string } | null;
  expectedFinal: ExpectedFinal;
  fixture: { incidents: Incident[]; unavailableIds: string[] };
  scenario: string;
  tags: string[];
  rationale: string;
  counterfactualPairId: string | null;
  adversarial: {
    vector: string;
    expectedBehavior: string;
    forbiddenIncidentIds: string[];
    failureConditions: string[];
  } | null;
}

export interface EvaluationDataset {
  schemaVersion: 1;
  id: 'incidents-tool-calling-es-v1';
  version: number;
  reviewStatus: 'CANDIDATE';
  examples: EvaluationCase[];
  counterfactualPairs: {
    id: string;
    caseIds: [string, string];
    changedCondition: string;
    expectedBehavior: string;
    rationale: string;
  }[];
}

export interface Observation {
  toolRequested: boolean | null;
  toolRequestValid: boolean | null;
  toolExecuted: boolean;
  toolOutcome: 'FOUND' | 'NOT_FOUND' | 'UNAVAILABLE' | null;
  toolDecisionCorrect: boolean | null;
  requestCount: number;
  executionCount: number;
  inferenceCount: number;
  requestedIds: string[];
  violations: string[];
}

export interface CaseResult {
  id: string;
  outcome: 'COMPLETED' | 'POLICY_VIOLATION' | 'TECHNICAL_ERROR';
  observation: Observation;
  final: ClassificationResult | null;
  error: string | null;
  latencyMs: number;
}

export interface Metric {
  numerator: number;
  denominator: number;
  percentage: number | null;
  threshold: number;
  passed: boolean;
}

export interface DiagnosticMetric {
  numerator: number;
  denominator: number;
  percentage: number | null;
}

export interface EvaluationDiagnostics {
  abstentionRecall: DiagnosticMetric;
  abstentionPrecision: DiagnosticMetric;
}

export interface EvaluationMetrics {
  precision: Metric;
  recall: Metric;
  classification: Metric;
  abstention: Metric;
  counterfactual: Metric;
  evaluable: number;
  technicalErrors: number;
  notAttempted: number;
  plannedPairs: number;
  excludedPairs: number;
}

export interface RunIdentity {
  datasetHash: string;
  model: string;
  modelDigest: string;
  ollamaVersion: string;
  modelMetadataHash: string;
  promptHash: string;
  protocolHash: string;
  codeReference: string | null;
  sourceStateHash: string;
  baseUrl: string;
  temperature: 0;
  llmTimeoutMs: 45000;
  toolTimeoutMs: 5000;
  globalTimeoutMs: 90000;
}

export interface EvaluationReport {
  schemaVersion: 1;
  runId: string;
  startedAt: string;
  finishedAt: string;
  identity: RunIdentity;
  dataset: { id: string; schemaVersion: number; version: number; cases: number; pairs: number };
  results: CaseResult[];
  metrics: EvaluationMetrics;
  diagnostics: EvaluationDiagnostics;
  status: 'INCOMPLETE' | 'COMPLETE_FAILED' | 'COMPLETE_PASSED';
  deterministicGate: 'NOT_EVALUATED';
  experimentalGate: 'INCOMPLETE' | 'FAILED' | 'PASSED';
  totalLatencyMs: number;
}
