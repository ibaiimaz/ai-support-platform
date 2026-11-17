import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sha256 } from '../../src/evaluation/dataset.js';
import { buildReport, saveReport } from '../../src/evaluation/tool-calling/report.js';
import { candidate, identity, perfectResults } from './helpers.js';

test('AC-26: private report is hash-verifiable, no overwrite, no descriptions, fixtures or raw output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'i006-report-'));
  try {
    const dataset = await candidate();
    const report = buildReport(
      dataset,
      identity,
      perfectResults(dataset),
      new Date().toISOString(),
    );
    const path = await saveReport(directory, report);
    const bytes = await readFile(path);
    assert.equal((await readFile(`${path}.sha256`, 'utf8')).trim(), sha256(bytes));
    assert.equal(JSON.parse(bytes.toString()).results.length, 60);
    assert.deepEqual(JSON.parse(bytes.toString()).diagnostics, report.diagnostics);
    assert.equal(bytes.includes(dataset.examples[0]!.description), false);
    assert.equal(bytes.includes('rationale'), false);
    assert.equal(bytes.includes('arguments'), false);
    assert.equal(bytes.includes('toolCallingInstructions'), false);
    await assert.rejects(
      saveReport(directory, report),
      (error: NodeJS.ErrnoException) => error.code === 'EEXIST',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('AC-26: unsafe result fields, raw errors and contradictory outcomes cannot enter reports', async () => {
  const dataset = await candidate();
  for (const mutate of [
    (results: any) => {
      results[0].raw = 'sensitive';
    },
    (results: any) => {
      results[0].error = 'private error';
    },
    (results: any) => {
      results[0].observation.rawArguments = {};
    },
    (results: any) => {
      results[0].outcome = 'TECHNICAL_ERROR';
    },
    (results: any) => {
      results[0].observation.requestedIds = ['secret\n'];
    },
  ]) {
    const results = perfectResults(dataset);
    mutate(results);
    assert.throws(() => buildReport(dataset, identity, results, new Date().toISOString()));
  }
});
