import { readFileSync, existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Ajv } from 'ajv';
import { classifyIncident } from '../dist/src/application/classify-incident.js';
import {
  ClassificationError,
  isInvalidResponseDiagnostic,
} from '../dist/src/application/classification-errors.js';
import {
  GlobalDeadlineExceededError,
  InvalidToolCallError,
} from '../dist/src/application/tool-calling-errors.js';
import { readIncidentId } from '../dist/src/application/get-incident-by-id.js';
import { createClassificationDependencies } from '../dist/src/composition.js';
import { loadConfig } from '../dist/src/config.js';
import { createGuardedTransport, smokeCase } from '../dist/src/diagnostics/i006-smoke.js';
import { persist, locked, synchronization } from '../dist/src/evaluation/durable-files.js';
import { sha256 } from '../dist/src/evaluation/dataset.js';
import { loadDataset } from '../dist/src/evaluation/tool-calling/dataset.js';
import { effectiveIdentity } from '../dist/src/evaluation/tool-calling/main.js';
import {
  captureCodeIdentity,
  snapshotBuild,
} from '../dist/src/evaluation/independent-validation/code-state.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const scriptPath = fileURLToPath(import.meta.url);
const authorizationPath = join(root, 'evals/experiments/i006-r6-smoke-authorization.json');
const directory = join(root, 'evals/reports/i006-r6-smoke');
const implementationHash = '2ede2557caba18117260d701db5528c9f4eff58fa50d9c494ad2bfd03b9b9f0b';
const datasetHash = 'fa5b19d7783417220d2b852eabe9260352ba808a4307676f6a20fa86a4562490';
const config = { baseUrl: 'http://localhost:11434', model: 'llama3.1:8b' };
const mismatch = new Error('EXPECTED_PATH_DEVIATION');
const validateAuthorization = new Ajv().compile({
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'diagnostic',
    'execute',
    'identityHash',
    'approvalReference',
    'maximumAttempts',
    'dedicated',
    'serverPid',
  ],
  properties: {
    schemaVersion: { const: 1 },
    diagnostic: { const: 'I006_R6_SMOKE' },
    execute: { type: 'boolean' },
    identityHash: { type: ['string', 'null'], pattern: '^[a-f0-9]{64}$' },
    approvalReference: { type: ['string', 'null'], minLength: 1 },
    maximumAttempts: { const: 4 },
    dedicated: { type: 'boolean' },
    serverPid: { type: ['integer', 'null'], minimum: 1 },
  },
});

function authorization(path) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!validateAuthorization(value)) {
    throw new Error('INVALID_AUTHORIZATION');
  }
  return value;
}

function requirePermission(path, identityHash) {
  const value = authorization(path);
  if (
    !value.execute ||
    value.identityHash !== identityHash ||
    !value.approvalReference ||
    !value.dedicated ||
    !value.serverPid
  ) {
    throw new Error('DIAGNOSTIC_DISABLED_OR_UNAPPROVED');
  }
  return value;
}

export async function check() {
  const datasetPath = join(root, 'evals/datasets/incidents-tool-calling-v1.json');
  const loaded = await loadDataset(datasetPath);
  const active = loadConfig();
  if (
    loaded.hash !== datasetHash ||
    active.baseUrl !== config.baseUrl ||
    active.model !== config.model
  ) {
    throw new Error('INPUT_IDENTITY_MISMATCH');
  }
  const code = captureCodeIdentity(root, snapshotBuild(join(root, 'dist')));
  if (
    code.identity.commit !== 'git:ee8e8b87fa0707d314ba59e880ea6181717dc9ef' ||
    code.identity.sourceSha256 !==
      'cdaa17a01514d72ef9cab216ec3c9faadc433076bfb2857aff11512a5f5a1c8e' ||
    code.identity.buildSha256 !== '587b0e7ec376cdbfecc899a83cca09b56ece64c56a37e0d7ba6ae756e5e11d6b'
  ) {
    throw new Error('IMPLEMENTATION_IDENTITY_MISMATCH');
  }
  const first = loaded.dataset.examples.find((example) => example.id === 'I006-001');
  if (first?.expectedFinal.category !== 'BUG' || first.toolExpected) {
    throw new Error('SCENARIO_IDENTITY_MISMATCH');
  }
  const scenarios = [
    { id: 'I006-001', description: first.description, lookup: false },
    { id: 'I006-R6-INC-142', description: smokeCase.description, lookup: true },
  ];
  const scriptHash = sha256(readFileSync(scriptPath));
  const identity = {
    diagnostic: 'I006_R6_SMOKE',
    implementationHash,
    model: config.model,
    modelDigest: '46e0c10c039e019119339687c3c1757cc81b9da49709a3b3924863ba87ca666e',
    ollamaVersion: '0.40.14',
    code: code.identity,
    scriptHash,
    datasetHash,
    scenarioHashes: scenarios.map((scenario) => ({
      id: scenario.id,
      hash: sha256(JSON.stringify(scenario)),
    })),
    maximumAttempts: 4,
    maximumPerScenario: 2,
    protocol: 'I006-DECISION-CLASSIFICATION-V1',
  };
  const verify = () => {
    code.verify();
    if (
      sha256(readFileSync(scriptPath)) !== scriptHash ||
      sha256(readFileSync(datasetPath)) !== datasetHash ||
      loadConfig().baseUrl !== config.baseUrl ||
      loadConfig().model !== config.model
    ) {
      throw new Error('INPUTS_CHANGED');
    }
  };
  return { identity, identityHash: sha256(JSON.stringify(identity)), scenarios, verify, code };
}

function processIds(args) {
  try {
    const output = execFileSync('lsof', ['-nP', ...args, '-t'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const pids = output.trim().split(/\s+/).map(Number);
    if (pids.some((pid) => !Number.isSafeInteger(pid) || pid < 1)) {
      throw new Error('PROCESS_IDENTITY_UNAVAILABLE');
    }
    return [...new Set(pids)];
  } catch (error) {
    if (error.status === 1 && String(error.stderr ?? '').trim() === '') {
      return [];
    }
    throw new Error('PROCESS_OBSERVATION_FAILED');
  }
}

async function isolation(state, permission) {
  const listeners = processIds(['-iTCP:11434', '-sTCP:LISTEN']);
  const command = execFileSync('ps', ['-p', String(permission.serverPid), '-o', 'comm='], {
    encoding: 'utf8',
    timeout: 2000,
  });
  if (
    listeners.length !== 1 ||
    listeners[0] !== permission.serverPid ||
    basename(command.trim()).toLowerCase() !== 'ollama' ||
    processIds(['-iTCP:3000', '-sTCP:LISTEN']).length !== 0 ||
    processIds(['-iTCP:11434', '-sTCP:ESTABLISHED']).some(
      (pid) => pid !== process.pid && pid !== permission.serverPid,
    )
  ) {
    throw new Error('OLLAMA_NOT_ISOLATED');
  }
  const actual = await effectiveIdentity(root, datasetHash, state.code);
  if (sha256(JSON.stringify(actual)) !== implementationHash) {
    throw new Error('MODEL_OR_CONFIGURATION_CHANGED');
  }
  const response = await fetch(`${config.baseUrl}/api/ps`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) {
    throw new Error('RESIDENCY_UNAVAILABLE');
  }
  const residents = await response.json();
  if (
    !Array.isArray(residents.models) ||
    residents.models.some(
      (model) => model.name !== actual.model || model.digest !== actual.modelDigest,
    )
  ) {
    throw new Error('RESIDENCY_MISMATCH');
  }
}

export async function run({
  state,
  outputDirectory,
  permissionPath,
  preflight,
  request,
  sync = synchronization,
}) {
  const permission = requirePermission(permissionPath, state.identityHash);
  state.verify();
  await preflight(state, permission);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  return locked(outputDirectory, async () => {
    if ((await readdir(outputDirectory)).some((name) => name !== 'budget.lock')) {
      throw new Error('DIAGNOSTIC_ALREADY_STARTED_OR_UNCERTAIN');
    }
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const marker = JSON.stringify({
      runId,
      identityHash: state.identityHash,
      approvalReference: permission.approvalReference,
    });
    await persist(join(outputDirectory, 'started.json'), marker, true, sync);
    await persist(
      join(outputDirectory, 'identity.json'),
      JSON.stringify(state.identity),
      true,
      sync,
    );
    await persist(
      join(outputDirectory, 'authorization.json'),
      JSON.stringify(permission),
      true,
      sync,
    );
    const attempts = [];
    const results = [];
    const journals = new Map();
    let operationalFailure = false;
    const verify = () => {
      const current = requirePermission(permissionPath, state.identityHash);
      if (
        JSON.stringify(current) !== JSON.stringify(permission) ||
        readFileSync(join(outputDirectory, 'started.json'), 'utf8') !== marker
      ) {
        throw new Error('CONTROLS_CHANGED');
      }
      state.verify();
      for (const [path, bytes] of journals) {
        if (readFileSync(path, 'utf8') !== bytes) {
          throw new Error('RESERVATION_CHANGED');
        }
      }
    };
    for (const scenario of state.scenarios) {
      const result = {
        id: scenario.id,
        status: 'INCOMPLETE',
        firstResponse: null,
        finalCategory: null,
        toolRequests: 0,
        toolExecutions: 0,
        toolOutcome: null,
        latenciesMs: [],
        error: null,
      };
      results.push(result);
      let observing = true;
      let phase = 0;
      const guard = createGuardedTransport({
        baseUrl: config.baseUrl,
        async reserve(number) {
          try {
            verify();
            await preflight(state, permission);
            verify();
            if (attempts.length >= 4 || number !== phase || number > 2) {
              throw new Error('BUDGET_OR_ORDER_BLOCKED');
            }
            const attempt = {
              scenario: scenario.id,
              phase: number,
              reservation: 'UNCERTAIN',
              dispatched: false,
              validated: false,
            };
            attempts.push(attempt);
            const path = join(outputDirectory, `attempt-${attempts.length}.json`);
            const bytes = JSON.stringify({
              runId,
              scenario: scenario.id,
              phase: number,
              state: 'RESERVED_POSSIBLE_DISPATCH',
            });
            await persist(path, bytes, true, sync);
            journals.set(path, bytes);
            attempt.reservation = 'DURABLE';
          } catch {
            operationalFailure = true;
            throw new Error('RESERVATION_FAILED');
          }
        },
        beforeDispatch() {
          try {
            verify();
          } catch {
            operationalFailure = true;
            throw new Error('DISPATCH_BLOCKED');
          }
        },
        async request(input, init) {
          attempts.at(-1).dispatched = true;
          return request(input, init);
        },
      });
      const dependencies = createClassificationDependencies(config, guard.request);
      const originalLlm = dependencies.llm;
      const originalRepository = dependencies.repository;
      dependencies.llm = {
        async infer(messages, options) {
          phase++;
          const start = performance.now();
          try {
            const response = await originalLlm.infer(messages, options);
            if (!observing) {
              return response;
            }
            attempts.at(-1).validated = true;
            if (phase === 1) {
              result.firstResponse = response.type;
              if (response.type === 'tool_calls') {
                result.toolRequests = response.calls.length;
              }
              if (
                scenario.lookup
                  ? response.type !== 'tool_calls' ||
                    response.calls.length !== 1 ||
                    readIncidentId(response.calls[0]) !== 'INC-142'
                  : response.type !== 'no_lookup'
              ) {
                throw mismatch;
              }
            } else {
              result.finalCategory = response.type === 'classification' ? response.category : null;
              if (
                phase !== 2 ||
                options.toolsEnabled ||
                response.type !== 'classification' ||
                response.category !== 'BUG'
              ) {
                throw mismatch;
              }
            }
            return response;
          } finally {
            if (observing) {
              result.latenciesMs.push(Math.max(0, performance.now() - start));
            }
          }
        },
      };
      dependencies.repository = {
        async getById(id, options) {
          if (!observing || !scenario.lookup || id !== 'INC-142' || result.toolExecutions !== 0) {
            throw mismatch;
          }
          result.toolExecutions++;
          const incident = await originalRepository.getById(id, options);
          result.toolOutcome = incident === null ? 'NOT_FOUND' : 'FOUND';
          if (incident === null) {
            throw mismatch;
          }
          return incident;
        },
      };
      try {
        const final = await classifyIncident(dependencies, scenario.description);
        if (
          final.status !== 'CLASSIFIED' ||
          final.category !== 'BUG' ||
          phase !== 2 ||
          result.toolExecutions !== Number(scenario.lookup)
        ) {
          throw mismatch;
        }
        result.finalCategory = final.category;
        result.status = 'PASSED';
      } catch (error) {
        result.status = operationalFailure
          ? 'OPERATIONAL_ERROR'
          : error === mismatch || error instanceof InvalidToolCallError
            ? 'FUNCTIONAL_DEVIATION'
            : error instanceof ClassificationError || error instanceof GlobalDeadlineExceededError
              ? 'TECHNICAL_ERROR'
              : 'OPERATIONAL_ERROR';
        if (error instanceof ClassificationError) {
          result.error = {
            kind: error.kind,
            ...(isInvalidResponseDiagnostic(error.diagnostic)
              ? { diagnostic: error.diagnostic }
              : {}),
          };
        } else if (error instanceof GlobalDeadlineExceededError) {
          result.error = { kind: 'global_deadline_exceeded' };
        }
      } finally {
        observing = false;
        guard.close();
        await guard.settle();
      }
      if (operationalFailure || guard.operationalFailure()) {
        result.status = 'OPERATIONAL_ERROR';
      }
      if (result.status !== 'PASSED') {
        break;
      }
    }
    const report = {
      schemaVersion: 1,
      runId,
      identityHash: state.identityHash,
      approvalReference: permission.approvalReference,
      status:
        results.length === 2 && results.every((item) => item.status === 'PASSED')
          ? 'PASSED'
          : 'STOPPED',
      maximumAttempts: 4,
      startedAt,
      finishedAt: new Date().toISOString(),
      totalLatencyMs: Math.max(0, performance.now() - started),
      attempts,
      results,
      experimentalBudgetTouched: false,
    };
    const bytes = JSON.stringify(report, null, 2) + '\n';
    await persist(join(outputDirectory, 'report.json'), bytes, true, sync);
    await persist(join(outputDirectory, 'report.json.sha256'), sha256(bytes) + '\n', true, sync);
    await persist(
      join(outputDirectory, 'closed.json'),
      JSON.stringify({ runId, status: report.status, reportHash: sha256(bytes) }),
      true,
      sync,
    );
    return report;
  });
}

export async function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || !['--check', '--run'].includes(args[0])) {
    throw new Error('USE_CHECK_OR_RUN');
  }
  const state = await check();
  if (args[0] === '--check') {
    const permission = authorization(authorizationPath);
    console.log(
      JSON.stringify(
        {
          identity: state.identity,
          identityHash: state.identityHash,
          execute: permission.execute,
          evidenceDirectoryExists: existsSync(directory),
          maximumAttempts: 4,
        },
        null,
        2,
      ),
    );
    return;
  }
  const report = await run({
    state,
    outputDirectory: directory,
    permissionPath: authorizationPath,
    preflight: isolation,
    request: fetch,
  });
  console.log(JSON.stringify(report));
  process.exitCode = report.status === 'PASSED' ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    console.error(
      'I006_R6_SMOKE_BLOCKED_OR_OPERATIONAL_FAILURE; inspect private evidence without retrying.',
    );
    process.exitCode = 1;
  });
}
