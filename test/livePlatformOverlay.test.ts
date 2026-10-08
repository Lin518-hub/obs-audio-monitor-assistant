import {describe,it,expect} from 'vitest';
import {DEFAULT_PROJECTOR_SAFETY as defaults, normalizeProjectorSafety,safetyOverlayHtml} from '../src/shared/projectorSafety';
import {livePlatformOverlaySvg} from '../src/shared/livePlatformOverlay';
describe('anonymous phone UI overlay',()=>{
 it('is opt-in, persists opacity safely and preserves old settings',()=>{
  expect(normalizeProjectorSafety({}).platformOverlayEnabled).toBe(false);
  expect(normalizeProjectorSafety({platformOverlayEnabled:true,platformOverlayOpacity:4}).platformOverlayOpacity).toBe(1);
  expect(normalizeProjectorSafety({platformOverlayOpacity:NaN}).platformOverlayOpacity).toBe(.85);
  expect(safetyOverlayHtml(defaults)).not.toContain('<svg');
 });
 it('keeps screenshot proportions without embedding real images or remote assets',()=>{
  const svg=livePlatformOverlaySvg();expect(svg).toContain('viewBox="0 0 1206 2622"');
  expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
  expect(svg).not.toMatch(/<image|<script|href=|Apple|青橙|9999/);
  expect(svg).toContain('feGaussianBlur');
 });
 it('keeps phone UI full height independently of wide-screen top/bottom crop',()=>{
  const a=safetyOverlayHtml({...defaults,platformOverlayEnabled:true});
  const b=safetyOverlayHtml({...defaults,platformOverlayEnabled:true,verticalAdjustment:25});
  const bounds=(html:string)=>html.match(/\.platform-ui\{[^}]+\}/)?.[0];
  expect(bounds(a)).toBe(bounds(b));expect(bounds(a)).toContain('top:0;bottom:0;left:9.088');
  expect(a).toContain(livePlatformOverlaySvg());
 });
});
