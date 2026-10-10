import {expect,it} from 'vitest';
import {verificationMeter} from '../src/shared/setupVerification';
import type {InputMonitorSnapshot} from '../src/shared/types';

const mic = {inputName:'Mic',lastMeterAt:1000,lastLevelDb:-20} as InputMonitorSnapshot;
it('reads the selected input independently of paused/other aggregate meters',()=>{
  const snapshot={connected:true,inputMonitors:[{...mic,inputName:'Other',lastLevelDb:-5},mic],monitoringActive:false,lastLevelDb:null,activeInputName:'Other'};
  expect(verificationMeter(snapshot,'Mic',1100).level).toBe(-20);
  expect(verificationMeter(snapshot,'Missing',1100).level).toBeNull();
});
it('rejects stale, disconnected, non-finite and future samples',()=>{
  expect(verificationMeter({connected:true,inputMonitors:[mic]},'Mic',3000).level).toBeNull();
  expect(verificationMeter({connected:false,inputMonitors:[mic]},'Mic',1100).level).toBeNull();
  expect(verificationMeter({connected:true,inputMonitors:[{...mic,lastLevelDb:NaN}]},'Mic',1100).level).toBeNull();
  expect(verificationMeter({connected:true,inputMonitors:[mic]},'Mic',900).level).toBeNull();
});
