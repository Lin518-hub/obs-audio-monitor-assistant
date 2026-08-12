import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const BACKUP_PREFIX = 'remote-state-';
const BACKUP_SUFFIX = '.json';

export async function backupStateFile({ dataFile, backupDir, retain = 14, now = () => Date.now() }) {
  let contents;
  try {
    contents = await readFile(dataFile, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { created: false, reason: 'missing' };
    throw error;
  }
  JSON.parse(contents);
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
  const fileName = `${BACKUP_PREFIX}${stamp}${BACKUP_SUFFIX}`;
  const destination = join(backupDir, fileName);
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, destination);
  const files = (await readdir(backupDir))
    .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith(BACKUP_SUFFIX))
    .sort()
    .reverse();
  await Promise.all(files.slice(Math.max(1, retain)).map((name) => rm(join(backupDir, basename(name)), { force: true })));
  return { created: true, fileName };
}

export function createStateBackupScheduler(options) {
  const intervalMs = Math.max(60_000, Number(options.intervalMs) || 24 * 60 * 60 * 1000);
  let timer = null;
  let running = null;

  const backupNow = () => {
    if (!running) {
      running = backupStateFile(options).finally(() => {
        running = null;
      });
    }
    return running;
  };

  return {
    backupNow,
    start() {
      if (timer) return;
      timer = setInterval(() => {
        void backupNow().catch((error) => options.logger?.warn?.(`[backup] state backup failed: ${error.message}`));
      }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
