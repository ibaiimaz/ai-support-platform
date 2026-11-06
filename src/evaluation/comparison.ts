import { isDeepStrictEqual } from 'node:util';
import { validateAnyReport, type ExperimentReport } from './report.js';
import { analyzeResults, type AttackTargets } from './analysis.js';
import { baselinePrompt, findPrompt } from './prompts.js';

export function compareReports(
  baseline: ExperimentReport,
  candidate: ExperimentReport,
  targets: AttackTargets,
) {
  validateAnyReport(baseline);
  validateAnyReport(candidate);

  if (
    baseline.schemaVersion !== 2 ||
    candidate.schemaVersion !== 2 ||
    !baseline.complete ||
    !candidate.complete ||
    baseline.prompt.role !== 'baseline' ||
    candidate.prompt.role !== 'candidate' ||
    baseline.runId === candidate.runId ||
    baseline.experiment.phase !== candidate.experiment.phase ||
    baseline.experiment.protocolSha256 !== candidate.experiment.protocolSha256 ||
    !isDeepStrictEqual(baseline.dataset, candidate.dataset) ||
    !isDeepStrictEqual(baseline.model, candidate.model) ||
    !isDeepStrictEqual(baseline.configuration, candidate.configuration)
  ) {
    throw new Error('Ejecuciones incompletas o incompatibles para comparación.');
  }

  const registered = findPrompt(candidate.prompt.id);

  if (
    baseline.prompt.id !== baselinePrompt.id ||
    baseline.prompt.sha256 !== baselinePrompt.sha256 ||
    baseline.prompt.version !== baselinePrompt.version ||
    baseline.prompt.module !== baselinePrompt.module ||
    candidate.prompt.sha256 !== registered.sha256 ||
    candidate.prompt.version !== registered.version ||
    registered.role !== 'candidate' ||
    candidate.prompt.module !== registered.module
  ) {
    throw new Error('Identidad de prompt divergente del registro.');
  }

  const baselineById = new Map(baseline.results.map((result) => [result.id, result]));
  const transitions = {
    correct: { correct: 0, incorrect: 0, error: 0 },
    incorrect: { correct: 0, incorrect: 0, error: 0 },
    error: { correct: 0, incorrect: 0, error: 0 },
  };
  const pairs = candidate.results.map((result) => {
    const control = baselineById.get(result.id);

    if (
      !control ||
      control.expectedCategory !== result.expectedCategory ||
      control.difficulty !== result.difficulty ||
      !isDeepStrictEqual(control.tags, result.tags)
    ) {
      throw new Error('Referencias de ejemplos no compatibles.');
    }

    transitions[control.status][result.status]++;

    return {
      id: result.id,
      expectedCategory: result.expectedCategory,
      difficulty: result.difficulty,
      baselineStatus: control.status,
      candidateStatus: result.status,
      baselinePredicted: control.status === 'error' ? null : control.predictedCategory,
      candidatePredicted: result.status === 'error' ? null : result.predictedCategory,
    };
  });
  const legitimatePairs = pairs.filter((pair) => pair.difficulty !== 'adversarial');
  const semanticRegressions = legitimatePairs.filter(
    (pair) => pair.baselineStatus === 'correct' && pair.candidateStatus === 'incorrect',
  );
  const operationalRegressions = legitimatePairs.filter(
    (pair) => pair.baselineStatus === 'correct' && pair.candidateStatus === 'error',
  );
  const corrections = legitimatePairs.filter(
    (pair) => pair.baselineStatus === 'incorrect' && pair.candidateStatus === 'correct',
  );
  const technicalRecoveries = legitimatePairs.filter(
    (pair) => pair.baselineStatus === 'error' && pair.candidateStatus !== 'error',
  );
  const baselineAnalysis = analyzeResults(baseline.results, targets);
  const candidateAnalysis = analyzeResults(candidate.results, targets);
  const bothValidIds = new Set(
    pairs
      .filter((pair) => pair.baselineStatus !== 'error' && pair.candidateStatus !== 'error')
      .map((pair) => pair.id),
  );

  return {
    baselineRunId: baseline.runId,
    candidateRunId: candidate.runId,
    candidateId: candidate.prompt.id,
    candidateHash: candidate.prompt.sha256,
    phase: candidate.experiment.phase,
    pairs,
    transitions,
    latency: {
      baseline: {
        totalMs: baseline.execution.durationMs,
        meanMs:
          baseline.results.reduce((sum, result) => sum + result.durationMs, 0) /
          baseline.results.length,
      },
      candidate: {
        totalMs: candidate.execution.durationMs,
        meanMs:
          candidate.results.reduce((sum, result) => sum + result.durationMs, 0) /
          candidate.results.length,
      },
      descriptiveOnly: true,
    },
    baseline: baselineAnalysis,
    candidate: candidateAnalysis,
    legitimate: {
      netLossOfCorrect:
        baselineAnalysis.legitimate.correctCount - candidateAnalysis.legitimate.correctCount,
      semanticRegressions,
      operationalRegressions,
      corrections,
      technicalRecoveries,
    },
    bothValid: {
      count: bothValidIds.size,
      baseline: analyzeResults(
        baseline.results.filter((result) => bothValidIds.has(result.id)),
        targets,
      ),
      candidate: analyzeResults(
        candidate.results.filter((result) => bothValidIds.has(result.id)),
        targets,
      ),
    },
  };
}

export type PairedComparison = ReturnType<typeof compareReports>;
