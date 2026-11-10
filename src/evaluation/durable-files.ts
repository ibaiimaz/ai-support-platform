import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface DiskSynchronization {
  file: (handle: FileHandle) => Promise<void>;
  directory: (path: string) => Promise<void>;
}

export const synchronization: DiskSynchronization = {
  async file(handle) {
    await handle.sync();
  },
  async directory(path) {
    const handle = await open(path, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
};

export async function persist(
  path: string,
  bytes: string,
  exclusive: boolean,
  sync: DiskSynchronization,
) {
  const target = exclusive ? path : `${path}-${randomUUID()}.tmp`;
  const handle = await open(target, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await sync.file(handle);
  } finally {
    await handle.close();
  }
  if (!exclusive) {
    await rename(target, path);
  }
  await sync.directory(dirname(path));
}

export async function locked<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const path = join(directory, 'budget.lock');
  const handle = await open(path, 'wx', 0o600);
  try {
    return await operation();
  } finally {
    await handle.close();
    await unlink(path);
  }
}
