import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Ajv } from 'ajv';
import { loadConfig } from '../config.js';
import { classificationTimeouts } from '../application/classification-timeouts.js';
import { toolCallingInstructions } from '../infrastructure/ollama/tool-calling-instructions.js';
import {
  incidentLookupTool,
  toolCallingFinalSchema,
} from '../infrastructure/ollama/tool-calling-protocol.js';
import { sha256 } from '../evaluation/dataset.js';
import {
  locked,
  persist,
  synchronization,
  type DiskSynchronization,
} from '../evaluation/durable-files.js';
import {
  captureCodeIdentity,
  snapshotBuild,
  type CodeVerification,
} from '../evaluation/independent-validation/code-state.js';
import {
  runFirstInference,
  firstInferenceCase,
  FirstInferenceOperationalError,
  type FirstInferenceResult,
} from './i006-first-inference.js';
import { loadDataset } from '../evaluation/tool-calling/dataset.js';

export interface FirstInferenceAuthorization {
  schemaVersion: 1;
  caseId: typeof firstInferenceCase.id;
  execute: boolean;
  approvalReference: string | null;
  maximumAttempts: 1;
  baseUrl: 'http://localhost:11434';
  model: 'llama3.1:8b';
  modelDigest: string;
  ollamaVersion: '0.40.14';
  datasetHash: string;
  scenarioHash: string;
  promptHash: string;
  protocolHash: string;
  modelMetadataHash: string;
  identityHash: string | null;
}

const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const validate = new Ajv({ strictTypes: false }).compile<FirstInferenceAuthorization>({
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'caseId',
    'execute',
    'approvalReference',
    'maximumAttempts',
    'baseUrl',
    'model',
    'modelDigest',
    'ollamaVersion',
    'datasetHash',
    'scenarioHash',
    'promptHash',
    'protocolHash',
    'modelMetadataHash',
    'identityHash',
  ],
  properties: {
    schemaVersion: { const: 1 },
    caseId: { const: firstInferenceCase.id },
    execute: { type: 'boolean' },
    approvalReference: { type: ['string', 'null'], pattern: '^I006-FIRST-INFERENCE-[A-Z0-9-]+$' },
    maximumAttempts: { const: 1 },
    baseUrl: { const: 'http://localhost:11434' },
    model: { const: 'llama3.1:8b' },
    modelDigest: { const: '46e0c10c039e019119339687c3c1757cc81b9da49709a3b3924863ba87ca666e' },
    ollamaVersion: { const: '0.40.14' },
    datasetHash: { const: 'fa5b19d7783417220d2b852eabe9260352ba808a4307676f6a20fa86a4562490' },
    scenarioHash: hash,
    promptHash: hash,
    protocolHash: hash,
    modelMetadataHash: hash,
    identityHash: { type: ['string', 'null'], pattern: '^[a-f0-9]{64}$' },
  },
});

export interface FirstInferenceIO {
  request?: typeof fetch;
  sync?: DiskSynchronization;
  code?: (root: string) => CodeVerification;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

function parseAuthorization(bytes: string): FirstInferenceAuthorization {
  const value: unknown = JSON.parse(bytes);
  if (!validate(value)) {
    throw new FirstInferenceOperationalError();
  }
  return value;
}

export async function checkFirstInference(root: string, io: FirstInferenceIO = {}) {
  const authorizationPath = join(root, 'evals/experiments/i006-first-inference-authorization.json');
  const authorizationBytes = await readFile(authorizationPath, 'utf8');
  const authorization = parseAuthorization(authorizationBytes);
  const config = loadConfig(io.env);
  const datasetPath = join(root, 'evals/datasets/incidents-tool-calling-v1.json');
  const { dataset, hash: datasetHash } = await loadDataset(datasetPath);
  if (
    datasetHash !== authorization.datasetHash ||
    dataset.id !== 'incidents-tool-calling-es-v1' ||
    dataset.schemaVersion !== 1 ||
    dataset.version !== 3
  ) {
    throw new FirstInferenceOperationalError();
  }
  const example = dataset.examples.find((item) => item.id === firstInferenceCase.id);
  if (!example) {
    throw new FirstInferenceOperationalError();
  }
  const scenarioHash = sha256(example.description);
  const promptHash = sha256(toolCallingInstructions);
  const protocolHash = sha256(
    JSON.stringify({ tool: incidentLookupTool, schema: toolCallingFinalSchema }),
  );
  if (
    config.baseUrl !== authorization.baseUrl ||
    config.model !== authorization.model ||
    scenarioHash !== authorization.scenarioHash ||
    promptHash !== authorization.promptHash ||
    protocolHash !== authorization.protocolHash
  ) {
    throw new FirstInferenceOperationalError();
  }
  const code = io.code
    ? io.code(root)
    : captureCodeIdentity(root, snapshotBuild(join(root, 'dist')));
  const identity = {
    caseId: firstInferenceCase.id,
    datasetHash,
    scenarioHash,
    promptHash,
    protocolHash,
    baseUrl: config.baseUrl,
    model: config.model,
    modelDigest: authorization.modelDigest,
    ollamaVersion: authorization.ollamaVersion,
    modelMetadataHash: authorization.modelMetadataHash,
    temperature: 0,
    timeouts: classificationTimeouts,
    maximumAttempts: 1,
    code: code.identity,
  };
  const identityHash = sha256(JSON.stringify(identity));
  const directory = join(root, 'evals/reports/i006-first-inference');
  let previousEvidence = false;
  try {
    previousEvidence = (await readdir(directory)).length > 0;
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw new FirstInferenceOperationalError();
    }
  }
  return {
    authorization,
    authorizationBytes,
    authorizationPath,
    config,
    code,
    identity,
    identityHash,
    directory,
    previousEvidence,
    datasetPath,
    example,
  };
}

async function verifyModel(request: typeof fetch, authorization: FirstInferenceAuthorization) {
  const read = async (path: string, body?: unknown): Promise<unknown> => {
    const response = await request(new URL(path, authorization.baseUrl), {
      ...(body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new FirstInferenceOperationalError();
    }
    return response.json();
  };
  const version = (await read('/api/version')) as { version?: string };
  const tags = (await read('/api/tags')) as { models?: { name: string; digest: string }[] };
  const model = tags.models?.find((item) => item.name === authorization.model);
  const details = (await read('/api/show', { model: authorization.model })) as {
    capabilities?: string[];
  };
  if (
    version.version !== authorization.ollamaVersion ||
    model?.digest !== authorization.modelDigest ||
    !details.capabilities?.includes('tools') ||
    sha256(JSON.stringify(details)) !== authorization.modelMetadataHash
  ) {
    throw new FirstInferenceOperationalError();
  }
}

export async function executeFirstInference(root: string, io: FirstInferenceIO = {}) {
  const checked = await checkFirstInference(root, io);
  const {
    authorization,
    authorizationPath,
    authorizationBytes,
    identityHash,
    directory,
    code,
    config,
  } = checked;
  if (
    !authorization.execute ||
    !authorization.approvalReference ||
    authorization.identityHash !== identityHash
  ) {
    throw new FirstInferenceOperationalError();
  }
  const request = io.request ?? fetch;
  const sync = io.sync ?? synchronization;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return locked(directory, async () => {
    if ((await readdir(directory)).some((name) => name !== 'budget.lock')) {
      throw new FirstInferenceOperationalError();
    }
    await verifyModel(request, authorization);
    const durable = new Map<string, string>();
    const verify = () => {
      try {
        code.verify();
        if (
          sha256(readFileSync(checked.datasetPath)) !== authorization.datasetHash ||
          readFileSync(authorizationPath, 'utf8') !== authorizationBytes ||
          JSON.stringify(loadConfig(io.env)) !== JSON.stringify(config)
        ) {
          throw new FirstInferenceOperationalError();
        }
        for (const [path, bytes] of durable) {
          if (readFileSync(path, 'utf8') !== bytes) {
            throw new FirstInferenceOperationalError();
          }
        }
      } catch {
        throw new FirstInferenceOperationalError();
      }
    };
    verify();
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const saveControl = async (name: string, value: unknown) => {
      const path = join(directory, name);
      const bytes = JSON.stringify(value, null, 2) + '\n';
      await persist(path, bytes, true, sync);
      durable.set(path, bytes);
    };
    // Persistent claim survives completion, crashes and missing final reports.
    await saveControl('started.json', {
      schemaVersion: 1,
      caseId: firstInferenceCase.id,
      runId,
      startedAt,
      identityHash,
      maximumAttempts: 1,
    });
    await saveControl('authorization.json', authorization);
    let nextAttempt = 1;
    const result: FirstInferenceResult = await runFirstInference({
      config,
      description: checked.example.description,
      request,
      verify,
      ...(io.now ? { now: io.now } : {}),
      async reserve(attempt) {
        verify();
        if (attempt !== nextAttempt || attempt > 1) {
          throw new FirstInferenceOperationalError();
        }
        await saveControl(`attempt-${attempt}.json`, {
          schemaVersion: 1,
          caseId: firstInferenceCase.id,
          runId,
          attempt,
          reservedAt: new Date().toISOString(),
          state: 'RESERVED_POSSIBLE_DISPATCH',
        });
        nextAttempt++;
        verify();
      },
    });
    verify();
    const report = {
      schemaVersion: 1,
      caseId: firstInferenceCase.id,
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      identity: checked.identity,
      identityHash,
      approvalReference: authorization.approvalReference,
      ...result,
    };
    const bytes = JSON.stringify(report, null, 2) + '\n';
    await persist(join(directory, 'report.json'), bytes, true, sync);
    const reportHash = sha256(bytes);
    await persist(join(directory, 'report.json.sha256'), reportHash + '\n', true, sync);
    await saveControl('closed.json', {
      schemaVersion: 1,
      runId,
      identityHash,
      reportHash,
      accounting: result.accounting,
    });
    return report;
  });
}

export async function main(
  args = process.argv.slice(2),
  root = fileURLToPath(new URL('../../../', import.meta.url)),
  io: FirstInferenceIO = {},
): Promise<number> {
  if (args.length !== 1 || !['--check', '--run'].includes(args[0] ?? '')) {
    throw new FirstInferenceOperationalError();
  }
  if (args[0] === '--check') {
    const checked = await checkFirstInference(root, io);
    console.log(
      JSON.stringify(
        {
          caseId: firstInferenceCase.id,
          authorizationEnabled: checked.authorization.execute,
          approvalReference: checked.authorization.approvalReference,
          previousEvidence: checked.previousEvidence,
          identity: checked.identity,
          identityHash: checked.identityHash,
          identityApproved: checked.authorization.identityHash === checked.identityHash,
          maximumDiagnosticAttempts: 1,
          existingObservedAttempts: { smoke: 2, experiment: 1 },
          maximumCombinedObservedAttempts: 4,
          networkRequests: 0,
          modelMetadataVerified: false,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  const report = await executeFirstInference(root, io);
  console.log(
    JSON.stringify({
      runId: report.runId,
      status: report.status,
      firstResponse: report.firstResponse,
      error: report.error,
      ...(report.diagnostic ? { diagnostic: report.diagnostic } : {}),
      accounting: report.accounting,
    }),
  );
  return report.status === 'FIRST_RESPONSE_OBSERVED' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error(
        JSON.stringify({
          status: 'OPERATIONAL_FAILURE',
          reason: 'DIAGNOSTIC_BLOCKED_OR_INTERRUPTED',
        }),
      );
      process.exitCode = 1;
    });
}
