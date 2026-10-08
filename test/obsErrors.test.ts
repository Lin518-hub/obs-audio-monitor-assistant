import { describe, expect, it } from 'vitest';
import { obsErrorMessage } from '../src/shared/obsErrors';
describe('OBS connection messages', () => {
  it('explains missing and incorrect passwords', () => {
    expect(obsErrorMessage(new Error("Your payload's data is missing an `authentication` string, however authentication is required."))).toContain('请填写');
    expect(obsErrorMessage(new Error('Authentication failed'))).toContain('密码不正确');
  });
  it('explains unreachable connections without leaking protocol errors', () => {
    expect(obsErrorMessage(new Error('connect ECONNREFUSED 127.0.0.1:4455'))).toContain('连接被拒绝');
    expect(obsErrorMessage(new Error('Unexpected server response: 500'))).toContain('无法连接 OBS');
  });
});
