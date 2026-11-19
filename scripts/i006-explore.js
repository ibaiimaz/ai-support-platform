import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
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

function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error('Unknown batch fields');
  }
}

export function loadPlan(path = defaultBatch) {
  const batch = JSON.parse(readFileSync(path, 'utf8'));
  keys(batch, ['synthetic', 'maxCalls', 'timeoutMs', 'cases', 'variants']);
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
    !batch.variants.length ||
    batch.cases.length * batch.variants.length > batch.maxCalls
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
      keys(variant, ['name', 'system', 'tools', 'format', 'options']);
      if (
        typeof variant.name !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,60}$/.test(variant.name) ||
        typeof variant.system !== 'string' ||
        !variant.system.trim() ||
        (variant.tools !== undefined && !Array.isArray(variant.tools)) ||
        (variant.format !== undefined && variant.format !== 'json' && !object(variant.format)) ||
        (variant.options !== undefined && !object(variant.options))
      ) {
        throw new Error('Invalid exploration variant');
      }
      calls.push({
        caseId: item.id,
        variant: variant.name,
        body: {
          model,
          stream: false,
          messages: [
            { role: 'system', content: variant.system },
            { role: 'user', content: description },
          ],
          options: variant.options ?? { temperature: 0 },
          ...(variant.tools !== undefined ? { tools: variant.tools } : {}),
          ...(variant.format !== undefined ? { format: variant.format } : {}),
        },
      });
    }
  }
  return {
    scope: 'EXPLORATORY_ONLY',
    model,
    digest,
    datasetHash,
    maxCalls: batch.maxCalls,
    timeoutMs: batch.timeoutMs,
    calls,
  };
}

export async function execute(plan, request = fetch, directoryRoot = outputRoot) {
  if (!plan.calls.length || plan.calls.length > plan.maxCalls || plan.maxCalls > maximumCalls) {
    throw new Error('Call limit exceeded');
  }
  const metadata = async (path) => {
    const response = await request(`${baseUrl}${path}`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      throw new Error('Ollama metadata unavailable');
    }
    return response.json();
  };
  const tags = await metadata('/api/tags');
  if (
    !Array.isArray(tags.models) ||
    !tags.models.some((item) => item.name === model && item.digest === digest)
  ) {
    throw new Error('Required model digest unavailable; no inference sent');
  }
  const version = await metadata('/api/version');
  const runId = randomUUID();
  const directory = join(directoryRoot, runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(directory, 'batch.json'),
    JSON.stringify(
      { ...plan, runId, ollamaVersion: version.version, startedAt: new Date().toISOString() },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  const results = [];
  for (const [index, call] of plan.calls.entries()) {
    if (index >= plan.maxCalls || index >= maximumCalls) {
      throw new Error('Call limit reached');
    }
    const path = join(
      directory,
      `${String(index + 1).padStart(2, '0')}-${call.caseId}-${call.variant}.json`,
    );
    const record = {
      caseId: call.caseId,
      variant: call.variant,
      request: call.body,
      state: 'STARTED',
      httpStatus: null,
      responseBody: null,
      error: null,
    };
    await writeFile(path, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
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
    await writeFile(path, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
    results.push({
      caseId: call.caseId,
      variant: call.variant,
      state: record.state,
      latencyMs: record.latencyMs,
      file: path,
    });
    if (record.state !== 'RECEIVED') {
      break;
    }
  }
  const summary = {
    scope: 'EXPLORATORY_ONLY',
    runId,
    directory,
    planned: plan.calls.length,
    attempted: results.length,
    status:
      results.length === plan.calls.length && results.every((result) => result.state === 'RECEIVED')
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
