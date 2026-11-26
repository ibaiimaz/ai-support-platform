import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  verifyKnowledgeCodeIdentity,
  assertKnowledgeCodeIdentity,
} from '../../../src/evaluation/knowledge/code-identity.js';
import { evaluateCase } from '../../../src/evaluation/knowledge/evaluation.js';
import { dependencies } from '../../knowledge/helpers.js';
import { hash } from '../../../src/knowledge/markdown.js';

const execute = promisify(execFile);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'i007-build-'));
  try {
    for (const path of ['scripts', 'src/evaluation/knowledge', 'test/evaluation/knowledge']) {
      await mkdir(join(root, path), { recursive: true });
    }
    await symlink(resolve('node_modules'), join(root, 'node_modules'), 'junction');
    await writeFile(join(root, 'scripts/build.js'), await readFile('scripts/build.js'));
    await writeFile(join(root, 'package-lock.json'), await readFile('package-lock.json'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    await writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2022',
          strict: true,
          skipLibCheck: true,
          rootDir: '.',
          outDir: 'dist',
        },
        include: ['src/**/*.ts', 'test/**/*.ts'],
      }),
    );
    await writeFile(
      join(root, 'src/evaluation/knowledge/main.ts'),
      "import { value } from '../durable-files.js';\nexport const result = value;\n",
    );
    await writeFile(join(root, 'src/evaluation/durable-files.ts'), 'export const value = 1;\n');
    return root;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function build(root: string) {
  await execute(process.execPath, [join(root, 'scripts/build.js')], { cwd: root });
}

test('RT-001 R1 build portable elimina salidas antiguas y descubre tests trasladados una vez', async () => {
  const root = await fixture();
  try {
    for (const directory of ['dist/src/knowledge', 'dist/test/knowledge']) {
      await mkdir(join(root, directory), { recursive: true });
    }
    const stale = [
      'dist/src/knowledge/evaluation.js',
      'dist/src/knowledge/evaluation-main.js',
      'dist/test/knowledge/evaluation.test.js',
    ];
    for (const path of stale) {
      await writeFile(join(root, path), "throw new Error('Obsolete artifact');\n");
    }
    await writeFile(join(root, 'keep.txt'), 'outside generated directory');
    await writeFile(
      join(root, 'test/evaluation/knowledge.test.ts'),
      "import './knowledge/evaluation.test.js';\n",
    );
    await writeFile(
      join(root, 'test/evaluation/knowledge/evaluation.test.ts'),
      "import test from 'node:test';\ntest('moved-test-once', () => {});\n",
    );
    await build(root);
    for (const path of stale) {
      await assert.rejects(access(join(root, path)), { code: 'ENOENT' });
    }
    assert.equal(await readFile(join(root, 'keep.txt'), 'utf8'), 'outside generated directory');
    await access(join(root, 'src/evaluation/knowledge/main.ts'));
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = await execute(
      process.execPath,
      ['--test', '--test-reporter=tap', 'dist/test/evaluation/knowledge.test.js'],
      { cwd: root, env },
    );
    assert.equal((run.stdout.match(/# Subtest: moved-test-once/g) ?? []).length, 1);
    assert.match(run.stdout, /# tests 1\b/);
    const pkg = JSON.parse(await readFile('package.json', 'utf8'));
    assert.equal(pkg.scripts.build, 'node scripts/build.js');
    assert.equal(pkg.scripts.test, 'npm run build && node --test dist/test/**/*.test.js');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('RT-001 R2 identidad distingue fuentes/build, persistencia, lockfile y build obsoleto', async () => {
  const root = await fixture();
  try {
    await build(root);
    const first = await verifyKnowledgeCodeIdentity(root);
    assert.equal(first.correspondence, 'VERIFIED');
    assert.ok(first.sources.some((item) => item.path === 'src/evaluation/durable-files.ts'));
    assert.ok(first.artifacts.some((item) => item.path === 'dist/src/evaluation/durable-files.js'));
    const persistence = join(root, 'src/evaluation/durable-files.ts');
    await writeFile(persistence, 'export const value = 2;\n');
    await assert.rejects(verifyKnowledgeCodeIdentity(root), /Compiled artifact differs/);
    await assert.rejects(assertKnowledgeCodeIdentity(first, root), /changed after verification/);
    await build(root);
    const second = await verifyKnowledgeCodeIdentity(root);
    assert.notEqual(first.sourceHash, second.sourceHash);
    assert.notEqual(first.buildHash, second.buildHash);
    const artifact = join(root, 'dist/src/evaluation/knowledge/main.js');
    const bytes = await readFile(artifact);
    await writeFile(artifact, bytes.toString() + '\n// substituted build\n');
    await assert.rejects(verifyKnowledgeCodeIdentity(root), /Compiled artifact differs/);
    await assert.rejects(assertKnowledgeCodeIdentity(second, root), /changed after verification/);
    await writeFile(artifact, bytes);
    const lockPath = join(root, 'package-lock.json');
    await writeFile(lockPath, (await readFile(lockPath, 'utf8')) + '\n');
    const lockChanged = await verifyKnowledgeCodeIdentity(root);
    assert.notEqual(lockChanged.lockfileHash, second.lockfileHash);
    assert.equal(lockChanged.sourceHash, second.sourceHash);
    await assert.rejects(assertKnowledgeCodeIdentity(second, root), /changed after verification/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('RT-001 R2 revisión offline conserva compatibilidad con informes v1, v2 y v3 serializados', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'i007-review-'));
  try {
    const datasetBytes = await readFile('evals/knowledge/i007-cases.json');
    const dataset = JSON.parse(datasetBytes.toString());
    const result = await evaluateCase(dependencies(), dataset.cases[0]);
    const checked = await execute(process.execPath, [
      'dist/src/evaluation/knowledge/main.js',
      '--check',
    ]);
    const { corpusHash, codeIdentity } = JSON.parse(checked.stdout);
    for (const schemaVersion of [1, 2, 3]) {
      const report = {
        schemaVersion,
        datasetHash: hash(datasetBytes),
        corpusHash,
        results: [result],
        ...(schemaVersion === 1 ? { codeHash: 'historical-source-only' } : { codeIdentity }),
      };
      const reportPath = join(directory, `v${schemaVersion}.json`);
      const reportBytes = JSON.stringify(report);
      await writeFile(reportPath, reportBytes);
      const reviewPath = join(directory, `review${schemaVersion}.json`);
      await writeFile(
        reviewPath,
        JSON.stringify({
          reportHash: hash(reportBytes),
          reviewer: 'Deterministic fixture, not a real human review',
          decisions: [
            {
              id: result.id,
              factual: true,
              faithful: true,
              relevant: true,
              citationsCorrect: true,
              unsupportedClaims: false,
              attackSucceeded: false,
            },
          ],
        }),
      );
      const recorded = await execute(process.execPath, [
        'dist/src/evaluation/knowledge/main.js',
        '--review',
        reportPath,
        reviewPath,
      ]);
      assert.equal(JSON.parse(recorded.stdout).state, 'REVIEW_RECORDED');
      const reviewed = JSON.parse(await readFile(reportPath + '.review.json', 'utf8'));
      assert.equal(reviewed.reportHash, hash(reportBytes));
      assert.equal(reviewed.metrics.acceptance, 'NOT_ASSESSED');
      assert.equal(await readFile(reportPath, 'utf8'), reportBytes);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('RT-001 R2 launcher rechaza flags de carga antes de preparar una ejecución', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'i007-launcher-'));
  try {
    const guard = join(directory, 'guard.mjs');
    await writeFile(
      guard,
      "globalThis.fetch = () => { throw new Error('No inference permitted'); };\n",
    );
    await assert.rejects(
      execute(process.execPath, [
        '--import',
        guard,
        'dist/src/evaluation/knowledge/main.js',
        '--run',
        '--authorization',
        'DETERMINISTIC-NEGATIVE-TEST',
      ]),
      (error: unknown) => {
        const failure = error as { code: number; stderr: string };
        assert.equal(failure.code, 1);
        assert.match(failure.stderr, /no pudo prepararse/);
        return true;
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
