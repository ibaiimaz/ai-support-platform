import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '../../src/evaluation/dataset.js';

// Immutable Git provenance, never HEAD and never regenerated from the working tree.
export const historicalCommit = '42771e8ffe6898611a7187a27839c2aea38d3119';
const historicalTree = '4db5ef10c7ac7deeb6d5c5e9c94f9fb00462839c';
const freezeHash = '148748e9c34b856411257a0c7de75f54a966c2c60d8b51aafd3700ad3d326132';

export async function withHistoricalR7<T>(operation: (root: string) => Promise<T>): Promise<T> {
  const project = process.cwd();
  assert.equal(
    execFileSync('git', ['rev-parse', `${historicalCommit}^{tree}`], { encoding: 'utf8' }).trim(),
    historicalTree,
  );
  const root = await mkdtemp(join(tmpdir(), 'i007-historical-r7-'));
  try {
    const archive = execFileSync(
      'git',
      [
        'archive',
        historicalCommit,
        'src',
        'package.json',
        'package-lock.json',
        'tsconfig.json',
        'evals/datasets',
        'evals/experiments',
      ],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    execFileSync('tar', ['-xf', '-', '-C', root], { input: archive });
    const bytes = await readFile(join(root, 'evals/experiments/i006-r7-system-freeze.json'));
    assert.equal(sha256(bytes), freezeHash);
    const freeze = JSON.parse(bytes.toString('utf8')) as { files: Record<string, string> };
    assert.equal(Object.keys(freeze.files).length, 38);
    for (const [path, expected] of Object.entries(freeze.files)) {
      assert.equal(sha256(await readFile(join(root, path))), expected, path);
    }
    // Historical production dependencies/compiler keep their pinned versions. Only resolve them
    // from the installed tree: no install, Git checkout, inference or operational initialization.
    const originalLock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
    const currentLock = JSON.parse(await readFile(join(project, 'package-lock.json'), 'utf8'));
    for (const [name, entry] of Object.entries(originalLock.packages) as [
      string,
      Record<string, unknown>,
    ][]) {
      if (name) {
        assert.equal(currentLock.packages[name]?.version, entry.version, name);
        assert.equal(currentLock.packages[name]?.integrity, entry.integrity, name);
        const installed = JSON.parse(await readFile(join(project, name, 'package.json'), 'utf8'));
        assert.equal(installed.version, entry.version, name);
      }
    }
    await symlink(join(project, 'node_modules'), join(root, 'node_modules'), 'dir');
    execFileSync(
      process.execPath,
      [join(project, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'tsconfig.json')],
      { cwd: root, timeout: 30000 },
    );
    return await operation(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
