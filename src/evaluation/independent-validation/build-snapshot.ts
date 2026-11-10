import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export interface BuildSnapshot {
  directory: string;
  files: Record<string, string>;
}

// This module imports only Node built-ins so the launcher can inventory application code before loading it.
export function snapshotBuild(directory: string): BuildSnapshot {
  const source = join(directory, 'src');
  const files: Record<string, string> = {};
  const visit = (path: string) => {
    for (const item of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, item.name);
      if (item.isDirectory()) {
        visit(full);
      } else if (item.isFile() && item.name.endsWith('.js')) {
        files[relative(source, full)] = createHash('sha256')
          .update(readFileSync(full))
          .digest('hex');
      } else if (!item.isFile()) {
        throw new Error('Build no regular.');
      }
    }
  };
  visit(source);
  return {
    directory: resolve(directory),
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
  };
}
