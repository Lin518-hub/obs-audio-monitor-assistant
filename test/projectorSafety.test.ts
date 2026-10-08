import {describe,it,expect} from 'vitest';
import {DEFAULT_PROJECTOR_SAFETY as defaults, normalizeProjectorSafety, safetyInsets, containedVideoRect, safetyOverlayHtml} from '../src/shared/projectorSafety';
describe('projector safety geometry',()=>{
 it('uses centered fill for narrow and wide portrait screens',()=>{
  const inset=safetyInsets(defaults);
  expect(inset.side).toBeCloseTo((1-(1320/2868)/(9/16))/2,10);
  expect(inset.vertical).toBeCloseTo((1-(9/16)/(1320/2232))/2,10);
  expect(inset.side*1080).toBeCloseTo(98.16,1);
  expect(inset.vertical*1920).toBeCloseTo(46.91,1);
 });
 it('does not invent crop in the opposite orientation',()=>{
  expect(safetyInsets({...defaults,phoneWidth:9,phoneHeight:16,wideWidth:9,wideHeight:16})).toEqual({side:0,vertical:0});
  expect(safetyInsets({...defaults,phoneWidth:16,phoneHeight:9,wideWidth:1,wideHeight:3})).toEqual({side:0,vertical:0});
 });
 it('fits video to the client area without covering letterbox bars',()=>{
  expect(containedVideoRect(1920,1080,defaults)).toEqual({x:656.25,y:0,width:607.5,height:1080});
  expect(containedVideoRect(540,1000,defaults)).toEqual({x:0,y:20,width:540,height:960});
 });
 it('normalizes corrupted settings and clamps calibration',()=>{
  const c=normalizeProjectorSafety({sourceWidth:0,phoneHeight:Infinity,opacity:2,enabled:'true',targetTitle:'<script>'});
  expect(c.sourceWidth).toBe(1);expect(c.phoneHeight).toBe(2868);expect(c.opacity).toBe(.8);expect(c.enabled).toBe(false);
  expect(safetyInsets({...defaults,sideAdjustment:-25}).side).toBe(0);
  expect(safetyInsets({...defaults,phoneWidth:1,sideAdjustment:25}).side).toBe(.45);
 });
 it('renders a transparent center without script or user supplied markup',()=>{
  const html=safetyOverlayHtml({...defaults,targetTitle:'<script>alert(1)</script>',labels:false});
  expect(html).not.toContain('<script>');expect(html).not.toContain('手机裁切区');
  expect(html).toContain('background:transparent');expect(html).toContain("default-src 'none'");
 });
});
