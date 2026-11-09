import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distribution } from '../../src/evaluation/model-comparison/statistics.js';
import { exploratorySignals } from '../../src/evaluation/model-comparison/compare.js';
import {
  parseProcessMemory,
  summarizeMemory,
  startMemorySampler,
} from '../../src/evaluation/model-comparison/memory.js';

test('I004-AC-07 latencias nearest-rank, par, vacías, errores y primer caso', () => {
  assert.deepEqual(distribution([]), { n: 0, meanMs: null, medianMs: null, p95Ms: null });
  assert.deepEqual(distribution([4]), { n: 1, meanMs: 4, medianMs: 4, p95Ms: 4 });
  assert.deepEqual(distribution([4, 1, 3, 2]), { n: 4, meanMs: 2.5, medianMs: 2.5, p95Ms: 4 });
  assert.equal(distribution(Array.from({ length: 60 }, (_, i) => i + 1)).p95Ms, 57);
  assert.throws(() => distribution([NaN]));
  assert.throws(() => distribution([-1]));
});

test('I004-AC-11 señales 4/5/6 netos y macro complementaria, ninguna puerta heredada', () => {
  for (const gain of [4, 5, 6]) {
    const signals = exploratorySignals(40, 40 + gain, 0.7, 0.6);
    assert.equal(signals.relevantExploratoryGain, gain >= 5);
    assert.equal(signals.complementaryMacroSignal, false);
    assert.equal(signals.complementaryIsRequired, false);
    assert.equal(signals.promotionAuthorized, false);
  }
  assert.equal(exploratorySignals(40, 40, 0.7, 0.729).complementaryMacroSignal, false);
  assert.equal(exploratorySignals(40, 40, 0.7, 0.73).complementaryMacroSignal, true);
  assert.equal(exploratorySignals(40, 40, 0.7, 0.731).complementaryMacroSignal, true);
  assert.equal(exploratorySignals(0, 0, null, null).complementaryMacroSignal, null);
});

test('I004-AC-08 PID/PPID, KiB, cobertura y límites de máximo observado', () => {
  const processes = parseProcessMemory(' 10 1 100\n11 10 200\n12 11 300\n20 1 900\n', 10);
  assert.deepEqual(
    processes.map((p) => p.pid),
    [10, 11, 12],
  );
  assert.throws(() => parseProcessMemory('20 1 900', 10));
  assert.throws(() => parseProcessMemory('10 secret 900', 10));
  const samples = [0, 2000].map((elapsedMs) => ({
    elapsedMs,
    processes,
    complete: true,
    reason: null,
  }));
  const summary = summarizeMemory(samples, 2000);
  assert.equal(summary.comparableMaxRssBytes, 600 * 1024);
  assert.equal(summary.maxGapMs, 2000);
  assert.equal(summary.unobservedIntervals.length, 1);
  assert.equal(summary.truePeakBytes, null);
  assert.equal(summary.reliable, true);
  const missing = summarizeMemory(
    [...samples, { elapsedMs: 2100, processes: [], complete: false, reason: 'unavailable' }],
    2100,
  );
  assert.equal(missing.reliable, false);
  assert.equal(missing.comparableMaxRssBytes, null);
  assert.equal(missing.observedMaxRssBytes, 600 * 1024);
  assert.equal(summarizeMemory([], 0).observedMaxRssBytes, null);
});

test('I004-AC-08 muestreador sin solapamiento con fallos y cierre inicial/final', async () => {
  let active = 0;
  let maximum = 0;
  let calls = 0;
  const sampler = startMemorySampler(async () => {
    calls++;
    active++;
    maximum = Math.max(maximum, active);
    await Promise.resolve();
    active--;
    throw new Error('Fallo simulado');
  });
  await sampler.ready;
  const memory = await sampler.stop();
  assert.equal(calls, 2);
  assert.equal(maximum, 1);
  assert.equal(memory.samples.length, 2);
  assert.equal(memory.summary.reliable, false);
  assert.equal(memory.summary.truePeakBytes, null);
});

test('I004-AC-08 cadencia de 500 ms no solapa una lectura lenta ni deja timers al cerrar', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  let active = 0;
  let maximum = 0;
  let release!: () => void;
  const sampler = startMemorySampler(async () => {
    calls++;
    active++;
    maximum = Math.max(maximum, active);
    if (calls === 2) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    active--;
    return [{ pid: 10, ppid: 1, rssKiB: 100 }];
  });
  await sampler.ready;
  t.mock.timers.tick(500);
  assert.equal(calls, 2);
  t.mock.timers.tick(2000);
  assert.equal(calls, 2);
  const closing = sampler.stop();
  release();
  const memory = await closing;
  assert.equal(calls, 3);
  assert.equal(maximum, 1);
  assert.equal(memory.samples.length, 3);
  t.mock.timers.tick(10000);
  assert.equal(calls, 3);
});
