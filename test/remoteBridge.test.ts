import { describe, expect, it } from 'vitest';
import {
  LAN_REMOTE_SERVER_URL,
  PUBLIC_REMOTE_SERVER_URL,
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
});
