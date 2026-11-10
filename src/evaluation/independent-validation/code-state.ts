import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { sha256 } from '../dataset.js';
import { findCodeReference } from '../code-reference.js';
import { snapshotBuild, type BuildSnapshot } from './build-snapshot.js';

export { snapshotBuild, type BuildSnapshot } from './build-snapshot.js';

function inventory(directory: string, extension: string): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (path: string) => {
    for (const item of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, item.name);
      if (item.isDirectory()) {
        visit(full);
      } else if (item.isFile() && item.name.endsWith(extension)) {
        files[relative(directory, full)] = sha256(readFileSync(full));
      } else if (!item.isFile()) {
        throw new Error('Árbol de código no regular.');
      }
    }
  };
  visit(directory);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}

const digest = (value: unknown) => sha256(JSON.stringify(value));

export interface CodeIdentity {
  commit: string | null;
  method: 'typescript_emit_exact';
  compilerVersion: string;
  sourceSha256: string;
  buildSha256: string;
}

export interface CodeVerification {
  identity: CodeIdentity;
  verify: () => void;
}

export function captureCodeIdentity(root: string, startup: BuildSnapshot): CodeVerification {
  const buildDirectory = resolve(root, 'dist');
  if (buildDirectory !== startup.directory || Object.keys(startup.files).length === 0) {
    throw new Error('Build ejecutable no identificado.');
  }
  const sources = () => ({
    files: inventory(join(root, 'src'), '.ts'),
    configuration: Object.fromEntries(
      ['tsconfig.json', 'package.json', 'package-lock.json'].map((path) => [
        path,
        sha256(readFileSync(join(root, path))),
      ]),
    ),
    compilerVersion: ts.version,
  });
  const sourceSha256 = digest(sources());
  const configuration = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
  if (configuration.error) {
    throw new Error('Configuración TypeScript inválida.');
  }
  const parsed = ts.parseJsonConfigFileContent(configuration.config, ts.sys, root);
  const program = ts.createProgram(
    parsed.fileNames.filter((path) => path.startsWith(join(root, 'src') + '/')),
    parsed.options,
  );
  if (parsed.errors.length || ts.getPreEmitDiagnostics(program).length) {
    throw new Error('No puede demostrarse correspondencia con las fuentes.');
  }
  const emitted: Record<string, string> = {};
  const emission = program.emit(undefined, (path, text) => {
    if (!path.endsWith('.js') || !path.startsWith(join(buildDirectory, 'src') + '/')) {
      throw new Error('Salida de compilación inesperada.');
    }
    emitted[relative(join(buildDirectory, 'src'), path)] = sha256(text);
  });
  const expected = Object.fromEntries(
    Object.entries(emitted).sort(([a], [b]) => a.localeCompare(b)),
  );
  const buildSha256 = digest(startup.files);
  if (
    emission.emitSkipped ||
    digest(expected) !== buildSha256 ||
    digest(sources()) !== sourceSha256
  ) {
    throw new Error('Build desactualizado o fuentes cambiadas durante verificación.');
  }
  const verify = () => {
    if (
      digest(sources()) !== sourceSha256 ||
      digest(snapshotBuild(buildDirectory).files) !== buildSha256
    ) {
      throw new Error('Código modificado durante el brazo.');
    }
  };
  verify();
  return {
    identity: {
      commit: findCodeReference(root),
      method: 'typescript_emit_exact',
      compilerVersion: ts.version,
      sourceSha256,
      buildSha256,
    },
    verify,
  };
}
