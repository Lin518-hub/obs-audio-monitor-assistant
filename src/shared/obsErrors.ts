/** User-facing OBS errors; protocol details stay out of setup screens. */
export function obsErrorMessage(error: unknown, fallback = '无法连接 OBS，请确认 OBS 已打开并启用 WebSocket 服务器。'): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/authentication.*required|missing.*authentication/i.test(message)) return 'OBS 已开启密码验证，请填写 OBS WebSocket 密码后重新测试。';
  if (/authentication|authenticate|401|4009/i.test(message)) return 'OBS WebSocket 密码不正确，请在 OBS「工具 → WebSocket 服务器设置」中核对密码。';
  if (/ECONNREFUSED|connection refused/i.test(message)) return '连接被拒绝，请打开 OBS，并确认 WebSocket 服务器已启用、端口填写正确。';
  if (/ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|timed? ?out/i.test(message)) return '无法访问 OBS，请检查主机地址、端口和网络连接。';
  if (/certificate|TLS|SSL/i.test(message)) return 'OBS 连接的安全协议不匹配，请检查服务器地址及连接设置。';
  return /[\u4e00-\u9fff]/.test(message) && !/\n\s*at |Error:|payload/i.test(message) ? message : fallback;
}
