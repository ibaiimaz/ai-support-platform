import { readFile, readdir, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClassificationDependencies } from '../../composition.js';
import { loadConfig } from '../../config.js';
import { toolCallingInstructions } from '../../infrastructure/ollama/tool-calling-instructions.js';
import {
  incidentLookupTool,
  toolCallingFinalSchema,
} from '../../infrastructure/ollama/tool-calling-protocol.js';
import { sha256 } from '../dataset.js';
import { findCodeReference } from '../code-reference.js';
import { readAuthorization, withControl } from './control.js';
import { loadDataset } from './dataset.js';
import { buildReport, saveReport } from './report.js';
import { runEvaluation } from './run.js';
import type { CaseResult, RunIdentity } from './types.js';

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

export async function effectiveIdentity(root: string, datasetHash: string): Promise<RunIdentity> {
  const config = loadConfig();
  const tags = (await metadata(config.baseUrl, '/api/tags')) as {
    models?: { name: string; digest: string }[];
  };
  const model = tags.models?.find((item) => item.name === config.model);
  const version = (await metadata(config.baseUrl, '/api/version')) as { version?: string };
  const show = await metadata(config.baseUrl, '/api/show', { model: config.model });
  if (!model || !/^[a-f0-9]{64}$/.test(model.digest) || typeof version.version !== 'string') {
    throw new Error('Cannot establish model identity');
  }
  return {
    datasetHash,
    model: config.model,
    modelDigest: model.digest,
    ollamaVersion: version.version,
    modelMetadataHash: sha256(JSON.stringify(show)),
    promptHash: sha256(toolCallingInstructions),
    protocolHash: sha256(
      JSON.stringify({ tool: incidentLookupTool, schema: toolCallingFinalSchema }),
    ),
    codeReference: findCodeReference(root),
    sourceStateHash: await treeIdentity(root),
    baseUrl: config.baseUrl,
    temperature: 0,
    llmTimeoutMs: 45000,
    toolTimeoutMs: 5000,
    globalTimeoutMs: 90000,
  };
}

export async function main(root = process.cwd(), args = process.argv.slice(2)): Promise<number> {
  const action = args[0];
  if (
    args.length !== 1 ||
    !['--validate', '--identity', '--initialize', '--execute'].includes(action ?? '')
  ) {
    throw new Error('Use one explicit I006 action');
  }
  const datasetPath = join(root, 'evals/datasets/incidents-tool-calling-v1.json');
  const { dataset, hash } = await loadDataset(datasetPath);
  if (action === '--validate') {
    console.log(
      JSON.stringify({
        dataset: dataset.id,
        version: dataset.version,
        cases: dataset.examples.length,
        review: 'PENDING_HUMAN_REVIEW',
      }),
    );
    return 0;
  }
  const authorizationPath = join(root, 'evals/experiments/i006-manifest.json');
  const authorization = await readAuthorization(authorizationPath);
  if (
    action !== '--identity' &&
    !authorization[action === '--initialize' ? 'initialize' : 'execute']
  ) {
    throw new Error('I006 action is disabled');
  }
  const identity = await effectiveIdentity(root, hash);
  if (action === '--identity') {
    console.log(
      JSON.stringify({ identity, identityHash: sha256(JSON.stringify(identity)) }, null, 2),
    );
    return 0;
  }
  const reports = join(root, 'evals/reports/i006');
  const controls = join(reports, 'controls');
  let exitCode = 1;
  await withControl(
    controls,
    dataset,
    identity,
    authorizationPath,
    action === '--initialize',
    async (control) => {
      const config = loadConfig();
      const dependencies = createClassificationDependencies(config);
      const startedAt = new Date().toISOString();
      let latest: CaseResult[] = [];
      await mkdir(reports, { recursive: true, mode: 0o700 });
      const runId = control.runId!;
      const results = await runEvaluation(dataset, dependencies, {
        async reserve(example) {
          if (
            (await loadDataset(datasetPath)).hash !== hash ||
            JSON.stringify(await effectiveIdentity(root, hash)) !== JSON.stringify(identity) ||
            JSON.stringify(loadConfig()) !== JSON.stringify(config)
          ) {
            throw new Error('I006 inputs changed during execution');
          }
          await control.reserve(example);
        },
        async record(result) {
          await control.record(result);
          latest = [...latest, result];
          await saveReport(reports, buildReport(dataset, identity, latest, startedAt, runId));
        },
      });
      const report = buildReport(dataset, identity, results, startedAt, runId);
      exitCode =
        report.status === 'COMPLETE_PASSED' ? 0 : report.status === 'COMPLETE_FAILED' ? 2 : 1;
      console.log(
        JSON.stringify({
          runId,
          status: report.status,
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
