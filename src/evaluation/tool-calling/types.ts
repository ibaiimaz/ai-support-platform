import type { CodeIdentity } from '../independent-validation/code-state.js';
import type { classificationProtocolId, EvaluationCohort } from './protocol.js';
import type { InvalidResponseDiagnostic } from '../../application/classification-errors.js';
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
  id: 'incidents-tool-calling-es-v1' | 'incidents-tool-calling-holdout-es-v1';
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
  decisionSource: 'CODE' | 'LLM';
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

export type InferencePhase = 'decision' | 'classification';

export interface PhaseAccounting {
  reserved: 0 | 1;
  dispatched: 0 | 1;
  reservationUncertain: boolean;
}

export type AttemptAccounting = Record<InferencePhase, PhaseAccounting>;

export interface PhaseObservation {
  started: boolean;
  attempts: 0 | 1;
  dispatched: 0 | 1;
  reservationUncertain: boolean;
  status: 'NOT_STARTED' | 'COMPLETED' | 'POLICY_REJECTED' | 'TECHNICAL_ERROR';
}

export interface CaseResult {
  phases: Record<InferencePhase, PhaseObservation>;
  failurePhase: InferencePhase | 'tool' | 'control' | null;
  id: string;
  outcome: 'COMPLETED' | 'POLICY_VIOLATION' | 'TECHNICAL_ERROR';
  observation: Observation;
  final: ClassificationResult | null;
  error: string | null;
  diagnostic?: InvalidResponseDiagnostic;
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
  cohort: EvaluationCohort;
  systemFreezeHash: string;
  maximumInferences: number;
  datasetHash: string;
  model: string;
  modelDigest: string;
  ollamaVersion: string;
  modelMetadataHash: string;
  protocolId: typeof classificationProtocolId;
  decisionPromptHash: string;
  classificationPromptHash: string;
  codeIdentity: CodeIdentity;
  protocolHash: string;
  codeReference: string | null;
  sourceStateHash: string;
  baseUrl: string;
  temperature: 0;
  think: false;
  llmTimeoutMs: 45000;
  toolTimeoutMs: 5000;
  globalTimeoutMs: 90000;
}

export interface EvaluationReport {
  schemaVersion: 2;
  protocolId: typeof classificationProtocolId;
  runId: string;
  startedAt: string;
  finishedAt: string;
  identity: RunIdentity;
  dataset: {
    id: string;
    schemaVersion: number;
    version: number;
    cases: number;
    pairs: number;
    cohort: EvaluationCohort;
  };
  assessment: {
    scope: 'COHORT_THRESHOLDS_ONLY' | 'SYNTHETIC_HOLDOUT_ONLY';
    requiredCohorts: EvaluationCohort[];
    independentValidation: 'NOT_EVALUATED' | 'INCOMPLETE' | 'FAILED' | 'PASSED';
    iterationAcceptance: 'NOT_GRANTED';
  };
  results: CaseResult[];
  metrics: EvaluationMetrics;
  diagnostics: EvaluationDiagnostics;
  segments: Record<
    'CODE' | 'LLM',
    {
      interpretation: 'DESCRIPTIVE_ONLY';
      bindingThresholds: false;
      cases: number;
      evaluable: number;
      toolDecisionsCorrect: number;
      finalCorrect: number;
      metrics: EvaluationMetrics;
    }
  >;
  status: 'INCOMPLETE' | 'COMPLETE_FAILED' | 'COMPLETE_PASSED';
  deterministicGate: 'NOT_EVALUATED';
  thresholdGate: 'INCOMPLETE' | 'FAILED' | 'PASSED';
  experimentalGate: 'NOT_EVALUATED' | 'INCOMPLETE' | 'FAILED' | 'PASSED';
  totalLatencyMs: number;
}
