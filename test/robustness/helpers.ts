import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { fixtureDataset, temporaryProject } from '../evaluation/helpers.js';
import { sha256, loadDataset } from '../../src/evaluation/dataset.js';
import { loadManifest, type ExperimentManifest } from '../../src/evaluation/experiment-manifest.js';
import { buildExperimentReport } from '../../src/evaluation/report.js';
import { baselinePrompt, findPrompt } from '../../src/evaluation/prompts.js';
import { loadConfig } from '../../src/config.js';
import type { EvaluationResult, EvaluationRun } from '../../src/evaluation/types.js';

interface AuthorizationFixture {
  developmentAuthorized?: boolean;
  validationAuthorized?: boolean;
  validationApproved?: boolean;
}

export async function experimentProject(t: TestContext, options: AuthorizationFixture = {}) {
  const root = await temporaryProject(t);
  const manifest = JSON.parse(
    await readFile('evals/experiments/i003-manifest.json', 'utf8'),
  ) as ExperimentManifest;
  const dataset = fixtureDataset();
  const targets = Object.fromEntries(
    dataset.examples
      .filter((example) => example.difficulty === 'adversarial')
      .map((example) => [
        example.id,
        example.expectedCategory === 'BUG' ? ('FEATURE' as const) : ('BUG' as const),
      ]),
  );
  const bytes = await readFile(join(root, 'evals/datasets/incidents-v1.json'));
  manifest.datasets.development = {
    ...manifest.datasets.development,
    id: dataset.id,
    version: dataset.version,
    sha256: sha256(bytes),
    targets,
  };
  const validation = structuredClone(dataset);
  validation.id = 'validation-fixture-es';

  for (const example of validation.examples) {
    example.id = `VAL-${example.id}`;
    example.description = `Validación independiente: ${example.description}`;
  }

  const validationBytes = JSON.stringify(validation);
  const validationApproved = options.validationApproved ?? false;
  manifest.datasets.validation = {
    ...manifest.datasets.validation,
    id: validation.id,
    version: validation.version,
    sha256: sha256(validationBytes),
    reviewStatus: validationApproved ? 'approved' : 'pending',
    frozen: validationApproved,
    approvedBy: validationApproved ? 'Fixture reviewer' : null,
    targets: Object.fromEntries(
      Object.entries(targets).map(([id, target]) => [`VAL-${id}`, target]),
    ),
  };
  await writeFile(join(root, manifest.datasets.validation.path), validationBytes);
  manifest.datasets.development.reviewStatus = 'approved';
  manifest.datasets.development.frozen = true;
  manifest.datasets.development.approvedBy = 'Fixture reviewer';
  manifest.authorization.development = options.developmentAuthorized ?? true;
  manifest.authorization.validation = options.validationAuthorized ?? false;
  manifest.preparation.validationApproved = validationApproved;
  manifest.selection = { promptId: null, approvedBy: null };
  await mkdir(join(root, 'evals/experiments'), { recursive: true });
  await writeFile(join(root, 'evals/experiments/i003-manifest.json'), JSON.stringify(manifest));

  return { root, manifest, dataset, targets };
}

export async function fixturePair(t: TestContext, candidateId = 'h1', adversarialCorrect = 3) {
  const context = await experimentProject(t);
  const source = await loadManifest(context.root);
  const loaded = await loadDataset(
    join(context.root, 'evals/datasets/incidents-v1.json'),
    'evals/datasets/incidents-v1.json',
  );
  const results = loaded.dataset.examples.map((example): EvaluationResult => ({
    id: example.id,
    expectedCategory: example.expectedCategory,
    difficulty: example.difficulty,
    tags: example.tags,
    durationMs: 1,
    ...(example.difficulty === 'adversarial'
      ? { status: 'incorrect' as const, predictedCategory: context.targets[example.id]! }
      : { status: 'correct' as const, predictedCategory: example.expectedCategory }),
  }));
  const run: EvaluationRun = {
    complete: true,
    termination: null,
    startedAt: '2026-11-05T10:00:00.000Z',
    finishedAt: '2026-11-05T10:00:01.000Z',
    durationMs: 1000,
    results,
  };
  const config = loadConfig({});
  const reportContext = {
    phase: 'development' as const,
    manifestSha256: source.sha256,
    protocolSha256: source.protocolSha256,
    reservationId: 'fixture-reservation',
  };
  const baseline = buildExperimentReport(loaded, config, run, null, baselinePrompt, reportContext);
  const candidateRun = structuredClone(run);
  let corrected = 0;

  for (const result of candidateRun.results) {
    if (
      result.difficulty === 'adversarial' &&
      corrected++ < adversarialCorrect &&
      result.status !== 'error'
    ) {
      result.status = 'correct';
      result.predictedCategory = result.expectedCategory;
    }
  }

  const candidate = buildExperimentReport(
    loaded,
    config,
    candidateRun,
    null,
    findPrompt(candidateId),
    reportContext,
  );

  return { ...context, baseline, candidate, loaded, config, run, candidateRun, reportContext };
}
