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
 it('restores enabled state while waiting for a late projector and reacquires a changed title',async()=>{
  overlay.configure({...defaults,enabled:true,targetTitle:'Old projector title'});
  await frame([]);expect(overlay.getStatus().visible).toBe(false);
  await frame([target]);now+=300;await frame([target]);await frame([target]);
  expect(overlay.getStatus().visible).toBe(true);
  await frame([]);
  const reopened={...target,handle:'99',title:'Windowed Projector (Output)'};
  await frame([reopened]);now+=300;await frame([reopened]);await frame([reopened]);
  expect(overlay.getStatus().selectedHandle).toBe('99');
  expect(overlay.getStatus().visible).toBe(true);
 });
 it('automatically restarts a failed worker but cancels recovery when manually disabled',async()=>{
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','setInterval','clearInterval']});
  try {
   const old=state.worker;old.emit('exit',1);
   await vi.advanceTimersByTimeAsync(1000);
   expect(state.worker).not.toBe(old);
   const replacement=state.worker;replacement.emit('exit',1);
   overlay.configure({...defaults,enabled:false});
   await vi.advanceTimersByTimeAsync(31000);
   expect(state.worker).toBe(replacement);
   expect(overlay.getStatus().message).toBe('未开启');
  } finally {vi.useRealTimers();}
 });
 it('does not start tracking after restoring a disabled configuration',()=>{
  overlay.destroy();
  const previous=state.worker;
  overlay=new ProjectorSafetyOverlay();overlay.configure({...defaults,enabled:false});
  expect(state.worker).toBe(previous);expect(overlay.getStatus().visible).toBe(false);
 });
 it('waits for stability, hides during native resizing, then realigns',async()=>{
  await frame([target]);expect(state.windows).toHaveLength(0);
  now+=300;await frame([target]);await frame([target]);expect(overlay.getStatus().visible).toBe(true);
  const window=state.windows[0];expect(window.bounds).toEqual({x:100,y:100,width:540,height:960});
  await frame([{...target,moving:true}]);expect(window.visible).toBe(false);
  now+=100;await frame([{...target,x:200}]);expect(window.visible).toBe(false);
  now+=300;await frame([{...target,x:200}]);expect(window.visible).toBe(true);expect(window.bounds.x).toBe(200);
  expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
 });
 it('hides when covered only when enabled, missing or the helper exits',async()=>{
  overlay.configure({...defaults,enabled:true,hideWhenCovered:true});
  await frame([target]);now+=300;await frame([target]);await frame([target]);
  await frame([{...target,covered:true}]);expect(overlay.getStatus().visible).toBe(false);
  await frame([target]);expect(overlay.getStatus().visible).toBe(true);
  await frame([]);expect(overlay.getStatus().visible).toBe(false);
  state.worker.emit('exit',1);expect(overlay.getStatus().message).toContain('中断');
 });
 it('keeps the overlay usable when overlap is reported by default',async()=>{
  await frame([{...target,covered:true}]);now+=300;await frame([{...target,covered:true}]);await frame([{...target,covered:true}]);
  expect(overlay.getStatus().visible).toBe(true);
  await frame([{...target,covered:true,moving:true}]);expect(overlay.getStatus().visible).toBe(false);
 });
 it('requires selection for multiple windows and cleans up on disable',async()=>{
  await frame([target,{...target,handle:'2'}]);now+=500;await frame([target,{...target,handle:'2'}]);expect(state.windows).toHaveLength(0);
  overlay.select('2');await frame([target,{...target,handle:'2'}]);now+=300;await frame([target,{...target,handle:'2'}]);await frame([target,{...target,handle:'2'}]);
  expect(overlay.getStatus().selectedHandle).toBe('2');expect(overlay.getStatus().visible).toBe(true);
  overlay.configure(defaults);expect(state.worker.kill).toHaveBeenCalled();expect(state.windows[0].destroyed).toBe(true);
 });
});
