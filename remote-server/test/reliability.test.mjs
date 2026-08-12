import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { backupStateFile } from '../src/state-backup.mjs';
import { createTlsCertificateReloader } from '../src/tls-certificate.mjs';
import { createRevisionTtlCache } from '../src/ttl-cache.mjs';

test('monitor overview cache reuses a revision briefly and invalidates immediately', () => {
  let current = 1000;
  let calls = 0;
  const cache = createRevisionTtlCache(() => ({ calls: ++calls }), { ttlMs: 1000, clock: () => current });
  assert.deepEqual(cache.get(1), { calls: 1 });
  assert.deepEqual(cache.get(1), { calls: 1 });
  assert.deepEqual(cache.get(2), { calls: 2 });
  current += 1001;
  assert.deepEqual(cache.get(2), { calls: 3 });
});

test('state backups validate JSON and keep only the configured generations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'obs-state-backup-'));
  try {
    const dataFile = join(root, 'remote-state.json');
    const backupDir = join(root, 'backups');
    await mkdir(backupDir);
    await writeFile(dataFile, '{"schemaVersion":1}\n');
    for (const timestamp of [1000, 2000, 3000]) {
      await backupStateFile({ dataFile, backupDir, retain: 2, now: () => timestamp });
    }
    const files = (await readdir(backupDir)).sort();
    assert.equal(files.length, 2);
    assert.equal(JSON.parse(await readFile(join(backupDir, files[1]), 'utf8')).schemaVersion, 1);

    await writeFile(dataFile, 'not-json');
    await assert.rejects(backupStateFile({ dataFile, backupDir, retain: 2 }));
    assert.equal((await readdir(backupDir)).length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('TLS reloader applies changed files and leaves unchanged files alone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'obs-tls-reload-'));
  try {
    const certFile = join(root, 'fullchain.pem');
    const keyFile = join(root, 'privkey.pem');
    await writeFile(certFile, 'certificate-one');
    await writeFile(keyFile, 'key-one');
    const contexts = [];
    const reloader = createTlsCertificateReloader({
      server: { setSecureContext: (context) => contexts.push(context) },
      certFile,
      keyFile,
      logger: { log() {}, warn() {}, error() {} }
    });
    await reloader.initialize();
    assert.equal(await reloader.checkNow(), false);
    await writeFile(certFile, 'certificate-two-with-a-different-size');
    assert.equal(await reloader.checkNow(), true);
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].cert.toString(), 'certificate-two-with-a-different-size');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
