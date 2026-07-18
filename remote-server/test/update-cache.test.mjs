import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createUpdateCache } from '../src/update-cache.mjs';

const silentLogger = { info() {}, error() {} };
const hash = (buffer) => createHash('sha512').update(buffer).digest('base64');

function metadata(version, name, content) {
  return Buffer.from([
    `version: ${version}`,
    'files:',
    `  - url: ${name}`,
    `    sha512: ${hash(content)}`,
    `    size: ${content.length}`,
    `path: ${name}`,
    `sha512: ${hash(content)}`,
    ''
  ].join('\n'));
}

async function fixtureServer(routes) {
  const hits = new Map();
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    hits.set(path, (hits.get(path) || 0) + 1);
    const body = routes.get(path);
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Length': body.length });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}/`,
    hits,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

test('warms and verifies Windows and macOS packages before publishing metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'obs-update-cache-'));
  const windows = Buffer.from('windows-installer-v3.4.0');
  const mac = Buffer.from('mac-arm-package-v3.4.0');
  const routes = new Map([
    ['/latest.yml', metadata('3.4.0', 'assistant-win.exe', windows)],
    ['/latest-mac.yml', metadata('3.4.0', 'assistant-mac.zip', mac)],
    ['/assistant-win.exe', windows],
    ['/assistant-mac.zip', mac]
  ]);
  const fixture = await fixtureServer(routes);
  const cache = createUpdateCache({ updateDir: root, releaseBases: [fixture.base], intervalMs: 60_000, logger: silentLogger });
  try {
    await writeFile(join(root, 'old.exe.download-1234-deadbeef'), 'partial');
    await cache.initialize();
    const first = await cache.sync();
    assert.equal(first.status, 'ready');
    assert.equal(first.version, '3.4.0');
    assert.equal(first.files.find((item) => item.name === 'assistant-win.exe')?.sha512, hash(windows));
    assert.deepEqual(await readFile(join(root, 'assistant-win.exe')), windows);
    assert.deepEqual(await readFile(join(root, 'assistant-mac.zip')), mac);
    assert.match(await readFile(join(root, 'latest.yml'), 'utf8'), /version: 3\.4\.0/);
    await assert.rejects(stat(join(root, 'old.exe.download-1234-deadbeef')));

    await cache.sync();
    assert.equal(fixture.hits.get('/assistant-win.exe'), 1);
    assert.equal(fixture.hits.get('/assistant-mac.zip'), 1);

    const republishedWindows = Buffer.from('WINDOWS-installer-v3.4.0');
    assert.equal(republishedWindows.length, windows.length);
    routes.set('/latest.yml', metadata('3.4.0', 'assistant-win.exe', republishedWindows));
    routes.set('/assistant-win.exe', republishedWindows);
    await cache.sync();
    assert.equal(fixture.hits.get('/assistant-win.exe'), 2);
    assert.deepEqual(await readFile(join(root, 'assistant-win.exe')), republishedWindows);
  } finally {
    cache.stop();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('does not publish update metadata when a package fails SHA-512 validation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'obs-update-cache-bad-'));
  const expected = Buffer.from('expected-package');
  const corrupt = Buffer.from('corrupt-package');
  const routes = new Map([
    ['/latest.yml', metadata('3.4.0', 'assistant-win.exe', expected)],
    ['/latest-mac.yml', metadata('3.4.0', 'assistant-mac.zip', expected)],
    ['/assistant-win.exe', corrupt],
    ['/assistant-mac.zip', corrupt]
  ]);
  const fixture = await fixtureServer(routes);
  const cache = createUpdateCache({ updateDir: root, releaseBases: [fixture.base], intervalMs: 60_000, logger: silentLogger });
  try {
    await cache.initialize();
    await assert.rejects(cache.sync(), /无法下载 assistant-win\.exe/);
    assert.equal(cache.getStatus().status, 'error');
    await assert.rejects(stat(join(root, 'latest.yml')));
  } finally {
    cache.stop();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('keeps package files for only the two most recent update versions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'obs-update-retention-'));
  const routes = new Map();
  const fixture = await fixtureServer(routes);
  const cache = createUpdateCache({ updateDir: root, releaseBases: [fixture.base], intervalMs: 60_000, logger: silentLogger });
  const publish = (version) => {
    const windows = Buffer.from(`windows-${version}`);
    const mac = Buffer.from(`mac-${version}`);
    routes.set('/latest.yml', metadata(version, `assistant-win-${version}.exe`, windows));
    routes.set('/latest-mac.yml', metadata(version, `assistant-mac-${version}.zip`, mac));
    routes.set(`/assistant-win-${version}.exe`, windows);
    routes.set(`/assistant-mac-${version}.zip`, mac);
  };
  try {
    publish('3.5.0');
    await cache.initialize();
    await cache.sync();
    publish('3.6.0');
    await cache.sync();
    publish('3.7.0');
    const current = await cache.sync();

    await assert.rejects(stat(join(root, 'assistant-win-3.5.0.exe')));
    await assert.rejects(stat(join(root, 'assistant-mac-3.5.0.zip')));
    assert.equal((await stat(join(root, 'assistant-win-3.6.0.exe'))).isFile(), true);
    assert.equal((await stat(join(root, 'assistant-mac-3.7.0.zip'))).isFile(), true);
    assert.deepEqual(current.retainedVersions.map((item) => item.version), ['3.7.0', '3.6.0']);
  } finally {
    cache.stop();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
