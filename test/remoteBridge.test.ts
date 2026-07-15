import { describe, expect, it } from 'vitest';
import {
  LAN_REMOTE_SERVER_URL,
  PUBLIC_REMOTE_SERVER_URL,
  proxyDirectiveUrl,
  publicPairUrl,
  remoteRouteType,
  remoteServerCandidates
} from '../src/main/RemoteBridge.js';

describe('remote server selection', () => {
  it('prefers the LAN route and falls back to public HTTPS for the built-in service', () => {
    expect(remoteServerCandidates(LAN_REMOTE_SERVER_URL)).toEqual([
      LAN_REMOTE_SERVER_URL,
      PUBLIC_REMOTE_SERVER_URL
    ]);
    expect(remoteServerCandidates(PUBLIC_REMOTE_SERVER_URL)).toEqual([
      LAN_REMOTE_SERVER_URL,
      PUBLIC_REMOTE_SERVER_URL
    ]);
  });

  it('does not rewrite a custom remote server', () => {
    expect(remoteServerCandidates('https://remote.example.com/control/')).toEqual([
      'https://remote.example.com/control'
    ]);
  });

  it('labels LAN, public and custom service routes', () => {
    expect(remoteRouteType(LAN_REMOTE_SERVER_URL)).toBe('lan');
    expect(remoteRouteType(PUBLIC_REMOTE_SERVER_URL)).toBe('public');
    expect(remoteRouteType('https://remote.example.com')).toBe('custom');
  });

  it('rewrites a cached LAN pairing link to the public HTTPS endpoint', () => {
    expect(publicPairUrl(`${LAN_REMOTE_SERVER_URL}/pair/example-token`)).toBe(
      `${PUBLIC_REMOTE_SERVER_URL}/pair/example-token`
    );
    expect(publicPairUrl('https://remote.example.com/pair/example-token')).toBe(
      'https://remote.example.com/pair/example-token'
    );
  });
});

describe('system proxy routing', () => {
  it('uses the first supported proxy directive', () => {
    expect(proxyDirectiveUrl('PROXY 127.0.0.1:7890; DIRECT')).toBe('http://127.0.0.1:7890');
    expect(proxyDirectiveUrl('SOCKS5 127.0.0.1:1080; DIRECT')).toBe('socks5://127.0.0.1:1080');
  });

  it('keeps direct connections agent-free', () => {
    expect(proxyDirectiveUrl('DIRECT')).toBeNull();
  });
});
