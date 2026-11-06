import { execFileSync } from 'node:child_process';

export function findCodeReference(rootDirectory: string): string | null {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: rootDirectory,
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

    return /^[a-f0-9]{40,64}$/.test(commit) ? `git:${commit}` : null;
  } catch {
    return null;
  }
}
