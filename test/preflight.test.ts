import { describe, expect, it } from 'vitest';
import {
  findPreflightProcess,
  normalizeProcessName,
  parsePosixProcessList,
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
});
