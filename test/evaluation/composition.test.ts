import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { classificationInstructions } from '../../src/infrastructure/ollama/classification-instructions.js';
import { ollamaInference } from '../../src/infrastructure/ollama/inference-descriptor.js';
import { validateReport } from '../../src/evaluation/report.js';
import { fixtureDataset, temporaryProject } from './helpers.js';

const execFileAsync = promisify(execFile);

test('I002-AC-12 regresión del descriptor y prompt exactos de I001', () => {
  assert.deepEqual(ollamaInference, {
    endpoint: '/api/chat',
    stream: false,
    options: { temperature: 0 },
    format: {
      type: 'object',
      required: ['category'],
      additionalProperties: false,
      properties: { category: { type: 'string', enum: ['BUG', 'FEATURE', 'QUESTION'] } },
    },
  });
  assert.equal(
    createHash('sha256').update(classificationInstructions).digest('hex'),
    'ea81fca7322e307986b0ab3739fc9d73ad2384cc2361da8a0b28cfedf659a9ef',
  );
  assert.throws(() => {
    (ollamaInference.options as { temperature: number }).temperature = 1;
  }, TypeError);
  assert.throws(() => {
    (ollamaInference.format.properties.category.enum as unknown as string[]).push('OTHER');
  }, TypeError);
});

test('I002-AC-03 I002-AC-08 I002-AC-09 I002-AC-11 I002-AC-12 CLI real con Ollama simulado', async (t) => {
  const root = await temporaryProject(t);
  const requests: { url: string | undefined; method: string | undefined; body: unknown }[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push({ url: request.url, method: request.method, body: JSON.parse(body) });
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          done: true,
          done_reason: 'stop',
          message: { role: 'assistant', content: '{"category":"BUG"}' },
        }),
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [resolve('dist/src/evaluation/main.js')],
    {
      cwd: root,
      env: {
        ...process.env,
        OLLAMA_BASE_URL: `http://127.0.0.1:${address.port}`,
        OLLAMA_MODEL: 'fixture-model:custom',
        OLLAMA_TIMEOUT_MS: '2000',
      },
      timeout: 15000,
    },
  );
  const summary = JSON.parse(stdout);
  assert.equal(stderr, '');
  assert.equal(requests.length, 60);
  assert.equal(summary.complete, true);
  const report = JSON.parse(await readFile(join(root, summary.reportPath), 'utf8'));
  validateReport(report);
  assert.equal(report.model.name, 'fixture-model:custom');
  assert.equal(report.codeReference, null);
  assert.equal(report.execution.correctCount, 20);
  assert.equal(report.execution.incorrectCount, 40);
  assert.equal(report.metrics?.accuracy, 1 / 3);
  assert.equal(report.configuration.timeoutMs, 2000);

  for (const [index, request] of requests.entries()) {
    assert.deepEqual(request, {
      url: '/api/chat',
      method: 'POST',
      body: {
        model: 'fixture-model:custom',
        stream: false,
        format: ollamaInference.format,
        options: { temperature: 0 },
        messages: [
          { role: 'system', content: classificationInstructions },
          { role: 'user', content: fixtureDataset().examples[index]!.description.trim() },
        ],
      },
    });
  }

  for (const forbidden of ['DESCRIPTION_SECRET', 'REFERENCE_SECRET', classificationInstructions]) {
    assert.ok(!stdout.includes(forbidden));
    assert.ok(!JSON.stringify(report).includes(forbidden));
  }

  await assert.rejects(
    execFileAsync(process.execPath, [resolve('dist/src/evaluation/main.js')], {
      cwd: root,
      env: { ...process.env, OLLAMA_TIMEOUT_MS: '0' },
    }),
    (error: unknown) => {
      const failure = error as { code: number; stdout: string; stderr: string };
      assert.equal(failure.code, 1);
      assert.equal(failure.stdout, '');
      assert.ok(!failure.stderr.includes('DESCRIPTION_SECRET'));
      return true;
    },
  );
  assert.equal(requests.length, 60);
});

test('I002-AC-12 I002-AC-13 ejecución determinista separada de HTTP y evaluación real', async () => {
  const main = await readFile('src/evaluation/main.ts', 'utf8');
  const runner = await readFile('src/evaluation/run-evaluation.ts', 'utf8');
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  assert.ok(!main.includes('../http/'));
  assert.ok(!main.includes('../main.js'));
  assert.ok(runner.includes('classifyIncident('));
  assert.ok(!packageJson.scripts.test.includes('eval:classification'));
  assert.ok(!packageJson.scripts.verify.includes('eval:classification'));
});
