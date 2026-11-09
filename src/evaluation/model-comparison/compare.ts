import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { validateModelReport, type ModelReport } from './report.js';
import { analyzeResults } from '../analysis.js';
import { pairResults } from '../paired-results.js';
import { distribution } from './statistics.js';
import { sha256 } from '../dataset.js';
import { loadInputs } from './protocol.js';
import { validateLedger } from './budget.js';

export function exploratorySignals(
  before: number,
  after: number,
  macroBefore: number | null,
  macroAfter: number | null,
) {
  const macroChange = macroBefore === null || macroAfter === null ? null : macroAfter - macroBefore;
  return {
    netCorrectGain: after - before,
    endToEndChange: (after - before) / 60,
    relevantExploratoryGain: after - before >= 5,
    macroF1Change: macroChange,
    complementaryMacroSignal: macroChange === null ? null : macroChange >= 0.03 - 1e-12,
    complementaryIsRequired: false,
    statisticalSignificanceClaimed: false,
    promotionAuthorized: false,
  };
}

export function compareModels(baseline: ModelReport, candidate: ModelReport) {
  validateModelReport(baseline);
  validateModelReport(candidate);
  if (
    !baseline.complete ||
    !candidate.complete ||
    baseline.experiment.phase !== 'benchmark' ||
    candidate.experiment.phase !== 'benchmark' ||
    baseline.model.name !== 'llama3.1:8b' ||
    candidate.model.name !== 'gemma3:12b' ||
    baseline.runId === candidate.runId ||
    baseline.experiment.protocolSha256 !== candidate.experiment.protocolSha256 ||
    !isDeepStrictEqual(baseline.dataset, candidate.dataset) ||
    !isDeepStrictEqual(baseline.configuration, candidate.configuration) ||
    baseline.environment.hostSha256 !== candidate.environment.hostSha256 ||
    baseline.environment.ollamaVersion !== candidate.environment.ollamaVersion
  ) {
    throw new Error('Brazos I004 incompletos o incompatibles.');
  }
  const { pairs, transitions } = pairResults(baseline.results, candidate.results);
  const targets = baseline.manifest.targets;
  const before = analyzeResults(baseline.results, targets);
  const after = analyzeResults(candidate.results, targets);
  const legitimate = pairs.filter((p) => p.difficulty !== 'adversarial');
  const bothValid = new Set(
    pairs
      .filter((p) => p.baselineStatus !== 'error' && p.candidateStatus !== 'error')
      .map((p) => p.id),
  );
  const memoryBefore = baseline.memory.summary.comparableMaxRssBytes;
  const memoryAfter = candidate.memory.summary.comparableMaxRssBytes;
  return {
    experimentId: 'I004',
    baselineRunId: baseline.runId,
    candidateRunId: candidate.runId,
    baselineModel: baseline.model,
    candidateModel: candidate.model,
    pairs,
    transitions,
    baseline: before,
    candidate: after,
    legitimate: {
      netLossOfCorrect: before.legitimate.correctCount - after.legitimate.correctCount,
      semanticRegressions: legitimate.filter(
        (p) => p.baselineStatus === 'correct' && p.candidateStatus === 'incorrect',
      ),
      operationalRegressions: legitimate.filter(
        (p) => p.baselineStatus === 'correct' && p.candidateStatus === 'error',
      ),
      corrections: legitimate.filter(
        (p) => p.baselineStatus === 'incorrect' && p.candidateStatus === 'correct',
      ),
      technicalRecoveries: legitimate.filter(
        (p) => p.baselineStatus === 'error' && p.candidateStatus !== 'error',
      ),
    },
    question: {
      baseline: before.global.metrics.byCategory.QUESTION,
      candidate: after.global.metrics.byCategory.QUESTION,
      pairs: pairs.filter((p) => p.expectedCategory === 'QUESTION'),
    },
    adversarial: {
      pairs: pairs.filter((p) => p.difficulty === 'adversarial'),
      corrected: pairs.filter(
        (p) =>
          p.difficulty === 'adversarial' &&
          p.baselineStatus === 'incorrect' &&
          p.candidateStatus === 'correct',
      ),
      worsened: pairs.filter(
        (p) =>
          p.difficulty === 'adversarial' &&
          p.baselineStatus === 'correct' &&
          p.candidateStatus !== 'correct',
      ),
    },
    bothValid: {
      count: bothValid.size,
      baseline: analyzeResults(
        baseline.results.filter((r) => bothValid.has(r.id)),
        targets,
      ),
      candidate: analyzeResults(
        candidate.results.filter((r) => bothValid.has(r.id)),
        targets,
      ),
      baselineLatency: distribution(
        baseline.results.filter((r) => bothValid.has(r.id)).map((r) => r.durationMs),
      ),
      candidateLatency: distribution(
        candidate.results.filter((r) => bothValid.has(r.id)).map((r) => r.durationMs),
      ),
    },
    latency: {
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
      comparativeAvailability:
        memoryBefore !== null && memoryBefore > 0 && memoryAfter !== null
          ? 'available_with_sampling_limitations'
          : 'not_demonstrated',
    },
    signals: exploratorySignals(
      before.global.correctCount,
      after.global.correctCount,
      before.global.metrics.macroF1,
      after.global.metrics.macroF1,
    ),
    humanReviewRequired: true,
    promotionAuthorized: false,
    limitation:
      'Exploratory comparison of native Ollama systems, not independent validation or isolated model weights.',
  };
}

export async function compareModelFiles(root: string, paths: readonly string[]) {
  if (paths.length !== 2) {
    throw new Error('Indique dos informes benchmark I004.');
  }
  const reports: ModelReport[] = [];
  const hashes: string[] = [];
  for (const path of paths) {
    const absolute = resolve(root, path);
    const bytes = await readFile(absolute);
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    validateModelReport(value);
    const manifestBytes = await readFile(
      join(dirname(absolute), `${value.experiment.manifestSha256}.manifest.json`),
    );
    if (
      sha256(manifestBytes) !== value.experiment.manifestSha256 ||
      !isDeepStrictEqual(JSON.parse(manifestBytes.toString('utf8')), value.manifest)
    ) {
      throw new Error('Instantánea de manifiesto divergente.');
    }
    const inputs = await loadInputs(root, value.manifest);
    const references = new Map(inputs.benchmark.dataset.examples.map((e) => [e.id, e]));
    for (const result of value.results) {
      const example = references.get(result.id);
      if (
        !example ||
        example.expectedCategory !== result.expectedCategory ||
        example.difficulty !== result.difficulty ||
        !isDeepStrictEqual(example.tags, result.tags)
      ) {
        throw new Error('Referencia de resultados divergente.');
      }
    }
    reports.push(value);
    hashes.push(sha256(bytes));
  }
  const directory = resolve(root, 'evals/reports/i004');
  const ledger: unknown = JSON.parse(await readFile(join(directory, 'budget.json'), 'utf8'));
  validateLedger(ledger);
  if (
    ledger.attempts.length !== 4 ||
    ledger.attempts.some((a) => a.status !== 'completed' || !a.allowsNext) ||
    ledger.attempts[2]!.reportId !== reports[0]!.runId ||
    ledger.attempts[3]!.reportId !== reports[1]!.runId
  ) {
    throw new Error('No existen los cuatro brazos completos del experimento.');
  }
  const timeline = [];
  for (const attempt of ledger.attempts) {
    const bytes = await readFile(join(directory, `${attempt.reportId}.json`));
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    validateModelReport(value);
    if (
      sha256(bytes) !== attempt.reportSha256 ||
      !value.complete ||
      value.experiment.protocolSha256 !== reports[0]!.experiment.protocolSha256 ||
      value.experiment.reservationId !== attempt.id ||
      value.experiment.phase !== attempt.phase ||
      value.model.name !== attempt.model ||
      !isDeepStrictEqual(value.results, attempt.results)
    ) {
      throw new Error('Evidencia del experimento inconsistente.');
    }
    timeline.push({
      runId: value.runId,
      phase: attempt.phase,
      model: attempt.model,
      preparation: value.preparation,
      execution: value.execution,
    });
  }
  const startedAt = timeline[0]!.preparation.startedAt;
  const finishedAt = timeline.at(-1)!.execution.finishedAt;
  return {
    ...compareModels(reports[0]!, reports[1]!),
    reportSha256: hashes,
    experimentTiming: {
      startedAt,
      finishedAt,
      wallDurationMs: Date.parse(finishedAt) - Date.parse(startedAt),
      arms: timeline,
      measuredPreparationMs: timeline.reduce((sum, arm) => sum + arm.preparation.durationMs, 0),
      measuredExecutionMs: timeline.reduce((sum, arm) => sum + arm.execution.durationMs, 0),
      includesIntervalsBetweenManualCommands: true,
      externalInstallationOrPreparationMs: null,
      reason: 'External preparation before the first command is not observed by the runner.',
    },
  };
}
