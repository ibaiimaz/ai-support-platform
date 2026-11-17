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
import { runSmoke, smokeCase, SmokeOperationalError, type SmokeResult } from './i006-smoke.js';

export interface SmokeAuthorization {
  schemaVersion: 1;
  caseId: typeof smokeCase.id;
  execute: boolean;
  approvalReference: string | null;
  maximumAttempts: 2;
  baseUrl: 'http://localhost:11434';
  model: 'llama3.1:8b';
  modelDigest: string;
  ollamaVersion: '0.40.14';
  scenarioHash: string;
  promptHash: string;
  protocolHash: string;
  modelMetadataHash: string;
  identityHash: string | null;
}

const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const validate = new Ajv({ strictTypes: false }).compile<SmokeAuthorization>({
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
    'scenarioHash',
    'promptHash',
    'protocolHash',
    'modelMetadataHash',
    'identityHash',
  ],
  properties: {
    schemaVersion: { const: 1 },
    caseId: { const: smokeCase.id },
    execute: { type: 'boolean' },
    approvalReference: { type: ['string', 'null'], pattern: '^I006-SMOKE-[A-Z0-9-]+$' },
    maximumAttempts: { const: 2 },
    baseUrl: { const: 'http://localhost:11434' },
    model: { const: 'llama3.1:8b' },
    modelDigest: { const: '46e0c10c039e019119339687c3c1757cc81b9da49709a3b3924863ba87ca666e' },
    ollamaVersion: { const: '0.40.14' },
    scenarioHash: hash,
    promptHash: hash,
    protocolHash: hash,
    modelMetadataHash: hash,
    identityHash: { type: ['string', 'null'], pattern: '^[a-f0-9]{64}$' },
  },
});

export interface SmokeIO {
  request?: typeof fetch;
  sync?: DiskSynchronization;
  code?: (root: string) => CodeVerification;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

function parseAuthorization(bytes: string): SmokeAuthorization {
  const value: unknown = JSON.parse(bytes);
  if (!validate(value)) {
    throw new SmokeOperationalError();
  }
  return value;
}

export async function checkSmoke(root: string, io: SmokeIO = {}) {
  const authorizationPath = join(root, 'evals/experiments/i006-smoke-authorization.json');
  const authorizationBytes = await readFile(authorizationPath, 'utf8');
  const authorization = parseAuthorization(authorizationBytes);
  const config = loadConfig(io.env);
  const scenarioHash = sha256(smokeCase.description);
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
    throw new SmokeOperationalError();
  }
  const code = io.code
    ? io.code(root)
    : captureCodeIdentity(root, snapshotBuild(join(root, 'dist')));
  const identity = {
    caseId: smokeCase.id,
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
    maximumAttempts: 2,
    code: code.identity,
  };
  const identityHash = sha256(JSON.stringify(identity));
  const directory = join(root, 'evals/reports/i006-smoke');
  let previousEvidence = false;
  try {
    previousEvidence = (await readdir(directory)).length > 0;
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw new SmokeOperationalError();
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
  };
}

async function verifyModel(request: typeof fetch, authorization: SmokeAuthorization) {
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
      throw new SmokeOperationalError();
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
    throw new SmokeOperationalError();
  }
}

export async function executeSmoke(root: string, io: SmokeIO = {}) {
  const checked = await checkSmoke(root, io);
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
    authorization.identityHash !== identityHash ||
    checked.previousEvidence
  ) {
    throw new SmokeOperationalError();
  }
  const request = io.request ?? fetch;
  const sync = io.sync ?? synchronization;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return locked(directory, async () => {
    if ((await readdir(directory)).some((name) => name !== 'budget.lock')) {
      throw new SmokeOperationalError();
    }
    await verifyModel(request, authorization);
    const durable = new Map<string, string>();
    const verify = () => {
      try {
        code.verify();
        if (
          readFileSync(authorizationPath, 'utf8') !== authorizationBytes ||
          JSON.stringify(loadConfig(io.env)) !== JSON.stringify(config)
        ) {
          throw new SmokeOperationalError();
        }
        for (const [path, bytes] of durable) {
          if (readFileSync(path, 'utf8') !== bytes) {
            throw new SmokeOperationalError();
          }
        }
      } catch {
        throw new SmokeOperationalError();
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
      caseId: smokeCase.id,
      runId,
      startedAt,
      identityHash,
      maximumAttempts: 2,
    });
    await saveControl('authorization.json', authorization);
    let nextAttempt = 1;
    const result: SmokeResult = await runSmoke({
      config,
      request,
      verify,
      ...(io.now ? { now: io.now } : {}),
      async reserve(attempt) {
        verify();
        if (attempt !== nextAttempt || attempt > 2) {
          throw new SmokeOperationalError();
        }
        await saveControl(`attempt-${attempt}.json`, {
          schemaVersion: 1,
          caseId: smokeCase.id,
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
      caseId: smokeCase.id,
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
  io: SmokeIO = {},
): Promise<number> {
  if (args.length !== 1 || !['--check', '--run'].includes(args[0] ?? '')) {
    throw new SmokeOperationalError();
  }
  if (args[0] === '--check') {
    const checked = await checkSmoke(root, io);
    console.log(
      JSON.stringify(
        {
          caseId: smokeCase.id,
          authorizationEnabled: checked.authorization.execute,
          approvalReference: checked.authorization.approvalReference,
          previousEvidence: checked.previousEvidence,
          identity: checked.identity,
          identityHash: checked.identityHash,
          identityApproved: checked.authorization.identityHash === checked.identityHash,
          maximumDiagnosticAttempts: 2,
          maximumExperimentalAttempts: 120,
          maximumCombinedAttempts: 122,
          networkRequests: 0,
          modelMetadataVerified: false,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  const report = await executeSmoke(root, io);
  console.log(
    JSON.stringify({
      runId: report.runId,
      technicalStatus: report.technicalStatus,
      scenarioStatus: report.scenarioStatus,
      operationalStatus: report.operationalStatus,
      accounting: report.accounting,
    }),
  );
  return report.operationalStatus !== 'OK' || report.scenarioStatus === 'INCOMPLETE'
    ? 1
    : report.scenarioStatus === 'PASSED'
      ? 0
      : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error(
        'I006 smoke blocked or interrupted. Inspect private diagnostic evidence before any new action; missing responses do not imply zero attempts.',
      );
      process.exitCode = 1;
    });
}
