import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { mkdir, writeFile, open, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { Ajv } from 'ajv';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const defaultBatch = join(root, 'evals/experiments/i006-exploration-batch.json');
const outputRoot = join(root, 'evals/reports/i006-exploration');
const baseUrl = 'http://localhost:11434';
const model = 'llama3.1:8b';
const digest = '46e0c10c039e019119339687c3c1757cc81b9da49709a3b3924863ba87ca666e';
const maximumCalls = 12;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function identifiers(description) {
  return [
    ...new Set(
      [...description.matchAll(/(?<![\p{L}\p{N}_-])inc-[1-9][0-9]{0,5}(?![\p{L}\p{N}_-])/giu)].map(
        (match) => match[0].replace(/^inc-/i, 'INC-'),
      ),
    ),
  ];
}

export function decodeDecision(record) {
  const result = {
    source: 'LLM',
    action: null,
    incidentId: null,
    valid: false,
    blocked: false,
    structuralError: null,
  };
  if (record.state !== 'RECEIVED') {
    return { ...result, structuralError: record.state };
  }
  try {
    const envelope = JSON.parse(record.responseBody);
    if (
      envelope.done !== true ||
      envelope.done_reason !== 'stop' ||
      envelope.message?.role !== 'assistant'
    ) {
      throw new Error('ENVELOPE_INVALID');
    }
    if (record.mechanism === 'native') {
      const message = envelope.message;
      if (!Object.hasOwn(message, 'tool_calls')) {
        if (Object.hasOwn(message, 'content') && typeof message.content !== 'string') {
          throw new Error('CONTENT_INVALID');
        }
        return { ...result, action: 'NO_LOOKUP', valid: true };
      }
      result.action = 'LOOKUP';
      if (
        !Array.isArray(message.tool_calls) ||
        message.tool_calls.length !== 1 ||
        (Object.hasOwn(message, 'content') && message.content !== '')
      ) {
        throw new Error('NATIVE_CALLS_INVALID');
      }
      const call = message.tool_calls[0]?.function;
      result.incidentId =
        typeof call?.arguments?.incidentId === 'string' ? call.arguments.incidentId : null;
      const schema = record.request.tools?.[0]?.function?.parameters;
      if (
        call?.name !== 'getIncidentById' ||
        !new Ajv().compile(schema)(call.arguments) ||
        !/^INC-[1-9][0-9]{0,5}$/.test(result.incidentId ?? '')
      ) {
        throw new Error('ARGUMENTS_INVALID');
      }
    } else {
      if (Object.hasOwn(envelope.message, 'tool_calls')) {
        throw new Error('TOOLS_FORBIDDEN');
      }
      const decision = JSON.parse(envelope.message.content);
      result.action =
        decision.action === 'LOOKUP' || decision.action === 'NO_LOOKUP' ? decision.action : null;
      result.incidentId = typeof decision.incidentId === 'string' ? decision.incidentId : null;
      if (
        !new Ajv({ coerceTypes: false, removeAdditional: false }).compile(record.request.format)(
          decision,
        )
      ) {
        throw new Error('FINAL_SCHEMA_INVALID');
      }
    }
    if (
      result.action === 'LOOKUP' &&
      /^INC-[1-9][0-9]{0,5}$/.exec(result.incidentId ?? '')?.[0] !== result.incidentId
    ) {
      throw new Error('ARGUMENTS_INVALID');
    }
    if (
      record.hybrid &&
      result.action === 'LOOKUP' &&
      !record.candidates.includes(result.incidentId)
    ) {
      throw new Error('ID_NOT_ALLOWED');
    }
    return { ...result, valid: true };
  } catch (error) {
    const allowed = [
      'ENVELOPE_INVALID',
      'CONTENT_INVALID',
      'NATIVE_CALLS_INVALID',
      'ARGUMENTS_INVALID',
      'TOOLS_FORBIDDEN',
      'FINAL_SCHEMA_INVALID',
      'ID_NOT_ALLOWED',
    ];
    return {
      ...result,
      blocked: true,
      structuralError: allowed.includes(error.message) ? error.message : 'JSON_INVALID',
    };
  }
}

function blockRecords(directory) {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const folder = join(directory, entry.name);
      return readdirSync(folder)
        .filter((name) => /^\d{2}-.*\.json$/.test(name))
        .map((name) => JSON.parse(readFileSync(join(folder, name), 'utf8')));
    });
}

function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error('Unknown batch fields');
  }
}

export function loadPlan(path = defaultBatch) {
  const batch = JSON.parse(readFileSync(path, 'utf8'));
  keys(batch, [
    'synthetic',
    'maxCalls',
    'timeoutMs',
    'cases',
    'variants',
    'model',
    'digest',
    'block',
    'mechanism',
    'hybrid',
  ]);
  const selectedModel = batch.model ?? model;
  const selectedDigest = batch.digest ?? digest;
  if (
    !['llama3.1:8b', 'gemma3:12b', 'qwen3:8b', 'qwen3:14b'].includes(selectedModel) ||
    !/^[a-f0-9]{64}$/.test(selectedDigest) ||
    (batch.block !== undefined && batch.block !== 'model-selection-2026-11-19') ||
    (batch.mechanism !== undefined && !['native', 'structured'].includes(batch.mechanism)) ||
    (batch.hybrid !== undefined && typeof batch.hybrid !== 'boolean')
  ) {
    throw new Error('Invalid exploratory model or block');
  }
  if (
    batch.synthetic !== true ||
    !Number.isInteger(batch.maxCalls) ||
    batch.maxCalls < 1 ||
    batch.maxCalls > maximumCalls ||
    !Number.isInteger(batch.timeoutMs) ||
    batch.timeoutMs < 1 ||
    batch.timeoutMs > 45000 ||
    !Array.isArray(batch.cases) ||
    !batch.cases.length ||
    !Array.isArray(batch.variants) ||
    !batch.variants.length
  ) {
    throw new Error('Synthetic batch must fit the explicit call and timeout limits');
  }
  const datasetBytes = readFileSync(join(root, 'evals/datasets/incidents-tool-calling-v1.json'));
  const datasetHash = hash(datasetBytes);
  if (datasetHash !== 'fa5b19d7783417220d2b852eabe9260352ba808a4307676f6a20fa86a4562490') {
    throw new Error('Frozen dataset changed');
  }
  const dataset = JSON.parse(datasetBytes);
  const calls = [];
  for (const item of batch.cases) {
    keys(item, ['id', 'description']);
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,60}$/.test(item.id)) {
      throw new Error('Invalid case ID');
    }
    const description =
      item.description ?? dataset.examples.find((example) => example.id === item.id)?.description;
    if (typeof description !== 'string' || !description.trim()) {
      throw new Error('A synthetic description or existing dataset ID is required');
    }
    for (const variant of batch.variants) {
      keys(variant, ['name', 'system', 'tools', 'format', 'options', 'think']);
      if (
        typeof variant.name !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,60}$/.test(variant.name) ||
        typeof variant.system !== 'string' ||
        !variant.system.trim() ||
        (variant.tools !== undefined && !Array.isArray(variant.tools)) ||
        (variant.format !== undefined && variant.format !== 'json' && !object(variant.format)) ||
        (variant.options !== undefined && !object(variant.options)) ||
        (variant.think !== undefined && typeof variant.think !== 'boolean')
      ) {
        throw new Error('Invalid exploration variant');
      }
      const detectionStart = performance.now();
      const candidates = identifiers(description);
      const detectionMs = performance.now() - detectionStart;
      const tools = variant.tools === undefined ? undefined : structuredClone(variant.tools);
      const format = variant.format === undefined ? undefined : structuredClone(variant.format);
      if (batch.hybrid && candidates.length) {
        if (batch.mechanism === 'native') {
          tools[0].function.parameters.properties.incidentId.enum = candidates;
        } else {
          format.oneOf[1].properties.incidentId.enum = candidates;
        }
      }
      calls.push({
        caseId: item.id,
        variant: variant.name,
        ...(batch.mechanism
          ? { mechanism: batch.mechanism, candidates, hybrid: batch.hybrid === true }
          : {}),
        ...(batch.hybrid ? { detectionMs } : {}),
        ...(batch.hybrid && !candidates.length ? { codeDecision: { action: 'NO_LOOKUP' } } : {}),
        body: {
          model: selectedModel,
          stream: false,
          messages: [
            { role: 'system', content: variant.system },
            { role: 'user', content: description },
          ],
          options: variant.options ?? { temperature: 0 },
          ...(tools !== undefined ? { tools } : {}),
          ...(format !== undefined ? { format } : {}),
          ...(variant.think !== undefined ? { think: variant.think } : {}),
        },
      });
    }
  }
  if (calls.filter((call) => !call.codeDecision).length > batch.maxCalls) {
    throw new Error('Planned inferences exceed explicit call limit');
  }
  return {
    scope: 'EXPLORATORY_ONLY',
    model: selectedModel,
    digest: selectedDigest,
    ...(batch.block ? { block: batch.block } : {}),
    datasetHash,
    maxCalls: batch.maxCalls,
    timeoutMs: batch.timeoutMs,
    calls,
  };
}

async function executeBatch(plan, request, directoryRoot) {
  if (
    !plan.calls.length ||
    plan.calls.filter((call) => !call.codeDecision).length > plan.maxCalls ||
    plan.maxCalls > maximumCalls
  ) {
    throw new Error('Call limit exceeded');
  }
  const metadata = async (path, body) => {
    const response = await request(`${baseUrl}${path}`, {
      signal: AbortSignal.timeout(5000),
      ...(body
        ? {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {}),
    });
    if (!response.ok) {
      throw new Error('Ollama metadata unavailable');
    }
    return response.json();
  };
  const tags = await metadata('/api/tags');
  if (
    !Array.isArray(tags.models) ||
    !tags.models.some((item) => item.name === plan.model && item.digest === plan.digest)
  ) {
    throw new Error('Required model digest unavailable; no inference sent');
  }
  const version = await metadata('/api/version');
  const modelMetadata = plan.block ? await metadata('/api/show', { model: plan.model }) : null;
  const runId = randomUUID();
  const directory = join(directoryRoot, runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(directory, 'batch.json'),
    JSON.stringify(
      {
        ...plan,
        runId,
        ollamaVersion: version.version,
        ...(modelMetadata
          ? { modelMetadata, installedModel: tags.models.find((item) => item.name === plan.model) }
          : {}),
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  const results = [];
  let sent = 0;
  for (const [index, call] of plan.calls.entries()) {
    if (!call.codeDecision && (sent >= plan.maxCalls || sent >= maximumCalls)) {
      throw new Error('Call limit reached');
    }
    if (plan.block) {
      const previous = blockRecords(directoryRoot);
      if (
        previous.some(
          (record) =>
            record.caseId === call.caseId &&
            record.variant === call.variant &&
            record.request.model === plan.model,
        ) ||
        (!call.codeDecision &&
          previous.filter((record) => record.state !== 'CODE_NO_LOOKUP').length >= 50)
      ) {
        throw new Error('Block budget or duplicate experiment blocked');
      }
    }
    const path = join(
      directory,
      `${String(index + 1).padStart(2, '0')}-${call.caseId}-${call.variant}.json`,
    );
    const record = {
      caseId: call.caseId,
      variant: call.variant,
      request: call.body,
      ...(call.mechanism
        ? { mechanism: call.mechanism, candidates: call.candidates, hybrid: call.hybrid }
        : {}),
      state: 'STARTED',
      httpStatus: null,
      responseBody: null,
      error: null,
    };
    await writeFile(path, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    if (call.codeDecision) {
      record.state = 'CODE_NO_LOOKUP';
      record.decision = {
        source: 'CODE',
        action: 'NO_LOOKUP',
        incidentId: null,
        valid: true,
        blocked: false,
        structuralError: null,
      };
      record.latencyMs = call.detectionMs;
      await writeFile(path, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
      results.push({
        caseId: call.caseId,
        variant: call.variant,
        state: record.state,
        latencyMs: call.detectionMs,
        file: path,
      });
      continue;
    }
    sent++;
    const signal = AbortSignal.timeout(plan.timeoutMs);
    const start = performance.now();
    try {
      const response = await request(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(call.body),
        signal,
        redirect: 'manual',
      });
      record.httpStatus = response.status;
      record.responseBody = await response.text();
      record.state = response.ok ? 'RECEIVED' : 'HTTP_ERROR';
    } catch {
      record.state = signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR';
      record.error = record.state;
    }
    record.latencyMs = Math.max(0, performance.now() - start);
    if (plan.block) {
      record.decision = decodeDecision(record);
      if (call.hybrid) {
        record.detectionMs = call.detectionMs;
        record.pipelineLatencyMs = record.latencyMs + call.detectionMs;
      }
      try {
        record.residency = await metadata('/api/ps');
        record.rss = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,comm='], {
          encoding: 'utf8',
          timeout: 2000,
        })
          .split('\n')
          .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/))
          .filter((match) => match && /ollama/i.test(match[4]))
          .map((match) => ({
            pid: Number(match[1]),
            ppid: Number(match[2]),
            rssKiB: Number(match[3]),
            executable: match[4],
          }));
      } catch {
        record.resourceObservationUnavailable = true;
      }
    }
    await writeFile(path, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
    results.push({
      caseId: call.caseId,
      variant: call.variant,
      state: record.state,
      latencyMs: record.latencyMs,
      file: path,
    });
    if (
      record.state === 'TIMEOUT' ||
      record.state === 'NETWORK_ERROR' ||
      (!plan.block && record.state !== 'RECEIVED')
    ) {
      break;
    }
  }
  const summary = {
    scope: 'EXPLORATORY_ONLY',
    runId,
    directory,
    planned: plan.calls.length,
    attempted: sent,
    status:
      results.length === plan.calls.length &&
      results.every((result) => ['RECEIVED', 'CODE_NO_LOOKUP'].includes(result.state))
        ? 'RECEIVED_ALL'
        : 'STOPPED',
    results,
    finishedAt: new Date().toISOString(),
  };
  await writeFile(join(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  return summary;
}

export async function execute(plan, request = fetch, directoryRoot = outputRoot) {
  if (!plan.block) {
    return executeBatch(plan, request, directoryRoot);
  }
  const directory = join(directoryRoot, plan.block);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, '.active');
  const handle = await open(lock, 'wx', 0o600);
  try {
    const previous = blockRecords(directory);
    if (previous.some((record) => ['STARTED', 'TIMEOUT', 'NETWORK_ERROR'].includes(record.state))) {
      throw new Error('Uncertain prior inference blocks further calls');
    }
    return await executeBatch(plan, request, directory);
  } finally {
    await handle.close();
    await unlink(lock);
  }
}

export async function main(args = process.argv.slice(2)) {
  const action = args[0] ?? '--preview';
  if (args.length > 2 || !['--preview', '--run'].includes(action)) {
    throw new Error('Use --preview or --run, optionally followed by a batch JSON path');
  }
  const plan = loadPlan(args[1] ? resolve(args[1]) : defaultBatch);
  const result = action === '--preview' ? plan : await execute(plan);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'STOPPED') {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    console.error('Exploration stopped; inspect local files. No automatic retry or resume.');
    process.exitCode = 1;
  });
}
