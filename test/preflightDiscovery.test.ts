import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { chooseBestCandidates, matchShortcutAppId, type DiscoveryCandidate } from '../src/main/preflightDiscovery.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('preflight app discovery', () => {
  it('recognizes Chinese platform and utility shortcut names', () => {
    expect(matchShortcutAppId('抖音直播伴侣')).toBe('douyin');
    expect(matchShortcutAppId('淘宝直播工作台')).toBe('douyin');
    expect(matchShortcutAppId('平台直播工具 - 美团直播')).toBe('douyin');
    expect(matchShortcutAppId('千牛主播工作台')).toBe('douyin');
    expect(matchShortcutAppId('Webcast Mate')).toBe('douyin');
    expect(matchShortcutAppId('宇宙猫检测工具')).toBe('cosmic_cat');
    expect(matchShortcutAppId('ATEM Software Control')).toBe('software_control');
  });

  it('prefers standard installs over registry and shortcut candidates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'preflight-discovery-'));
    temporaryDirectories.push(directory);
    const paths = {
      standard: join(directory, 'standard.exe'),
      registry: join(directory, 'registry.exe'),
      shortcut: join(directory, 'OBS.lnk')
    };
    await Promise.all(Object.values(paths).map((path) => writeFile(path, 'test')));
    const candidates: DiscoveryCandidate[] = [
      { id: 'obs', path: paths.shortcut, source: 'start_menu', priority: 2 },
      { id: 'obs', path: paths.registry, source: 'registry', priority: 1 },
      { id: 'obs', path: paths.standard, source: 'standard', priority: 0 }
    ];
    expect(chooseBestCandidates(candidates)).toEqual([{ id: 'obs', path: paths.standard, source: 'standard' }]);
  });
});
