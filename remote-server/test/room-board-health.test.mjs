import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const context = vm.createContext({});
vm.runInContext(await readFile(new URL('../public/assets/room-board-health.js', import.meta.url), 'utf8'), context);
const { classify, bitrate } = context.roomBoardHealth;
const now = 100000;
const device = () => ({ online:true,stateUpdatedAt:now,obs:{connected:true,monitoringActive:true,streaming:true},audio:{inputName:'麦克风',ready:true,levelDb:-90,lastMeterReceivedAt:now,silentForSeconds:0,thresholdDb:-45},atem:{tone:'danger'},app:{version:'3.9.14'} });
test('audio escalation ignores camera state and respects exact boundaries',()=>{for(const [seconds,tone] of [[0,'safe'],[179,'safe'],[180,'danger'],[299,'danger'],[300,'critical']]){const d=device();d.audio.silentForSeconds=seconds;assert.equal(classify(d,{now}).tone,tone);}});
test('offline, stale, OBS disconnected, missing source and missing data stay distinct',()=>{
 const cases=[[d=>d.online=false,'offline'],[d=>d.stateUpdatedAt=0,'stale'],[d=>d.obs.connected=false,'obs-disconnected'],[d=>d.audio.inputName='','no-source'],[d=>d.audio.lastMeterReceivedAt=0,'no-data']];
 for(const [change,code] of cases){const d=device();change(d);d.audio.silentForSeconds=600;assert.equal(classify(d,{now}).code,code);}
});
test('matching live speech clears stale silence and stays clear until new snapshot',()=>{
 const d=device();d.audio.silentForSeconds=600;
 const speech={at:now,inputName:'麦克风'};
 assert.equal(classify(d,{now,meter:{inputName:'麦克风',receivedAt:now,levelDb:-20},speech}).silent,0);
 assert.equal(classify(d,{now:now+1000,speech}).tone,'safe');
 assert.equal(classify(d,{now,meter:{inputName:'其他',receivedAt:now,levelDb:-20}}).tone,'critical');
});
test('bitrate distinguishes old clients, sampling, stopped output and valid zero',()=>{
 const d=device();assert.match(bitrate(d,true).note,/更新/);
 d.app.version='3.9.15';assert.match(bitrate(d,true).note,/采样/);
 d.obs.bitrateKbps=0;assert.equal(bitrate(d,true).value,'0 kbps');
 d.obs.streaming=false;assert.match(bitrate(d,true).note,/未通过/);
});
