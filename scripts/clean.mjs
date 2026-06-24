import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

for (const dir of ['dist']) {
  rmSync(join(root, dir), { recursive: true, force: true });
}
