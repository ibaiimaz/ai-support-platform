import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createObserver } from '../../src/evaluation/model-comparison/observer.js';
import { sha256 } from '../../src/evaluation/dataset.js';
import { models } from '../../src/evaluation/model-comparison/protocol.js';
import { project } from './helpers.js';

// Every OS command and HTTP request is injected; this suite cannot reach Ollama.
test('I004-AC-02 I004-AC-04 I004-AC-08 observador real con transportes simulados, sin chat ni generación', async (t) => {
  const f = await project(t);
  const paths: string[] = [];
  const commands: string[][] = [];
  let loaded = true;
  const observer = createObserver(f.manifest, {
    host: () => f.snapshot(models[0]).host,
    command: async (file, args) => {
      commands.push([file, ...args]);
      if (file === 'lsof') {
        return { stdout: '10\n10\n' };
      }
      if (file === 'ps') {
        assert.deepEqual(args, ['-p', '10', '-o', 'comm=']);
        return { stdout: '/Applications/Ollama.app/Contents/Resources/ollama\n' };
      }
      assert.equal(file, 'ollama');
      assert.deepEqual(args, ['stop', models[0]]);
      loaded = false;
      return { stdout: '' };
    },
    memory: async (pid) => {
      assert.equal(pid, 10);
      return [{ pid: 10, ppid: 1, rssKiB: 500 }];
    },
    request: async (input, options) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      assert.ok(!['/api/chat', '/api/generate', '/api/pull'].includes(path));
      if (path === '/api/tags') {
        return Response.json({
          models: [{ name: models[0], digest: sha256(models[0]), size: 1000 }],
        });
      }
      if (path === '/api/version') {
        return Response.json({ version: 'fixture-version' });
      }
      if (path === '/api/show') {
        assert.deepEqual(JSON.parse(String(options?.body)), { model: models[0] });
        return Response.json({
          template: `template ${models[0]}`,
          parameters: `parameters ${models[0]}`,
          details: { quantization_level: 'Q4_K_M' },
          model_info: { 'llama.context_length': 4096 },
        });
      }
      assert.equal(path, '/api/ps');
      return Response.json({
        models: loaded
          ? [
              {
                name: models[0],
                digest: sha256(models[0]),
                size: 2000,
                size_vram: 1000,
                context_length: 4096,
              },
            ]
          : [],
      });
    },
  });
  assert.deepEqual((await observer.snapshot(models[0])).identity, f.manifest.models[models[0]]);
  const before = await observer.residency();
  assert.equal(before.models[0]!.sizeVram, 1000);
  assert.equal((await observer.prepare()).models.length, 0);
  assert.equal((await observer.readMemory())[0]!.rssKiB, 500);
  assert.equal(await observer.confirmIdleAfterTimeout(), false);
  assert.equal(commands.filter((c) => c[0] === 'ollama').length, 1);
  assert.ok(paths.includes('/api/show'));
});

test('I004-AC-04 preflight no expulsa modelos ajenos y rechaza PID equivocado', async (t) => {
  const f = await project(t);
  let stops = 0;
  const io = {
    command: async (file: string) => {
      if (file === 'lsof') {
        return { stdout: '10' };
      }
      if (file === 'ps') {
        return { stdout: 'ollama' };
      }
      stops++;
      return { stdout: '' };
    },
    request: async () =>
      Response.json({
        models: [{ name: 'unrelated-model', digest: 'a'.repeat(64), size: 1000, size_vram: 1000 }],
      }),
  };
  await assert.rejects(createObserver(f.manifest, io).prepare());
  assert.equal(stops, 0);
  io.command = async () => ({ stdout: '9999' });
  await assert.rejects(createObserver(f.manifest, io).prepare());
  assert.equal(stops, 0);
});
