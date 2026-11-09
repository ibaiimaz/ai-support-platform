import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cpus, totalmem, platform, arch, release } from 'node:os';
import { basename } from 'node:path';
import { sha256 } from '../dataset.js';
import type { Manifest, Model, ModelIdentity } from './protocol.js';
import { models } from './protocol.js';
import { readProcessMemory, type MemorySample } from './memory.js';

const executeFile = promisify(execFile);

export interface Snapshot {
  identity: ModelIdentity;
  ollamaVersion: string;
  host: {
    platform: string;
    arch: string;
    release: string;
    cpu: string;
    cpuCount: number;
    totalMemoryBytes: number;
    nodeVersion: string;
  };
  hostSha256: string;
}

export interface Residency {
  recordedAt: string;
  models: {
    model: string;
    digest: string;
    size: number;
    sizeVram: number;
    contextLength: number | null;
  }[];
}

export interface Observer {
  snapshot(model: Model): Promise<Snapshot>;
  prepare(): Promise<Residency>;
  residency(): Promise<Residency>;
  readMemory(): Promise<MemorySample['processes']>;
  confirmIdleAfterTimeout(): Promise<boolean>;
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const hash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function localHost() {
  return {
    platform: platform(),
    arch: arch(),
    release: release(),
    cpu: cpus()[0]?.model ?? 'unknown',
    cpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    nodeVersion: process.version,
  };
}

export interface ObserverIO {
  request?: typeof fetch;
  command?: (
    file: string,
    args: readonly string[],
    options: { timeout: number; env?: NodeJS.ProcessEnv },
  ) => Promise<{ stdout: string }>;
  host?: () => Snapshot['host'];
  memory?: typeof readProcessMemory;
}

export function createObserver(manifest: Manifest, io: ObserverIO = {}): Observer {
  const request = io.request ?? fetch;
  const command = io.command ?? executeFile;
  const origin = manifest.protocol.providerOrigin;
  const serverPid = manifest.environment.serverPid!;
  const get = async (path: string, body?: object): Promise<Record<string, unknown>> => {
    const response = await request(new URL(path, origin), {
      ...(body
        ? {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {}),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw new Error('Metadatos de Ollama no disponibles.');
    }
    const data: unknown = await response.json();
    if (!object(data)) {
      throw new Error('Metadatos de Ollama inválidos.');
    }
    return data;
  };
  const residency = async (): Promise<Residency> => {
    const data = await get('/api/ps');
    if (!Array.isArray(data.models)) {
      throw new Error('Residencia no verificable.');
    }
    return {
      recordedAt: new Date().toISOString(),
      models: data.models.map((item: unknown) => {
        if (
          !object(item) ||
          typeof item.name !== 'string' ||
          !hash(item.digest) ||
          !finite(item.size) ||
          !finite(item.size_vram)
        ) {
          throw new Error('Residencia inválida.');
        }
        return {
          model: item.name,
          digest: item.digest,
          size: item.size,
          sizeVram: item.size_vram,
          contextLength: finite(item.context_length) ? item.context_length : null,
        };
      }),
    };
  };
  const identifyServer = async () => {
    const port = new URL(origin).port || '80';
    const { stdout } = await command('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      timeout: 2000,
    });
    const pids = new Set(stdout.trim().split(/\s+/).map(Number));
    if (pids.size !== 1 || !pids.has(serverPid)) {
      throw new Error('Servidor dedicado no identificado.');
    }
    const result = await command('ps', ['-p', String(serverPid), '-o', 'comm='], {
      timeout: 2000,
    });
    if (basename(result.stdout.trim()).toLowerCase() !== 'ollama') {
      throw new Error('PID no corresponde a Ollama.');
    }
  };
  return {
    async snapshot(model) {
      await identifyServer();
      const tags = await get('/api/tags');
      const version = await get('/api/version');
      const show = await get('/api/show', { model });
      if (
        !Array.isArray(tags.models) ||
        typeof version.version !== 'string' ||
        typeof show.template !== 'string' ||
        typeof show.parameters !== 'string' ||
        !object(show.details) ||
        !object(show.model_info)
      ) {
        throw new Error('Identidad del modelo no verificable.');
      }
      const installed = tags.models.find((item: unknown) => object(item) && item.name === model) as
        Record<string, unknown> | undefined;
      const contexts = Object.entries(show.model_info)
        .filter(([key]) => key.endsWith('.context_length'))
        .map(([, value]) => value);
      if (
        !installed ||
        !hash(installed.digest) ||
        !finite(installed.size) ||
        installed.size === 0 ||
        typeof show.details.quantization_level !== 'string' ||
        contexts.length !== 1 ||
        !finite(contexts[0]) ||
        contexts[0] === 0
      ) {
        throw new Error('Modelo no instalado o metadatos incompletos.');
      }
      const host = (io.host ?? localHost)();
      return {
        identity: {
          digest: installed.digest,
          templateSha256: sha256(show.template),
          parametersSha256: sha256(show.parameters),
          parameters: show.parameters,
          quantization: show.details.quantization_level,
          modelContextLength: contexts[0],
          storedBytes: installed.size,
        },
        ollamaVersion: version.version,
        host,
        hostSha256: sha256(JSON.stringify(host)),
      };
    },
    async prepare() {
      await identifyServer();
      const before = await residency();
      if (before.models.some((item) => !models.includes(item.model as Model))) {
        throw new Error('Otro modelo residente; no se expulsan trabajos ajenos.');
      }
      for (const item of before.models) {
        await command('ollama', ['stop', item.model], {
          timeout: 10000,
          env: { ...process.env, OLLAMA_HOST: origin },
        });
      }
      const after = await residency();
      if (after.models.length !== 0) {
        throw new Error('No se pudo preparar residencia vacía.');
      }
      return after;
    },
    residency,
    async readMemory() {
      await identifyServer();
      return (io.memory ?? readProcessMemory)(serverPid);
    },
    async confirmIdleAfterTimeout() {
      // /api/ps reports residence, not whether an aborted request is still computing.
      // Without a reliable acknowledgement, stop instead of starting overlapping work.
      return false;
    },
  };
}
