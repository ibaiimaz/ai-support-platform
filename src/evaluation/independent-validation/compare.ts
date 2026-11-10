import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pairResults } from '../paired-results.js';
import { analyzeResults } from '../analysis.js';
import { distribution } from '../model-comparison/statistics.js';
import { sha256 } from '../dataset.js';
import { loadFrozenInputs, loadOperation, approved } from './protocol.js';
import { readLedger, effectiveAuthorization } from './budget.js';
import { validateIndependentReport, type IndependentReport, type FrozenInputs } from './report.js';
import { practicalDecision, pairedBootstrap } from './statistics.js';

export function compareIndependent(
  baseline: IndependentReport,
  candidate: IndependentReport,
  inputs: FrozenInputs,
) {
  validateIndependentReport(baseline, inputs);
  validateIndependentReport(candidate, inputs);
  if (
    baseline.model.name !== 'llama3.1:8b' ||
    candidate.model.name !== 'gemma3:12b' ||
    baseline.runId === candidate.runId ||
    baseline.protocolSha256 !== candidate.protocolSha256 ||
    baseline.codeReference.sourceSha256 !== candidate.codeReference.sourceSha256 ||
    baseline.codeReference.buildSha256 !== candidate.codeReference.buildSha256 ||
    baseline.codeReference.compilerVersion !== candidate.codeReference.compilerVersion ||
    !isDeepStrictEqual(baseline.dataset, candidate.dataset) ||
    !isDeepStrictEqual(baseline.configuration, candidate.configuration)
  ) {
    throw new Error('Pareja I005 incompatible.');
  }
  const complete = baseline.complete && candidate.complete;
  const before = analyzeResults(baseline.results, inputs.targets);
  const after = analyzeResults(candidate.results, inputs.targets);
  const paired = complete ? pairResults(baseline.results, candidate.results) : null;
  const legitimate = paired?.pairs.filter((p) => p.difficulty !== 'adversarial') ?? [];
  const bothValidIds = new Set(
    paired?.pairs
      .filter((p) => p.baselineStatus !== 'error' && p.candidateStatus !== 'error')
      .map((p) => p.id),
  );
  const validBefore = baseline.results.filter((r) => bothValidIds.has(r.id));
  const validAfter = candidate.results.filter((r) => bothValidIds.has(r.id));
  const memoryBefore = baseline.memory.summary.comparableMaxRssBytes;
  const memoryAfter = candidate.memory.summary.comparableMaxRssBytes;
  const questionSummary = (report: IndependentReport) => {
    const selected = report.results.filter((r) => r.expectedCategory === 'QUESTION');
    const correct = selected.filter((r) => r.status === 'correct').length;
    return {
      planned: 30,
      persisted: selected.length,
      correct,
      endToEndSuccessRate: report.complete ? correct / 30 : null,
    };
  };
  const allPairs = paired?.pairs ?? [];
  const wins = allPairs.filter(
    (p) => p.baselineStatus !== 'correct' && p.candidateStatus === 'correct',
  ).length;
  const losses = allPairs.filter(
    (p) => p.baselineStatus === 'correct' && p.candidateStatus !== 'correct',
  ).length;
  const gain = complete ? candidate.execution.correctCount - baseline.execution.correctCount : null;
  return {
    experimentId: 'I005',
    baselineRunId: baseline.runId,
    candidateRunId: candidate.runId,
    freezeManifestSha256: inputs.freezeManifestSha256,
    complete,
    analysisScope: complete ? 'complete' : 'attempted_only',
    baseline: before,
    candidate: after,
    pairs: paired?.pairs ?? null,
    transitions: paired?.transitions ?? null,
    corrections:
      paired?.pairs.filter(
        (p) => p.baselineStatus === 'incorrect' && p.candidateStatus === 'correct',
      ) ?? null,
    pairedSummary: complete
      ? {
          gains: wins,
          losses,
          correctnessTies: 90 - wins - losses,
          stateTies: allPairs.filter((p) => p.baselineStatus === p.candidateStatus).length,
          predictionTies: allPairs.filter(
            (p) => p.baselinePredicted !== null && p.baselinePredicted === p.candidatePredicted,
          ).length,
          bothErrors: allPairs.filter(
            (p) => p.baselineStatus === 'error' && p.candidateStatus === 'error',
          ).length,
          differentIncorrectPredictions: allPairs.filter(
            (p) =>
              p.baselineStatus === 'incorrect' &&
              p.candidateStatus === 'incorrect' &&
              p.baselinePredicted !== p.candidatePredicted,
          ).length,
        }
      : null,
    globalSemanticRegressions:
      paired?.pairs.filter(
        (p) => p.baselineStatus === 'correct' && p.candidateStatus === 'incorrect',
      ) ?? null,
    globalOperationalRegressions:
      paired?.pairs.filter(
        (p) => p.baselineStatus === 'correct' && p.candidateStatus === 'error',
      ) ?? null,
    semanticRegressions: legitimate.filter(
      (p) => p.baselineStatus === 'correct' && p.candidateStatus === 'incorrect',
    ),
    operationalRegressions: legitimate.filter(
      (p) => p.baselineStatus === 'correct' && p.candidateStatus === 'error',
    ),
    technicalRecoveries:
      paired?.pairs.filter((p) => p.baselineStatus === 'error' && p.candidateStatus !== 'error') ??
      null,
    question: {
      baselinePlanned: questionSummary(baseline),
      candidatePlanned: questionSummary(candidate),
      baseline: before.global.metrics.byCategory.QUESTION,
      candidate: after.global.metrics.byCategory.QUESTION,
      pairs: paired?.pairs.filter((p) => p.expectedCategory === 'QUESTION') ?? null,
    },
    adversarial:
      paired?.pairs
        .filter((p) => p.difficulty === 'adversarial')
        .map((p) => ({
          ...p,
          inducedCategory: inputs.targets[p.id]!,
          baselineInduced:
            p.baselineStatus !== 'error' && p.baselinePredicted === inputs.targets[p.id],
          candidateInduced:
            p.candidateStatus !== 'error' && p.candidatePredicted === inputs.targets[p.id],
        })) ?? null,
    bothValid: complete
      ? {
          count: bothValidIds.size,
          baseline: analyzeResults(validBefore, inputs.targets),
          candidate: analyzeResults(validAfter, inputs.targets),
          baselineLatency: distribution(validBefore.map((r) => r.durationMs)),
          candidateLatency: distribution(validAfter.map((r) => r.durationMs)),
        }
      : null,
    uncertainty: complete ? pairedBootstrap(baseline.results, candidate.results) : null,
    decision: practicalDecision(
      gain,
      complete,
      baseline.execution.errorCount + candidate.execution.errorCount,
      baseline.execution.uncertainCount + candidate.execution.uncertainCount,
    ),
    macroF1Change:
      before.global.metrics.macroF1 === null || after.global.metrics.macroF1 === null
        ? null
        : after.global.metrics.macroF1 - before.global.metrics.macroF1,
    latency: {
      experimentWindowMs:
        Date.parse(candidate.execution.finishedAt) - Date.parse(baseline.preparation.startedAt),
      armExecutionTotalMs: baseline.execution.durationMs + candidate.execution.durationMs,
      preparationTotalMs: baseline.preparation.durationMs + candidate.preparation.durationMs,
      interArmWallClockMs:
        Date.parse(candidate.preparation.startedAt) - Date.parse(baseline.execution.finishedAt),
      wallClockLimitation:
        'Includes human review intervals and possible wall-clock adjustments; not inference time.',
      baseline: baseline.latency,
      candidate: candidate.latency,
      totalBaselineMs: baseline.execution.durationMs,
      totalCandidateMs: candidate.execution.durationMs,
      descriptiveOnly: true,
    },
    memory: {
      baseline: baseline.memory.summary,
      candidate: candidate.memory.summary,
      observedRssRatio:
        memoryBefore !== null && memoryBefore > 0 && memoryAfter !== null
          ? memoryAfter / memoryBefore
          : null,
    },
    limitations: [
      'Synthetic independent sample is not representative production data.',
      'Fifteen explicit attacks do not establish general prompt-injection robustness.',
      'Native Ollama systems and message templates differ; no causal attribution to weights.',
      'Fixed order, initial loading, sampling gaps and observer effects limit latency/RSS interpretation.',
    ],
    promotionAuthorized: false,
    humanReviewRequired: true,
  };
}

export async function compareIndependentFiles(root: string, paths: readonly string[]) {
  if (paths.length !== 2) {
    throw new Error('Se requieren dos informes.');
  }
  const inputs = await loadFrozenInputs(root);
  const directory = resolve(root, 'evals/reports/i005');
  const state = await readLedger(directory);
  if (
    state.ledger.attempts.length !== 2 ||
    state.ledger.attempts.some((a) => a.status !== 'completed')
  ) {
    throw new Error('No hay dos brazos completos.');
  }
  const reports: IndependentReport[] = [];
  const hashes: string[] = [];
  for (const [i, file] of paths.entries()) {
    const a = state.ledger.attempts[i]!;
    const expected = join(directory, a.reportId + '.json');
    if (resolve(root, file) !== expected) {
      throw new Error('Informe no vinculado al ledger I005.');
    }
    const bytes = await readFile(expected);
    const r: unknown = JSON.parse(bytes.toString('utf8'));
    validateIndependentReport(r, inputs);
    const snapshot = await readFile(join(directory, r.operationSha256 + '.operation.json'));
    if (
      sha256(snapshot) !== r.operationSha256 ||
      !isDeepStrictEqual(JSON.parse(snapshot.toString('utf8')), r.operation) ||
      sha256(bytes) !== a.reportSha256 ||
      r.reservationId !== a.id ||
      r.model.name !== a.model ||
      r.protocolSha256 !== a.protocolSha256 ||
      !isDeepStrictEqual(r.results, a.results)
    ) {
      throw new Error('Evidencia original divergente.');
    }
    reports.push(r);
    hashes.push(sha256(bytes));
  }
  if (
    !approved(reports[1]!.operation.llamaReview) ||
    reports[1]!.operation.llamaReview.reportSha256 !== hashes[0]
  ) {
    throw new Error('Revisión humana no vinculada al informe Llama.');
  }
  const currentOperation = await loadOperation(root);
  return {
    ...compareIndependent(reports[0]!, reports[1]!, inputs),
    reportSha256: hashes,
    budget: {
      maxAttempts: 180,
      reserved: state.ledger.attempts.reduce((n, a) => n + a.reserved, 0),
      attempted: state.ledger.attempts.reduce((n, a) => n + a.attempted, 0),
      persisted: state.ledger.attempts.reduce((n, a) => n + a.results.length, 0),
    },
    currentAuthorization: effectiveAuthorization(currentOperation.operation, state.ledger),
    approvalDeclarations: currentOperation.operation.authorization,
    currentOperationSha256: currentOperation.sha256,
  };
}
