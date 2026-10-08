import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
const state=vi.hoisted(()=>({windows:[] as any[], worker:null as any}));
vi.mock('electron',()=>({screen:{screenToDipRect:(_h:unknown,b:unknown)=>b},BrowserWindow:class extends EventEmitter {
 visible=false; bounds={x:0,y:0,width:1,height:1}; destroyed=false;
 constructor(public options:any){super();state.windows.push(this);}
 setIgnoreMouseEvents=vi.fn();setContentProtection=vi.fn();
 loadURL=vi.fn(async()=>{});hide(){this.visible=false;}showInactive(){this.visible=true;}isVisible(){return this.visible;}
 getBounds(){return this.bounds;}setBounds(b:any){this.bounds=b;}destroy(){this.destroyed=true;this.emit('closed');}
}}));
vi.mock('node:child_process',()=>({spawn:vi.fn(()=>{
 const worker=new EventEmitter() as any;worker.stdout=new PassThrough();worker.stderr=new PassThrough();worker.kill=vi.fn();state.worker=worker;return worker;
})}));
import {ProjectorSafetyOverlay} from '../src/main/projectorSafetyOverlay';
import {DEFAULT_PROJECTOR_SAFETY as defaults} from '../src/shared/projectorSafety';
let overlay:ProjectorSafetyOverlay;let now=1000;const platform=Object.getOwnPropertyDescriptor(process,'platform')!;
const target={handle:'1',title:'Windowed Projector (Program)',x:100,y:100,width:540,height:960,moving:false,covered:false};
async function frame(targets:any[]){state.worker.stdout.write(JSON.stringify({targets})+'\n');await new Promise<void>(resolve=>setImmediate(resolve));}
beforeEach(()=>{Object.defineProperty(process,'platform',{value:'win32'});vi.spyOn(Date,'now').mockImplementation(()=>now);now=1000;state.windows=[];overlay=new ProjectorSafetyOverlay();overlay.configure({...defaults,enabled:true});});
afterEach(()=>{overlay.destroy();vi.restoreAllMocks();Object.defineProperty(process,'platform',platform);});
describe('projector safety lifecycle',()=>{
 it('waits for stability, hides during native resizing, then realigns',async()=>{
  await frame([target]);expect(state.windows).toHaveLength(0);
  now+=300;await frame([target]);await frame([target]);expect(overlay.getStatus().visible).toBe(true);
  const window=state.windows[0];expect(window.bounds).toEqual({x:100,y:100,width:540,height:960});
  await frame([{...target,moving:true}]);expect(window.visible).toBe(false);
  now+=100;await frame([{...target,x:200}]);expect(window.visible).toBe(false);
  now+=300;await frame([{...target,x:200}]);expect(window.visible).toBe(true);expect(window.bounds.x).toBe(200);
  expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
 });
 it('hides when covered, missing or the helper exits',async()=>{
  await frame([target]);now+=300;await frame([target]);await frame([target]);
  await frame([{...target,covered:true}]);expect(overlay.getStatus().visible).toBe(false);
  await frame([target]);expect(overlay.getStatus().visible).toBe(true);
  await frame([]);expect(overlay.getStatus().visible).toBe(false);
  state.worker.emit('exit',1);expect(overlay.getStatus().message).toContain('中断');
 });
 it('requires selection for multiple windows and cleans up on disable',async()=>{
  await frame([target,{...target,handle:'2'}]);now+=500;await frame([target,{...target,handle:'2'}]);expect(state.windows).toHaveLength(0);
  overlay.select('2');await frame([target,{...target,handle:'2'}]);now+=300;await frame([target,{...target,handle:'2'}]);await frame([target,{...target,handle:'2'}]);
  expect(overlay.getStatus().selectedHandle).toBe('2');expect(overlay.getStatus().visible).toBe(true);
  overlay.configure(defaults);expect(state.worker.kill).toHaveBeenCalled();expect(state.windows[0].destroyed).toBe(true);
 });
});
