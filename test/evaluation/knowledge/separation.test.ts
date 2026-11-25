import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative } from 'node:path';
import ts from 'typescript';
import {
  evaluateCase,
  runBaseline,
  summarize,
} from '../../../src/evaluation/knowledge/evaluation.js';
import { persist, synchronization } from '../../../src/evaluation/durable-files.js';
import { dependencies, chunk } from '../../knowledge/helpers.js';
import { KnowledgeError } from '../../../src/knowledge/domain.js';

const execute = promisify(execFile);

function imports(source: string) {
  const modules: string[] = [];
  const syntax = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, true);

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        modules.push(node.moduleSpecifier.text);
      }
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const argument = node.arguments[0];
      assert.ok(argument && ts.isStringLiteral(argument), 'No opaque dynamic module dependency');
      modules.push(argument.text);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      assert.ok(ts.isStringLiteral(node.argument.literal));
      modules.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(syntax);
  return modules;
}

async function assertProductionBoundary(roots: string[], read: (path: string) => Promise<string>) {
  const seen = new Set<string>();
  const evaluationRoot = resolve('src/evaluation');

  async function visit(path: string): Promise<void> {
    const file = resolve(path);
    assert.ok(
      file !== evaluationRoot && !file.startsWith(evaluationRoot + '/'),
      `Production depends on evaluation: ${relative(process.cwd(), file)}`,
    );
    if (seen.has(file)) {
      return;
    }
    seen.add(file);
    for (const specifier of imports(await read(file))) {
      if (!specifier.startsWith('.')) {
        // The project has no paths aliases or internal package imports.
        assert.ok(
          !specifier.startsWith('#'),
          'Internal aliases require explicit boundary resolution',
        );
        continue;
      }
      await visit(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')));
    }
  }

  for (const root of roots) {
    await visit(root);
  }
  return seen;
}

async function files(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await files(path)));
    } else if (entry.name.endsWith('.ts')) {
      result.push(path);
    }
  }
  return result;
}

test('RT-001 producción no depende directa ni transitivamente de evaluación', async () => {
  const roots = ['src/main.ts', 'src/config.ts', 'src/composition.ts'];
  for (const directory of ['knowledge', 'application', 'domain', 'infrastructure', 'http']) {
    roots.push(...(await files('src/' + directory)));
  }
  await assertProductionBoundary(roots, (path) => readFile(path, 'utf8'));
  const config = JSON.parse(await readFile('tsconfig.json', 'utf8'));
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(config.compilerOptions.paths, undefined);
  assert.equal(config.compilerOptions.baseUrl, undefined);
  assert.equal(pkg.imports, undefined);
});

test('RT-001 la guarda detecta imports directos, transitivos, dinámicos y reexports', async () => {
  for (const forbidden of [
    "import '../evaluation/knowledge/evaluation.js';",
    "export * from '../evaluation/knowledge/evaluation.js';",
    "void import('../evaluation/knowledge/evaluation.js');",
    "import type { EvalResult } from '../evaluation/knowledge/evaluation.js';",
  ]) {
    const sources = new Map([
      [resolve('src/knowledge/root.ts'), "import './bridge.js';"],
      [resolve('src/knowledge/bridge.ts'), forbidden],
    ]);
    await assert.rejects(
      assertProductionBoundary(['src/knowledge/root.ts'], async (path) => {
        assert.ok(sources.has(path));
        return sources.get(path)!;
      }),
      /Production depends on evaluation/,
    );
  }
});

test('RT-001 entrypoint --check funciona offline y no genera evidencias', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'i007-offline-'));
  try {
    const guard = join(directory, 'deny-network.mjs');
    await writeFile(guard, "globalThis.fetch = () => { throw new Error('Network forbidden'); };\n");
    const evidenceFiles = async () => {
      try {
        return (await readdir('evals/reports/i007')).sort();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return [];
        }
        throw error;
      }
    };
    const before = await evidenceFiles();
    const result = await execute(
      process.execPath,
      ['--import', guard, 'dist/src/evaluation/knowledge/main.js', '--check'],
      {
        env: {
          ...process.env,
          RAG_OLLAMA_BASE_URL: 'http://127.0.0.1:1',
          RAG_DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/offline',
        },
      },
    );
    const { codeIdentity, ...checked } = JSON.parse(result.stdout);
    assert.equal(codeIdentity.correspondence, 'VERIFIED');
    assert.ok(
      codeIdentity.sources.some(
        (item: { path: string }) => item.path === 'src/evaluation/durable-files.ts',
      ),
    );
    assert.deepEqual(checked, {
      datasetId: 'aster-knowledge-es-v1',
      cases: 20,
      datasetHash: '5f61c2cd28e92a9a65559d35c58cf9c04fdfb00462c75eb1febd816cd6fcb6c2',
      corpusHash: 'e8b4dcf3289be333453a34f40f0b6d844318f743316b849c5f38a415417c8e21',
      status: 'CANDIDATE',
      inference: false,
    });
    assert.deepEqual(await evidenceFiles(), before);
    const pkg = JSON.parse(await readFile('package.json', 'utf8'));
    assert.equal(pkg.scripts['eval:knowledge'], 'node dist/src/evaluation/knowledge/main.js');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('RT-001 fixture: contexto, respuesta, citas, privacidad y parcial durable sin reintentos', async () => {
  const dataset = JSON.parse(await readFile('evals/knowledge/i007-cases.json', 'utf8'));
  const second = { ...chunk, chunkId: 'c2', content: 'Contexto no enviado.' };
  const deps = dependencies([chunk, second]);
  deps.maxContextChunks = 1;
  let sends = 0;
  deps.generator.generate = async (question, context) => {
    sends++;
    assert.equal(question, dataset.cases[sends - 1].question);
    assert.deepEqual(context, [chunk]);
    if (sends === 2) {
      throw new KnowledgeError('GENERATION_TIMEOUT');
    }
    return { status: 'ANSWER', answer: '15 minutos.', chunkIds: ['c1'] };
  };
  const directory = await mkdtemp(join(tmpdir(), 'i007-eval-partial-'));
  try {
    const results = await runBaseline(
      deps,
      dataset,
      (result) =>
        persist(
          join(directory, result.id + '.json'),
          JSON.stringify(result),
          true,
          synchronization,
        ),
      {
        expected: { model: 'fake', digest: 'b'.repeat(64) },
        async read() {
          return { model: 'fake', digest: 'b'.repeat(64) };
        },
      },
      true,
    );
    assert.equal(sends, 2);
    assert.deepEqual((await readdir(directory)).sort(), ['I007-001.json', 'I007-002.json']);
    const saved = JSON.parse(await readFile(join(directory, 'I007-001.json'), 'utf8'));
    assert.deepEqual(saved.reviewContent.context, [{ chunkId: 'c1', content: chunk.content }]);
    assert.deepEqual(saved.reviewContent.answer, {
      status: 'ANSWER',
      answer: '15 minutos.',
      sources: [
        {
          documentId: 'access',
          versionId: 'v1',
          chunkId: 'c1',
          title: 'Acceso',
          section: 'Bloqueos',
        },
      ],
    });
    assert.deepEqual(saved.retrievedChunkIds, ['c1', 'c2']);
    assert.equal(results[1]?.error, 'GENERATION_TIMEOUT');
    const metrics = summarize(dataset, results);
    assert.equal(metrics.state, 'INCOMPLETE');
    assert.deepEqual(metrics.statusAccuracy, { numerator: 1, denominator: 1, percentage: 100 });
    assert.deepEqual(metrics.endToEndStatusSuccess, {
      numerator: 1,
      denominator: 20,
      percentage: 5,
    });
    assert.equal(metrics.technicalErrors, 1);
    assert.equal(metrics.unprocessed, 18);
    assert.equal(metrics.acceptance, 'NOT_ASSESSED');
    const privateOff = await evaluateCase(dependencies(), dataset.cases[0]);
    assert.equal(privateOff.reviewContent, undefined);
    let nextSends = 0;
    const failureDeps = dependencies();
    failureDeps.generator.generate = async () => {
      nextSends++;
      return { status: 'ANSWER', answer: '15 minutos.', chunkIds: ['c1'] };
    };
    await assert.rejects(
      runBaseline(
        failureDeps,
        dataset,
        async () => {
          throw new Error('Persistence unavailable');
        },
        {
          expected: { model: 'fake', digest: 'b'.repeat(64) },
          async read() {
            return { model: 'fake', digest: 'b'.repeat(64) };
          },
        },
      ),
      /Persistence unavailable/,
    );
    assert.equal(nextSends, 1);
    assert.equal(JSON.parse(await readFile(join(directory, 'I007-001.json'), 'utf8')).id, saved.id);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
