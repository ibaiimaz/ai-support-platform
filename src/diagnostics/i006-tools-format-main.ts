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
  runToolsFormat,
  toolsFormatProtocol,
  createToolsFormatBudget,
  ToolsFormatOperationalError,
} from './i006-tools-format.js';
import { smokeCase } from './i006-smoke.js';
import { loadDataset } from '../evaluation/tool-calling/dataset.js';

export interface ToolsFormatAuthorization {
  schemaVersion: 1;
  caseId: typeof toolsFormatProtocol.id;
  execute: boolean;
  approvalReference: string | null;
  maximumAttempts: 4;
  baseUrl: 'http://localhost:11434';
  model: 'llama3.1:8b';
  modelDigest: string;
  ollamaVersion: '0.40.14';
  datasetHash: string;
  scenarioHash: string;
  lookupScenarioHash: string;
  promptHash: string;
  protocolHash: string;
  modelMetadataHash: string;
  identityHash: string | null;
}

const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const validate = new Ajv({ strictTypes: false }).compile<ToolsFormatAuthorization>({
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
    'lookupScenarioHash',
    'promptHash',
    'protocolHash',
    'modelMetadataHash',
    'identityHash',
  ],
  properties: {
    schemaVersion: { const: 1 },
    caseId: { const: toolsFormatProtocol.id },
    execute: { type: 'boolean' },
    approvalReference: { type: ['string', 'null'], pattern: '^I006-TOOLS-FORMAT-[A-Z0-9-]+$' },
    maximumAttempts: { const: 4 },
    baseUrl: { const: 'http://localhost:11434' },
    model: { const: 'llama3.1:8b' },
    modelDigest: { const: '46e0c10c039e019119339687c3c1757cc81b9da49709a3b3924863ba87ca666e' },
    ollamaVersion: { const: '0.40.14' },
    datasetHash: { const: 'fa5b19d7783417220d2b852eabe9260352ba808a4307676f6a20fa86a4562490' },
    scenarioHash: hash,
    lookupScenarioHash: hash,
    promptHash: hash,
    protocolHash: hash,
    modelMetadataHash: hash,
    identityHash: { type: ['string', 'null'], pattern: '^[a-f0-9]{64}$' },
  },
});

export interface ToolsFormatIO {
  request?: typeof fetch;
  sync?: DiskSynchronization;
  code?: (root: string) => CodeVerification;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

function parseAuthorization(bytes: string): ToolsFormatAuthorization {
  const value: unknown = JSON.parse(bytes);
  if (!validate(value)) {
    throw new ToolsFormatOperationalError();
  }
  return value;
}

export async function checkToolsFormat(root: string, io: ToolsFormatIO = {}) {
  const authorizationPath = join(root, 'evals/experiments/i006-tools-format-authorization.json');
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
    throw new ToolsFormatOperationalError();
  }
  const example = dataset.examples.find((item) => item.id === toolsFormatProtocol.directCaseId);
  if (!example) {
    throw new ToolsFormatOperationalError();
  }
  const scenarioHash = sha256(example.description);
  const lookupScenarioHash = sha256(smokeCase.description);
  const promptHash = sha256(toolCallingInstructions);
  const protocolHash = sha256(
    JSON.stringify({ tool: incidentLookupTool, schema: toolCallingFinalSchema }),
  );
  if (
    config.baseUrl !== authorization.baseUrl ||
    config.model !== authorization.model ||
    scenarioHash !== authorization.scenarioHash ||
    lookupScenarioHash !== authorization.lookupScenarioHash ||
    promptHash !== authorization.promptHash ||
    protocolHash !== authorization.protocolHash
  ) {
    throw new ToolsFormatOperationalError();
  }
  const code = io.code
    ? io.code(root)
    : captureCodeIdentity(root, snapshotBuild(join(root, 'dist')));
  const identity = {
    caseId: toolsFormatProtocol.id,
    datasetHash,
    scenarioHash,
    lookupScenarioHash,
    testProtocol: toolsFormatProtocol,
    promptHash,
    protocolHash,
    baseUrl: config.baseUrl,
    model: config.model,
    modelDigest: authorization.modelDigest,
    ollamaVersion: authorization.ollamaVersion,
    modelMetadataHash: authorization.modelMetadataHash,
    temperature: 0,
    timeouts: classificationTimeouts,
    maximumAttempts: 4,
    code: code.identity,
  };
  const identityHash = sha256(JSON.stringify(identity));
  const directory = join(root, 'evals/reports/i006-tools-format');
  let previousEvidence = false;
  try {
    previousEvidence = (await readdir(directory)).length > 0;
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw new ToolsFormatOperationalError();
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

async function verifyModel(request: typeof fetch, authorization: ToolsFormatAuthorization) {
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
      throw new ToolsFormatOperationalError();
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
    throw new ToolsFormatOperationalError();
  }
}

export async function executeToolsFormat(root: string, io: ToolsFormatIO = {}) {
  const checked = await checkToolsFormat(root, io);
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
    throw new ToolsFormatOperationalError();
  }
  const request = io.request ?? fetch;
  const sync = io.sync ?? synchronization;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return locked(directory, async () => {
    if ((await readdir(directory)).some((name) => name !== 'budget.lock')) {
      throw new ToolsFormatOperationalError();
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
          throw new ToolsFormatOperationalError();
        }
        for (const [path, bytes] of durable) {
          if (readFileSync(path, 'utf8') !== bytes) {
            throw new ToolsFormatOperationalError();
          }
        }
      } catch {
        throw new ToolsFormatOperationalError();
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
      caseId: toolsFormatProtocol.id,
      runId,
      startedAt,
      identityHash,
      maximumAttempts: 4,
    });
    await saveControl('authorization.json', authorization);
    const budget = createToolsFormatBudget(async (scenario, attempt) => {
      verify();
      await saveControl(`attempt-${scenario}-${attempt}.json`, {
        schemaVersion: 1,
        caseId: toolsFormatProtocol.id,
        runId,
        scenario,
        attempt,
        reservedAt: new Date().toISOString(),
        state: 'RESERVED_POSSIBLE_DISPATCH',
      });
      verify();
    });
    const result = await runToolsFormat({
      config,
      description: checked.example.description,
      request,
      verify,
      ...(io.now ? { now: io.now } : {}),
      reserve: budget.reserve,
      async record(scenario) {
        verify();
        await saveControl(`scenario-${scenario.scenario}.json`, scenario);
        verify();
      },
    });
    verify();
    const report = {
      schemaVersion: 1,
      caseId: toolsFormatProtocol.id,
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
  io: ToolsFormatIO = {},
): Promise<number> {
  if (args.length !== 1 || !['--check', '--run'].includes(args[0] ?? '')) {
    throw new ToolsFormatOperationalError();
  }
  if (args[0] === '--check') {
    const checked = await checkToolsFormat(root, io);
    console.log(
      JSON.stringify(
        {
          caseId: toolsFormatProtocol.id,
          authorizationEnabled: checked.authorization.execute,
          approvalReference: checked.authorization.approvalReference,
          previousEvidence: checked.previousEvidence,
          identity: checked.identity,
          identityHash: checked.identityHash,
          identityApproved: checked.authorization.identityHash === checked.identityHash,
          maximumDiagnosticAttempts: 4,
          scenarioLimits: toolsFormatProtocol.scenarioLimits,
          maximumEffectiveAttempts: 3,
          existingObservedAttempts: { smoke: 2, experiment: 1, firstInference: 1 },
          maximumCombinedObservedAttempts: 7,
          networkRequests: 0,
          modelMetadataVerified: false,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  const report = await executeToolsFormat(root, io);
  console.log(
    JSON.stringify({
      runId: report.runId,
      status: report.status,
      compatibilityObserved: report.compatibilityObserved,
      results: report.results,
      accounting: report.accounting,
    }),
  );
  return report.status === 'COMPLETE_PASSED' ? 0 : report.status === 'COMPLETE_FAILED' ? 2 : 1;
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
