import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotBuild } from './build-snapshot.js';

// Capture the executable tree before importing the evaluator and its application dependencies.
const startup = snapshotBuild(resolve(dirname(fileURLToPath(import.meta.url)), '../../..'));
const { executeCli } = await import('./main.js');
const result = await executeCli(process.cwd(), process.argv.slice(2), undefined, startup);
(result.exitCode === 0 ? console.log : console.error)(result.output);
process.exitCode = result.exitCode;
