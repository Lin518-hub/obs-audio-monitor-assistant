import { describe, expect, it } from 'vitest';
import { preflightError } from '../src/shared/preflightErrors';
describe('operator-facing startup errors', () => {
  it('does not expose encoded commands or PowerShell stack output', () => {
    expect(preflightError(new Error('Command failed: powershell.exe -EncodedCommand SECRET\nCategoryInfo: failed'))).not.toContain('SECRET');
    expect(preflightError('x'.repeat(500))).toContain('日志');
  });
  it('keeps actionable messages through the Electron error envelope', () => {
    expect(preflightError(new Error("Error invoking remote method 'preflight:launch': Error: 请先设置快捷方式或程序路径"))).toBe('请先设置快捷方式或程序路径');
    expect(preflightError(new Error('EPERM: access denied'))).toContain('相同权限');
    expect(preflightError(new Error('ETIMEDOUT'))).toContain('超时');
    expect(preflightError(new Error('The operation was aborted'))).toContain('交回操作权');
  });
});
