import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export interface KnowledgeCodeIdentity {
  schemaVersion: 1;
  sourceHash: string;
  buildHash: string;
  lockfileHash: string;
  configurationHash: string;
  compilerVersion: string;
  nodeVersion: string;
  correspondence: 'VERIFIED';
  sources: { path: string; sha256: string }[];
  artifacts: { path: string; sha256: string }[];
  configuration: { path: string; sha256: string }[];
}

const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export async function verifyKnowledgeCodeIdentity(
  root = process.cwd(),
): Promise<KnowledgeCodeIdentity> {
  const base = resolve(root);
  const sourceRoot = resolve(base, 'src') + sep;
  const buildRoot = resolve(base, 'dist') + sep;
  const paths = ['package.json', 'package-lock.json', 'tsconfig.json', 'scripts/build.js'];
  const configuration = await Promise.all(
    paths.map(async (path) => ({ path, sha256: hash(await readFile(resolve(base, path))) })),
  );
  const lock = JSON.parse(await readFile(resolve(base, 'package-lock.json'), 'utf8'));
  if (lock.packages?.['node_modules/typescript']?.version !== ts.version) {
    throw new Error('Compiler differs from lockfile');
  }
  const configPath = resolve(base, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error || config.config.extends || config.config.references) {
    throw new Error('Invalid build configuration');
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, base);
  if (parsed.errors.length || parsed.options.noEmit) {
    throw new Error('Invalid build configuration');
  }
  const program = ts.createProgram(
    [resolve(base, 'src/evaluation/knowledge/main.ts')],
    parsed.options,
  );
  if (ts.getPreEmitDiagnostics(program).length) {
    throw new Error('Sources cannot reproduce the build');
  }
  const ownSources = program
    .getSourceFiles()
    .filter((file) => resolve(file.fileName).startsWith(sourceRoot));
  const sources = ownSources
    .map((file) => ({
      path: relative(base, file.fileName).split(sep).join('/'),
      sha256: hash(file.text),
    }))
    .sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const emitted = new Map<string, string>();
  const result = program.emit(undefined, (path, text) => {
    const absolute = resolve(path);
    if (!absolute.startsWith(buildRoot)) {
      throw new Error('Build output outside generated directory');
    }
    emitted.set(absolute, text);
  });
  if (result.emitSkipped || result.diagnostics.length || emitted.size === 0) {
    throw new Error('Sources cannot reproduce the build');
  }
  const artifacts = [];
  for (const [path, expected] of [...emitted.entries()].sort(([a], [b]) =>
    a.localeCompare(b, 'en'),
  )) {
    const bytes = await readFile(path);
    if (!bytes.equals(Buffer.from(expected))) {
      throw new Error('Compiled artifact differs from sources');
    }
    artifacts.push({ path: relative(base, path).split(sep).join('/'), sha256: hash(bytes) });
  }
  // Reject a source/configuration change while the in-memory compilation was taking place.
  for (const item of [...sources, ...configuration]) {
    if (hash(await readFile(resolve(base, item.path))) !== item.sha256) {
      throw new Error('Code identity changed during verification');
    }
  }
  return {
    schemaVersion: 1,
    sourceHash: hash(JSON.stringify(sources)),
    buildHash: hash(JSON.stringify(artifacts)),
    lockfileHash: configuration.find((item) => item.path === 'package-lock.json')!.sha256,
    configurationHash: hash(JSON.stringify(configuration)),
    compilerVersion: ts.version,
    nodeVersion: process.version,
    correspondence: 'VERIFIED',
    sources,
    artifacts,
    configuration,
  };
}

export async function assertKnowledgeCodeIdentity(
  identity: KnowledgeCodeIdentity,
  root = process.cwd(),
): Promise<void> {
  for (const item of [...identity.sources, ...identity.artifacts, ...identity.configuration]) {
    if (hash(await readFile(resolve(root, item.path))) !== item.sha256) {
      throw new Error('Code identity changed after verification');
    }
  }
}
