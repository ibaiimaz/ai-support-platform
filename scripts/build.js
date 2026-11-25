import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Fixed generated directory: never accept a cleanup target from CLI or environment.
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
const compilation = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)),
    '-p',
    'tsconfig.json',
  ],
  { cwd: root, stdio: 'inherit' },
);
if (compilation.error) {
  console.error('No se pudo ejecutar la compilación TypeScript.');
}
process.exitCode = compilation.status ?? 1;
