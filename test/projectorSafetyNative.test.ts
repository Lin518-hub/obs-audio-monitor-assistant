import {spawn} from 'node:child_process';
import {describe,expect,it} from 'vitest';
import {PROJECTOR_TRACKER_SCRIPT} from '../src/main/projectorSafetyTracker';
// Windows CI compiles the actual resident helper and checks its first protocol frame.
// Real OBS drag/resize, mixed-DPI monitors and capture exclusion still need interactive QA.
describe.skipIf(process.platform !== 'win32')('native safety tracker',()=>{
 it('compiles Win32 interop and emits a valid target frame',async()=>{
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(PROJECTOR_TRACKER_SCRIPT,'utf16le').toString('base64')],{windowsHide:true});
  try {
   const frame=await new Promise<any>((resolve,reject)=>{
    let output='',errors='';
    const timeout=setTimeout(()=>reject(new Error('Native tracker timeout: '+errors)),20000);
    const fail=(error:Error)=>{clearTimeout(timeout);reject(error);};
    child.on('error',fail);child.on('exit',code=>fail(new Error(`Tracker exited ${code}: ${errors}`)));
    child.stderr.on('data',data=>{errors+=data;});
    child.stdout.on('data',data=>{output+=data;const line=output.split(/\r?\n/)[0];if(!output.includes('\n'))return;try{const frame=JSON.parse(line);clearTimeout(timeout);resolve(frame);}catch{fail(new Error('Invalid tracker frame: '+line));}});
   });
   expect(Array.isArray(frame.targets)).toBe(true);
  } finally {child.kill();}
 },25000);
});
