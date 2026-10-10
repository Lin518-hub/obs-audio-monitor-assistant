import {expect,it} from 'vitest';
import {requireLanHost,offlineRendererUrlAllowed} from '../src/shared/offlineNetwork';
it('allows LAN ATEM without resolving public hosts',()=>{
 for(const host of ['192.168.1.1','10.1.2.3','172.16.0.1','169.254.1.1'])expect(requireLanHost(host)).toBe(host);
 for(const host of ['8.8.8.8','192.0.2.1','example.com','192.168.1.1.example.com','172.32.0.1'])expect(()=>requireLanHost(host)).toThrow();
});
it('blocks remote renderer requests but permits local application assets and development',()=>{
 for(const url of ['https://example.com','wss://example.com','http://192.168.1.1','http://127.0.0.1.example.com','ftp://localhost'])expect(offlineRendererUrlAllowed(url)).toBe(false);
 for(const url of ['file:///app/index.html','about:srcdoc','data:text/html,hello','http://127.0.0.1:5173','ws://localhost:5173'])expect(offlineRendererUrlAllowed(url)).toBe(true);
});
