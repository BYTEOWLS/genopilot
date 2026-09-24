import {open, readFile, rm, stat} from 'node:fs/promises';

const malformedLockGracePeriodMilliseconds = 30_000;

export type FileLock = {
  /** Whether a stale lock left by a stopped process was removed before acquiring this one. */
  recovered: boolean;
  release: () => Promise<void>;
};

function processIsActive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * Creates `path` exclusively and records the current PID in it. A lock whose owner has stopped
 * is recovered; a lock held by a running process, or one still being written, fails with
 * `busyMessage`.
 */
export async function acquireFileLock(path: string, busyMessage: string): Promise<FileLock> {
  let recovered = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const handle = await open(path, 'wx', 0o600);
      try {
        await handle.writeFile(`${String(process.pid)}\n`, 'utf8');
      } catch (error) {
        await handle.close();
        await rm(path, {force: true});
        throw error;
      }
      return {
        recovered,
        release: async () => {
          try {
            await handle.close();
          } finally {
            await rm(path, {force: true});
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }

      try {
        const [contents, details] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
        const pidText = contents.trim();
        const parsedPid = /^\d+$/.test(pidText) ? Number(pidText) : undefined;
        const pid =
          parsedPid !== undefined && Number.isSafeInteger(parsedPid) && parsedPid > 0
            ? parsedPid
            : undefined;
        const malformedLockIsRecent =
          pid === undefined && Date.now() - details.mtimeMs < malformedLockGracePeriodMilliseconds;
        if ((pid !== undefined && processIsActive(pid)) || malformedLockIsRecent) {
          throw new Error(busyMessage);
        }
        await rm(path, {force: true});
        recovered = true;
      } catch (inspectionError) {
        if ((inspectionError as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw inspectionError;
        }
      }
    }
  }
  throw new Error(`Could not acquire the lock at ${path}.`);
}
