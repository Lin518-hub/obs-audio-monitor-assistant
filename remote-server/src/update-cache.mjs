import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const METADATA_FILES = ['latest.yml', 'latest-mac.yml'];
const STATUS_FILE = '.update-cache-status.json';
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_PACKAGE_BYTES = 1024 * 1024 * 1024;

export function defaultUpdateReleaseBases() {
  const github = 'https://github.com/Lin518-hub/obs-audio-monitor-assistant/releases/download/latest/';
  return [
    github,
    `https://ghproxy.net/${github}`,
    `https://gh-proxy.com/${github}`
  ];
}

export function parseUpdateReleaseBases(value) {
  const configured = String(value || '')
    .split(',')
    .map((item) => normalizeBaseUrl(item))
    .filter(Boolean);
  return configured.length > 0 ? Array.from(new Set(configured)) : defaultUpdateReleaseBases();
}

export function createUpdateCache({
  updateDir,
  releaseBases = defaultUpdateReleaseBases(),
  enabled = true,
  intervalMs = 2 * 60 * 1000,
  metadataTimeoutMs = 25_000,
  packageTimeoutMs = 15 * 60 * 1000,
  fetchImpl = globalThis.fetch,
  logger = console
}) {
  if (!updateDir) throw new Error('updateDir is required');
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  const bases = Array.from(new Set(releaseBases.map((item) => normalizeBaseUrl(item)).filter(Boolean)));
  let timer = null;
  let currentSync = null;
  let state = {
    status: enabled ? 'idle' : 'disabled',
    version: null,
    source: null,
    files: [],
    lastAttemptAt: null,
    lastSuccessAt: null,
    error: null
  };

  async function initialize() {
    await mkdir(updateDir, { recursive: true });
    await removeInterruptedDownloads(updateDir);
    state = await loadState(updateDir, state);
    if (!enabled) {
      state = { ...state, status: 'disabled', error: null };
      return;
    }
    void sync().catch((error) => logger.error(`[updates] initial cache warm failed: ${error.message}`));
    timer = setInterval(() => {
      void sync().catch((error) => logger.error(`[updates] scheduled cache warm failed: ${error.message}`));
    }, Math.max(60_000, intervalMs));
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function getStatus() {
    return { ...state, files: state.files.map((item) => ({ ...item })) };
  }

  async function sync() {
    if (!enabled) return getStatus();
    if (currentSync) return currentSync;
    currentSync = performSync().finally(() => { currentSync = null; });
    return currentSync;
  }

  async function performSync() {
    const lastAttemptAt = Date.now();
    const previousState = state;
    state = { ...state, status: 'syncing', lastAttemptAt, error: null };
    try {
      if (bases.length === 0) throw new Error('未配置可用的更新下载源');

      const metadata = [];
      for (const name of METADATA_FILES) {
        const fetched = await fetchBufferWithFallback(name, bases, fetchImpl, metadataTimeoutMs, MAX_METADATA_BYTES);
        const parsed = parseMetadata(name, fetched.buffer);
        metadata.push({ name, ...fetched, parsed });
      }

      const versions = Array.from(new Set(metadata.map((item) => item.parsed.version)));
      if (versions.length !== 1) throw new Error(`Windows 与 macOS 更新版本不一致：${versions.join(' / ')}`);
      const version = versions[0];
      const assets = deduplicateAssets(metadata.flatMap((item) => item.parsed.assets));
      if (assets.length === 0) throw new Error('更新描述文件没有包含安装包');

      const cachedFiles = [];
      const usedSources = new Set(metadata.map((item) => item.source));
      for (const asset of assets) {
        const target = join(updateDir, asset.name);
        const previousFile = previousState.files.find((item) => item.name === asset.name);
        const trustedPreviousSync = previousState.version === version
          && previousState.status === 'ready'
          && previousFile?.sha512 === asset.sha512;
        const valid = await localAssetIsReady(target, asset, trustedPreviousSync);
        if (!valid) {
          const downloaded = await downloadAssetWithFallback(asset, target, bases, fetchImpl, packageTimeoutMs);
          usedSources.add(downloaded.source);
        }
        const info = await stat(target);
        cachedFiles.push({ name: asset.name, size: info.size, sha512: asset.sha512 });
      }

      // Packages are committed first. Metadata is replaced last, so a client
      // can never receive a descriptor that points to an incomplete package.
      for (const item of metadata) {
        await atomicWrite(join(updateDir, item.name), item.buffer);
        cachedFiles.push({ name: item.name, size: item.buffer.length });
      }

      state = {
        status: 'ready',
        version,
        source: Array.from(usedSources).join('、'),
        files: cachedFiles.sort((left, right) => left.name.localeCompare(right.name)),
        lastAttemptAt,
        lastSuccessAt: Date.now(),
        error: null
      };
      await persistState(updateDir, state);
      logger.info(`[updates] cache ready for v${version}: ${cachedFiles.map((item) => item.name).join(', ')}`);
      return getStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state = { ...state, status: 'error', lastAttemptAt, error: message };
      await persistState(updateDir, state).catch(() => undefined);
      throw new Error(message);
    }
  }

  return { initialize, stop, sync, getStatus };
}

async function removeInterruptedDownloads(updateDir) {
  const names = await readdir(updateDir).catch(() => []);
  await Promise.all(names
    .filter((name) => /\.(?:download|tmp|upload)-/.test(name))
    .map((name) => rm(join(updateDir, name), { force: true })));
}

function normalizeBaseUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  } catch {
    return '';
  }
}

async function loadState(updateDir, fallback) {
  try {
    const parsed = JSON.parse(await readFile(join(updateDir, STATUS_FILE), 'utf8'));
    return {
      ...fallback,
      ...parsed,
      status: parsed.status === 'ready' ? 'ready' : 'idle',
      files: Array.isArray(parsed.files) ? parsed.files : []
    };
  } catch {
    return fallback;
  }
}

async function persistState(updateDir, value) {
  await atomicWrite(join(updateDir, STATUS_FILE), Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

async function atomicWrite(target, buffer) {
  const temporary = `${target}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    await writeFile(temporary, buffer, { mode: 0o644 });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function fetchBufferWithFallback(name, bases, fetchImpl, timeoutMs, maxBytes) {
  const errors = [];
  for (const base of bases) {
    const url = buildAssetUrl(base, name);
    try {
      const response = await fetchImpl(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'OBS-Audio-Monitor-Assistant-Update-Cache/1.0' },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declaredSize = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredSize) && declaredSize > maxBytes) throw new Error('响应文件过大');
      const chunks = [];
      let size = 0;
      for await (const raw of response.body || []) {
        const chunk = Buffer.from(raw);
        size += chunk.length;
        if (size > maxBytes) throw new Error('响应文件过大');
        chunks.push(chunk);
      }
      if (size === 0) throw new Error('响应内容为空');
      return { buffer: Buffer.concat(chunks), source: sourceLabel(base), url };
    } catch (error) {
      errors.push(`${sourceLabel(base)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`无法下载 ${name}（${errors.join('；')}）`);
}

function parseMetadata(name, buffer) {
  let document;
  try {
    document = parseYaml(buffer.toString('utf8'));
  } catch {
    throw new Error(`${name} 格式无效`);
  }
  const version = String(document?.version || '').trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) throw new Error(`${name} 缺少有效版本号`);
  const records = Array.isArray(document.files) && document.files.length > 0
    ? document.files
    : document.path
      ? [{ url: document.path, sha512: document.sha512, size: document.size }]
      : [];
  const assets = records.map((record) => normalizeAsset(record)).filter(Boolean);
  if (assets.length === 0) throw new Error(`${name} 未列出可下载安装包`);
  return { version, assets };
}

function normalizeAsset(record) {
  const raw = String(record?.url || record?.path || '').split(/[?#]/, 1)[0];
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { decoded = raw; }
  const name = basename(decoded);
  if (!name || name !== decoded || !/^[A-Za-z0-9._-]+$/.test(name)) return null;
  const size = Number(record?.size);
  const sha512 = String(record?.sha512 || '').trim();
  if (!sha512 || !/^[A-Za-z0-9+/]+={0,2}$/.test(sha512)) return null;
  return {
    name,
    size: Number.isFinite(size) && size > 0 ? size : null,
    sha512
  };
}

function deduplicateAssets(items) {
  const result = new Map();
  for (const item of items) {
    const existing = result.get(item.name);
    if (existing && (existing.sha512 !== item.sha512 || (existing.size && item.size && existing.size !== item.size))) {
      throw new Error(`安装包 ${item.name} 的校验信息不一致`);
    }
    result.set(item.name, existing || item);
  }
  return Array.from(result.values());
}

async function localAssetIsReady(target, asset, trustedPreviousSync) {
  try {
    const info = await stat(target);
    if (!info.isFile() || info.size <= 0) return false;
    if (asset.size && info.size !== asset.size) return false;
    if (trustedPreviousSync) return true;
    return (await sha512File(target)) === asset.sha512;
  } catch {
    return false;
  }
}

async function sha512File(file) {
  const handle = await open(file, 'r');
  const hash = createHash('sha512');
  try {
    for await (const chunk of handle.readableWebStream()) hash.update(Buffer.from(chunk));
    return hash.digest('base64');
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function downloadAssetWithFallback(asset, target, bases, fetchImpl, timeoutMs) {
  const errors = [];
  for (const base of bases) {
    const url = buildAssetUrl(base, asset.name);
    const temporary = `${target}.download-${process.pid}-${randomBytes(4).toString('hex')}`;
    try {
      const response = await fetchImpl(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'OBS-Audio-Monitor-Assistant-Update-Cache/1.0' },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declaredSize = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredSize) && declaredSize > MAX_PACKAGE_BYTES) throw new Error('安装包超过大小限制');
      const handle = await open(temporary, 'w', 0o644);
      const hash = createHash('sha512');
      let size = 0;
      try {
        for await (const raw of response.body || []) {
          const chunk = Buffer.from(raw);
          size += chunk.length;
          if (size > MAX_PACKAGE_BYTES) throw new Error('安装包超过大小限制');
          hash.update(chunk);
          await handle.write(chunk);
        }
      } finally {
        await handle.close();
      }
      if (asset.size && size !== asset.size) throw new Error(`文件大小不匹配（${size}/${asset.size}）`);
      if (hash.digest('base64') !== asset.sha512) throw new Error('SHA-512 校验失败');
      await rename(temporary, target);
      return { source: sourceLabel(base), url, size };
    } catch (error) {
      await rm(temporary, { force: true });
      errors.push(`${sourceLabel(base)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`无法下载 ${asset.name}（${errors.join('；')}）`);
}

function buildAssetUrl(base, name) {
  return `${base}${name.split('/').map((part) => encodeURIComponent(part)).join('/')}`;
}

function sourceLabel(base) {
  try {
    const url = new URL(base);
    if (url.hostname === 'github.com') return 'GitHub Releases';
    return url.hostname;
  } catch {
    return base;
  }
}
