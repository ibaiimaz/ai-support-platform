import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';

const executeFile = promisify(execFile);

export interface MemorySample {
  elapsedMs: number;
  processes: { pid: number; ppid: number; rssKiB: number }[];
  complete: boolean;
  reason: 'unavailable' | 'unattributed' | null;
}

export function parseProcessMemory(text: string, serverPid: number): MemorySample['processes'] {
  const rows = text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
      if (!match) {
        throw new Error('Muestra de procesos inválida.');
      }
      return { pid: Number(match[1]), ppid: Number(match[2]), rssKiB: Number(match[3]) };
    });
  if (
    !rows.some((row) => row.pid === serverPid) ||
    new Set(rows.map((r) => r.pid)).size !== rows.length
  ) {
    throw new Error('Servidor no atribuible.');
  }
  const ids = new Set([serverPid]);
  let priorSize = 0;
  while (priorSize !== ids.size) {
    priorSize = ids.size;
    for (const row of rows) {
      if (ids.has(row.ppid)) {
        ids.add(row.pid);
      }
    }
  }
  return rows.filter((row) => ids.has(row.pid));
}

export async function readProcessMemory(serverPid: number): Promise<MemorySample['processes']> {
  const { stdout } = await executeFile('ps', ['-axo', 'pid=,ppid=,rss='], {
    timeout: 2000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return parseProcessMemory(stdout, serverPid);
}

export function summarizeMemory(samples: readonly MemorySample[], durationMs: number) {
  const complete = samples.filter((sample) => sample.complete && sample.processes.length > 0);
  const observed = complete.map((sample) => ({
    elapsedMs: sample.elapsedMs,
    rssBytes: sample.processes.reduce((sum, p) => sum + p.rssKiB * 1024, 0),
  }));
  const gaps = samples.slice(1).map((sample, index) => ({
    fromMs: samples[index]!.elapsedMs,
    toMs: sample.elapsedMs,
    durationMs: sample.elapsedMs - samples[index]!.elapsedMs,
  }));
  const reliable =
    samples.length >= 2 &&
    samples.every((sample) => sample.complete && sample.processes.length > 0);
  return {
    method: 'server_and_descendants_rss_pid_ppid',
    targetIntervalMs: 500,
    durationMs,
    sampleCount: samples.length,
    completeSampleCount: complete.length,
    maxGapMs: gaps.length ? Math.max(...gaps.map((gap) => gap.durationMs)) : null,
    unobservedIntervals: gaps.filter((gap) => gap.durationMs > 500),
    reliable,
    reason: reliable ? null : 'missing_or_unattributed_samples',
    observedMaxRssBytes: observed.length
      ? Math.max(...observed.map((sample) => sample.rssBytes))
      : null,
    comparableMaxRssBytes: reliable ? Math.max(...observed.map((sample) => sample.rssBytes)) : null,
    initialRssBytes: observed[0]?.rssBytes ?? null,
    truePeakBytes: null,
    limitation:
      'Sampled RSS may double-count shared pages and does not isolate GPU/unified memory or capture every peak.',
  };
}

export function startMemorySampler(read: () => Promise<MemorySample['processes']>) {
  const start = performance.now();
  const samples: MemorySample[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let pending: Promise<void> = Promise.resolve();
  const sample = async () => {
    const elapsedMs = performance.now() - start;
    try {
      const processes = await read();
      samples.push({
        elapsedMs,
        processes,
        complete: processes.length > 0,
        reason: processes.length ? null : 'unattributed',
      });
    } catch {
      samples.push({ elapsedMs, processes: [], complete: false, reason: 'unavailable' });
    }
  };
  const schedule = () => {
    timer = setTimeout(() => {
      pending = sample().then(() => {
        if (!stopped) {
          schedule();
        }
      });
    }, 500);
  };
  pending = sample().then(() => {
    if (!stopped) {
      schedule();
    }
  });
  return {
    ready: pending,
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await pending;
      await sample();
      return { samples, summary: summarizeMemory(samples, performance.now() - start) };
    },
  };
}
