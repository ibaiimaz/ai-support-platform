import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareModelFiles } from './compare.js';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      JSON.stringify(await compareModelFiles(process.cwd(), process.argv.slice(2)), null, 2),
    );
  } catch {
    console.error('No se pudo comparar I004: revise informes y referencias congeladas.');
    process.exitCode = 1;
  }
}
