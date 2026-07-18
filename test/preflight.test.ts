import { describe, expect, it } from 'vitest';
import {
  browserNewWindowArgument,
  findPreflightProcess,
  normalizeProcessName,
  parsePosixProcessList,
  parseWindowsProcessJson,
  parseWindowsTaskList
} from '../src/shared/preflight.js';

describe('preflight process detection', () => {
  it('parses the quoted Windows tasklist format including Chinese names', () => {
    const processes = parseWindowsTaskList([
      '"obs64.exe","14320","Console","1","182,440 K"',
      '"宇宙猫检测.exe","2176","Console","1","41,200 K"'
    ].join('\r\n'));

    expect(processes).toEqual([
      { pid: 14320, name: 'obs64.exe', command: 'obs64.exe' },
      { pid: 2176, name: '宇宙猫检测.exe', command: '宇宙猫检测.exe' }
    ]);
    expect(findPreflightProcess('obs', processes)?.pid).toBe(14320);
    expect(findPreflightProcess('cosmic_cat', processes)?.pid).toBe(2176);
  });

  it('uses a configured executable name for software with a custom process name', () => {
    const processes = parseWindowsTaskList('"VendorController.exe","928","Console","1","20,000 K"');
    expect(findPreflightProcess('software_control', processes, 'C:\\Live\\VendorController.exe')?.pid).toBe(928);
  });

  it('keeps platform aliases active after a launcher shortcut has been configured', () => {
    const processes = parseWindowsTaskList('"直播伴侣.exe","932","Console","1","120,000 K"');
    expect(findPreflightProcess(
      'douyin',
      processes,
      'C:\\Users\\Live\\Desktop\\平台直播工具.lnk',
      'C:\\Program Files\\DouyinLive\\Launcher.exe'
    )?.pid).toBe(932);
  });

  it('parses Windows process paths and recognizes a configured executable from CIM JSON', () => {
    const processes = parseWindowsProcessJson(JSON.stringify({
      pid: 816,
      name: 'VendorHost.exe',
      executablePath: 'C:\\Live Tools\\VendorHost.exe',
      commandLine: '"C:\\Live Tools\\VendorHost.exe" --background'
    }));
    expect(processes).toEqual([{ pid: 816, name: 'VendorHost.exe', command: 'C:\\Live Tools\\VendorHost.exe' }]);
    expect(findPreflightProcess('douyin', processes, 'C:\\Live Tools\\VendorHost.exe')?.pid).toBe(816);
  });

  it('recognizes child processes launched from the configured application directory', () => {
    const processes = parseWindowsProcessJson(JSON.stringify({
      pid: 820,
      name: 'main.exe',
      executablePath: 'C:\\Program Files\\DouyinLive\\resources\\main.exe'
    }));
    expect(findPreflightProcess(
      'douyin',
      processes,
      'C:\\Users\\Live\\Desktop\\平台直播工具.lnk',
      'C:\\Program Files\\DouyinLive\\Launcher.exe'
    )?.pid).toBe(820);
  });

  it('accepts both one-row and multi-row PowerShell JSON snapshots', () => {
    expect(parseWindowsProcessJson(JSON.stringify([
      { ProcessId: '1', Name: 'obs64.exe', ExecutablePath: 'C:\\OBS\\obs64.exe' },
      { ProcessId: 2, Name: '直播伴侣客户端.exe', CommandLine: '直播伴侣客户端.exe --silent' }
    ]))).toHaveLength(2);
  });

  it('does not confuse unrelated applications with short OBS aliases', () => {
    const processes = parseWindowsTaskList('"Obsidian.exe","311","Console","1","90,000 K"');
    expect(findPreflightProcess('obs', processes)).toBeNull();
  });

  it('recognizes common browsers and parses POSIX process output for local previews', () => {
    const processes = parsePosixProcessList('  120 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n  121 /usr/bin/helper');
    expect(processes).toHaveLength(2);
    expect(findPreflightProcess('browser', processes)?.pid).toBe(120);
  });

  it('normalizes punctuation and executable extensions consistently', () => {
    expect(normalizeProcessName('Software Control.exe')).toBe('softwarecontrol');
    expect(normalizeProcessName('抖音直播伴侣.EXE')).toBe('抖音直播伴侣');
  });

  it('selects a safe new-window argument for supported browsers', () => {
    expect(browserNewWindowArgument('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')).toBe('--new-window');
    expect(browserNewWindowArgument('C:\\Program Files\\Mozilla Firefox\\firefox.exe')).toBe('-new-window');
    expect(browserNewWindowArgument('C:\\Browser\\custom.exe')).toBe('');
  });
});
