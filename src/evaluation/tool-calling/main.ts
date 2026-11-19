import { readFile, readdir, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractIncidentReferences } from '../../application/incident-references.js';
import { createClassificationDependencies } from '../../composition.js';
import { loadConfig, type Config } from '../../config.js';
import { lookupDecisionInstructions } from '../../infrastructure/ollama/lookup-decision-instructions.js';
import { classificationFinalInstructions } from '../../infrastructure/ollama/classification-final-instructions.js';
import { createGuardedTransport } from '../../diagnostics/i006-smoke.js';
import {
  captureCodeIdentity,
  snapshotBuild,
  type CodeVerification,
} from '../independent-validation/code-state.js';
import {
  classificationProtocolId,
  classificationCohort,
  candidateModel,
  plannedPhases,
  cohortSettings,
  type EvaluationCohort,
} from './protocol.js';
import {
  restrictedIncidentLookupTool,
  toolCallingFinalSchema,
} from '../../infrastructure/ollama/tool-calling-protocol.js';
import { sha256 } from '../dataset.js';
import { findCodeReference } from '../code-reference.js';
import { readAuthorization, withControl, type DurableRunControl } from './control.js';
import { loadDataset } from './dataset.js';
import { buildReport, saveReport } from './report.js';
import { runEvaluation } from './run.js';
import type { CaseResult, RunIdentity, EvaluationDataset } from './types.js';

function candidateConfiguration() {
  return { ...loadConfig(), model: candidateModel.model, think: candidateModel.think };
}

async function treeIdentity(root: string): Promise<string> {
  const entries: [string, string][] = [];

  async function visit(relative: string): Promise<void> {
    for (const entry of (await readdir(join(root, relative), { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const name = join(relative, entry.name);
      if (entry.isDirectory()) {
        await visit(name);
      } else if (entry.isFile()) {
        entries.push([name, sha256(await readFile(join(root, name)))]);
      } else {
        throw new Error('Unsupported code identity entry');
      }
    }
  }

  await visit('src');
  await visit('dist/src');
  for (const name of ['package.json', 'package-lock.json', 'tsconfig.json']) {
    entries.push([name, sha256(await readFile(join(root, name)))]);
  }
  return sha256(JSON.stringify(entries));
}

async function metadata(baseUrl: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(new URL(path, baseUrl), {
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error('Ollama metadata unavailable');
  }
  return response.json();
}

function modelMetadataHash(show: unknown): string {
  if (typeof show !== 'object' || show === null || Array.isArray(show)) {
    throw new Error('Invalid model metadata');
  }
  const descriptor = { ...show } as Record<string, unknown>;
  // The local blob path is private and machine-specific, not a model parameter.
  if (typeof descriptor.modelfile === 'string') {
    descriptor.modelfile = descriptor.modelfile.replace(
      /^FROM\s+.+$/gm,
      `FROM sha256:${candidateModel.digest}`,
    );
  }
  return sha256(JSON.stringify(descriptor));
}

export async function effectiveIdentity(
  root: string,
  datasetHash: string,
  code = captureCodeIdentity(root, snapshotBuild(join(root, 'dist'))),
  cohort: EvaluationCohort = classificationCohort,
  offline = false,
): Promise<RunIdentity> {
  code.verify();
  const freezeBytes = await readFile(join(root, 'evals/experiments/i006-r7-system-freeze.json'));
  const freeze = JSON.parse(freezeBytes.toString('utf8')) as { files: Record<string, string> };
  for (const [path, expected] of Object.entries(freeze.files)) {
    if (sha256(await readFile(join(root, path))) !== expected) {
      throw new Error('Frozen R7 behavior changed');
    }
  }
  const settings = cohortSettings(cohort);
  const frozen = await loadDataset(join(root, 'evals/datasets', settings.datasetFile));
  if (
    frozen.hash !== datasetHash ||
    frozen.dataset.id !== settings.datasetId ||
    frozen.dataset.examples.reduce(
      (sum, example) => sum + plannedPhases(example.description).length,
      0,
    ) !== settings.maximumInferences
  ) {
    throw new Error('Dataset identity changed');
  }
  const config = candidateConfiguration();
  // Offline preparation uses public metadata retained before holdout authoring.
  // Operational initialization/execution still verifies the live provider.
  const retained = offline
    ? (JSON.parse(
        await readFile(join(root, 'evals/experiments/i006-r7-model-metadata.json'), 'utf8'),
      ) as { tags: unknown; version: unknown; show: unknown })
    : undefined;
  const tags = (retained ? retained.tags : await metadata(config.baseUrl, '/api/tags')) as {
    models?: { name: string; digest: string }[];
  };
  const model = tags.models?.find((item) => item.name === config.model);
  const version = (
    retained ? retained.version : await metadata(config.baseUrl, '/api/version')
  ) as { version?: string };
  const show = retained
    ? retained.show
    : await metadata(config.baseUrl, '/api/show', { model: config.model });
  if (
    !model ||
    model.digest !== candidateModel.digest ||
    version.version !== '0.40.14' ||
    (show as { details?: { quantization_level?: string } }).details?.quantization_level !==
      candidateModel.quantization
  ) {
    throw new Error('Cannot establish model identity');
  }
  return {
    cohort,
    systemFreezeHash: sha256(freezeBytes),
    maximumInferences: settings.maximumInferences,
    datasetHash,
    model: config.model,
    modelDigest: model.digest,
    ollamaVersion: version.version,
    modelMetadataHash: modelMetadataHash(show),
    protocolId: classificationProtocolId,
    decisionPromptHash: sha256(lookupDecisionInstructions),
    classificationPromptHash: sha256(classificationFinalInstructions),
    codeIdentity: code.identity,
    protocolHash: sha256(
      JSON.stringify({
        schema: toolCallingFinalSchema,
        toolsByCase: frozen.dataset.examples.map((example) => {
          const ids = extractIncidentReferences(example.description);
          return {
            id: example.id,
            tool: ids.length === 0 ? null : restrictedIncidentLookupTool(ids),
          };
        }),
      }),
    ),
    codeReference: findCodeReference(root),
    sourceStateHash: await treeIdentity(root),
    baseUrl: config.baseUrl,
    temperature: 0,
    think: false,
    llmTimeoutMs: 45000,
    toolTimeoutMs: 5000,
    globalTimeoutMs: 90000,
  };
}

export async function runControlledEvaluation(
  dataset: EvaluationDataset,
  control: DurableRunControl,
  options: {
    config: Pick<Config, 'baseUrl' | 'model'> & { think?: boolean };
    request: typeof fetch;
    verifyCase: () => Promise<void>;
    verifyDispatch: () => void;
    checkpoint: (results: CaseResult[]) => Promise<void>;
  },
): Promise<CaseResult[]> {
  let guard: ReturnType<typeof createGuardedTransport> | undefined;
  let controlFailure = false;
  let latest: CaseResult[] = [];
  const dependencies = createClassificationDependencies(options.config, async (input, init) => {
    if (!guard) {
      throw new Error('No reserved evaluation case');
    }
    return guard.request(input, init);
  });
  const finish = async () => {
    guard?.close();
    await guard?.settle();
    guard = undefined;
  };
  try {
    return await runEvaluation(dataset, dependencies, {
      accounting: (example) => control.accounting(example),
      controlFailed: () => controlFailure,
      finish,
      async reserve(example) {
        await options.verifyCase();
        await control.reserve(example);
        guard = createGuardedTransport({
          baseUrl: options.config.baseUrl,
          async request(input, init) {
            try {
              control.dispatch(example);
            } catch {
              controlFailure = true;
              throw new Error('I006 dispatch control failed');
            }
            return options.request(input, init);
          },
          async reserve(attempt) {
            try {
              await control.attempt(example, plannedPhases(example.description)[attempt - 1]!);
            } catch {
              controlFailure = true;
              throw new Error('I006 reservation control failed');
            }
          },
          beforeDispatch() {
            try {
              options.verifyDispatch();
              control.verifyDispatch(example);
            } catch {
              controlFailure = true;
              throw new Error('I006 pre-dispatch control failed');
            }
          },
        });
      },
      async record(result) {
        try {
          await control.record(result);
        } catch {
          const failure: CaseResult = {
            ...result,
            outcome: 'TECHNICAL_ERROR',
            failurePhase: 'control',
            error: 'control_error',
            final: null,
            observation: { ...result.observation, toolDecisionCorrect: null },
          };
          delete failure.diagnostic;
          // Preserve the prefix even if control storage failed; never retry the case.
          await options.checkpoint([...latest, failure]);
          throw new Error('I006 control persistence failed');
        }
        latest = [...latest, result];
        await options.checkpoint(latest);
      },
    });
  } finally {
    await finish();
  }
}

export async function main(root = process.cwd(), args = process.argv.slice(2)): Promise<number> {
  const action = args[0];
  const cohort = args.length === 1 ? classificationCohort : args[2];
  if (
    (args.length !== 1 && (args.length !== 3 || args[1] !== '--cohort')) ||
    (cohort !== 'KNOWN_REGRESSION' && cohort !== 'INDEPENDENT_HOLDOUT') ||
    !['--validate', '--identity', '--initialize', '--execute'].includes(action ?? '')
  ) {
    throw new Error('Use one explicit I006 action and optional --cohort');
  }
  const selectedCohort = cohort;
  const settings = cohortSettings(selectedCohort);
  const datasetPath = join(root, 'evals/datasets', settings.datasetFile);
  const { dataset, hash } = await loadDataset(datasetPath);
  const authorizationPath = join(root, 'evals/experiments', settings.authorizationFile);
  if (dataset.id !== settings.datasetId) {
    throw new Error('Cohort dataset mismatch');
  }
  if (action === '--validate') {
    const authorization = await readAuthorization(authorizationPath);
    if (
      authorization.datasetHash !== hash ||
      authorization.cohort !== selectedCohort ||
      authorization.maximumInferences !== settings.maximumInferences ||
      !['APPROVED_FROZEN', 'FROZEN_PENDING_HUMAN_REVIEW'].includes(authorization.datasetReview)
    ) {
      throw new Error('Frozen dataset identity mismatch');
    }
    console.log(
      JSON.stringify({
        dataset: dataset.id,
        version: dataset.version,
        cases: dataset.examples.length,
        review: authorization.datasetReview,
        datasetHash: hash,
        cohort: selectedCohort,
        maximumInferences: dataset.examples.reduce(
          (sum, example) => sum + plannedPhases(example.description).length,
          0,
        ),
      }),
    );
    return 0;
  }
  const authorization = await readAuthorization(authorizationPath);
  if (
    action !== '--identity' &&
    (!authorization[action === '--initialize' ? 'initialize' : 'execute'] ||
      authorization.cohort !== selectedCohort ||
      authorization.datasetHash !== hash ||
      authorization.datasetReview !== 'APPROVED_FROZEN' ||
      authorization.identityHash === null ||
      authorization.approvalReference === null ||
      authorization.maximumInferences !== settings.maximumInferences)
  ) {
    throw new Error('I006 action is disabled');
  }
  const code = captureCodeIdentity(root, snapshotBuild(join(root, 'dist')));
  const identity = await effectiveIdentity(
    root,
    hash,
    code,
    selectedCohort,
    action === '--identity',
  );
  if (action === '--identity') {
    console.log(
      JSON.stringify(
        {
          identity,
          identityHash: sha256(JSON.stringify(identity)),
          metadataVerification: 'OFFLINE_RETAINED_METADATA',
          liveProviderVerified: false,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  const reports = join(root, 'evals/reports', settings.reportsDirectory);
  const controls = join(reports, 'controls');
  let exitCode = 1;
  await withControl(
    controls,
    dataset,
    identity,
    authorizationPath,
    action === '--initialize',
    async (control) => {
      const config = candidateConfiguration();
      const startedAt = new Date().toISOString();
      await mkdir(reports, { recursive: true, mode: 0o700 });
      const runId = control.runId!;
      const results = await runControlledEvaluation(dataset, control, {
        config,
        request: fetch,
        async verifyCase() {
          if (
            (await loadDataset(datasetPath)).hash !== hash ||
            JSON.stringify(await effectiveIdentity(root, hash, code, selectedCohort)) !==
              JSON.stringify(identity) ||
            JSON.stringify(candidateConfiguration()) !== JSON.stringify(config)
          ) {
            throw new Error('I006 inputs changed during execution');
          }
        },
        verifyDispatch() {
          code.verify();
          if (JSON.stringify(candidateConfiguration()) !== JSON.stringify(config)) {
            throw new Error('Configuration changed');
          }
        },
        async checkpoint(results) {
          await saveReport(reports, buildReport(dataset, identity, results, startedAt, runId));
        },
      });
      const report = buildReport(dataset, identity, results, startedAt, runId);
      exitCode =
        report.status === 'COMPLETE_PASSED' ? 0 : report.status === 'COMPLETE_FAILED' ? 2 : 1;
      console.log(
        JSON.stringify({
          runId,
          status: report.status,
          cohort: report.dataset.cohort,
          assessment: report.assessment,
          thresholdGate: report.thresholdGate,
          experimentalGate: report.experimentalGate,
          observedAttempts: results.reduce(
            (sum, result) => sum + result.observation.inferenceCount,
            0,
          ),
          metrics: report.metrics,
        }),
      );
    },
  );
  return action === '--initialize' ? 0 : exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error('I006 evaluation stopped; inspect private controls and preserved reports.');
      process.exitCode = 1;
    });
}
