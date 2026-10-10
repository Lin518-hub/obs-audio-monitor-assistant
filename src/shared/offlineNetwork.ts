import {isIP} from 'node:net';
/** No DNS resolution or public addresses in the offline ATEM transport. */
export function requireLanHost(host: string): string {
  const value = host.trim();
  if (isIP(value) === 4) {
    const [a,b] = value.split('.').map(Number);
    if (a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)) return value;
  }
  throw new Error('离线版 ATEM 仅允许局域网 IPv4 地址，例如 192.168.1.100');
}

export function offlineRendererUrlAllowed(value: string): boolean {
  try {
    const url = new URL(value);
    if (['file:', 'data:', 'about:'].includes(url.protocol)) return true;
    return ['http:', 'ws:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch { return false; }
}
