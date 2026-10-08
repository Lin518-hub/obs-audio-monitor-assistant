import { livePlatformOverlaySvg } from './livePlatformOverlay.js';
/** Ratios describe the rectangular screen in portrait orientation, not platform UI. */
export interface ProjectorSafetyConfig {
  enabled: boolean;
  platformOverlayEnabled: boolean;
  platformOverlayOpacity: number;
  sourceWidth: number;
  sourceHeight: number;
  phoneWidth: number;
  phoneHeight: number;
  wideWidth: number;
  wideHeight: number;
  opacity: number;
  labels: boolean;
  sideAdjustment: number;
  verticalAdjustment: number;
  targetTitle: string;
}
export const DEFAULT_PROJECTOR_SAFETY: ProjectorSafetyConfig = {
  enabled: false, platformOverlayEnabled: false, platformOverlayOpacity: 0.85, sourceWidth: 1080, sourceHeight: 1920,
  phoneWidth: 1320, phoneHeight: 2868, wideWidth: 1320, wideHeight: 2232,
  opacity: 0.35, labels: true, sideAdjustment: 0, verticalAdjustment: 0, targetTitle: ''
};
export function normalizeProjectorSafety(raw: unknown): ProjectorSafetyConfig {
  const value = raw && typeof raw === 'object' ? raw as Partial<ProjectorSafetyConfig> : {};
  const number = (key: keyof ProjectorSafetyConfig, min: number, max: number) => {
    const v = value[key];
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : DEFAULT_PROJECTOR_SAFETY[key] as number;
  };
  return {
    platformOverlayEnabled: value.platformOverlayEnabled === true, platformOverlayOpacity: number('platformOverlayOpacity', 0.15, 1),
    enabled: value.enabled === true, labels: value.labels !== false,
    sourceWidth: number('sourceWidth', 1, 16384), sourceHeight: number('sourceHeight', 1, 16384),
    phoneWidth: number('phoneWidth', 1, 16384), phoneHeight: number('phoneHeight', 1, 16384),
    wideWidth: number('wideWidth', 1, 16384), wideHeight: number('wideHeight', 1, 16384),
    opacity: number('opacity', 0.05, 0.8), sideAdjustment: number('sideAdjustment', -25, 25),
    verticalAdjustment: number('verticalAdjustment', -25, 25),
    targetTitle: typeof value.targetTitle === 'string' ? value.targetTitle.slice(0, 512) : ''
  };
}
export function safetyInsets(config: ProjectorSafetyConfig) {
  const c = normalizeProjectorSafety(config);
  const source = c.sourceWidth / c.sourceHeight;
  const clamp = (n: number) => Math.max(0, Math.min(0.45, n));
  return {
    side: clamp(Math.max(0, (1 - (c.phoneWidth / c.phoneHeight) / source) / 2) + c.sideAdjustment / 100),
    vertical: clamp(Math.max(0, (1 - source / (c.wideWidth / c.wideHeight)) / 2) + c.verticalAdjustment / 100)
  };
}
export function containedVideoRect(width: number, height: number, config: ProjectorSafetyConfig) {
  const c = normalizeProjectorSafety(config);
  const scale = Math.min(width / c.sourceWidth, height / c.sourceHeight);
  const w = c.sourceWidth * scale, h = c.sourceHeight * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}
export interface SafetyTarget { handle: string; title: string }
export interface ProjectorSafetyStatus {
  message: string; visible: boolean; selectedHandle: string; targets: SafetyTarget[];
}
/** No dynamic text is interpolated: the overlay has no script, IPC or remote content. */
export function safetyOverlayHtml(config: ProjectorSafetyConfig) {
  const c = normalizeProjectorSafety(config), inset = safetyInsets(c);
  const side = inset.side * 100, vertical = inset.vertical * 100;
  return `<!doctype html><html><head><meta charset="UTF-8"><title>OBS Safety Overlay</title><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
  *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:system-ui,'Microsoft YaHei',sans-serif}
  .shade{position:absolute;background:rgba(85,91,98,${c.opacity});color:white;font-size:clamp(9px,2.5vw,15px);text-shadow:0 1px 3px #000;display:flex;align-items:center;justify-content:center;overflow:hidden}
  .side{top:0;bottom:0;width:${side}%;writing-mode:vertical-rl;white-space:nowrap;letter-spacing:2px}.left{left:0;border-right:${side > 0 ? 1 : 0}px dashed #ddd}.right{right:0;border-left:${side > 0 ? 1 : 0}px dashed #ddd}
  .horizontal{left:${side}%;right:${side}%;height:${vertical}%;white-space:nowrap}.top{top:0;border-bottom:${vertical > 0 ? 1 : 0}px dashed #ddd}.bottom{bottom:0;border-top:${vertical > 0 ? 1 : 0}px dashed #ddd}
  .label{font-size:clamp(8px,2vw,12px);line-height:1;letter-spacing:1px;max-width:100%;max-height:100%;overflow:hidden}
  .platform-ui{position:absolute;top:0;bottom:0;left:${side}%;right:${side}%;opacity:${c.platformOverlayOpacity};pointer-events:none;overflow:hidden}
  </style></head><body><div class="shade side left">${c.labels && side > 0 ? '<span class="label">手机裁切区域</span>' : ''}</div><div class="shade side right">${c.labels && side > 0 ? '<span class="label">手机裁切区域</span>' : ''}</div><div class="shade horizontal top">${c.labels && vertical > 0 ? '<span class="label">阔直板裁切区域</span>' : ''}</div><div class="shade horizontal bottom">${c.labels && vertical > 0 ? '<span class="label">阔直板裁切区域</span>' : ''}</div>${c.platformOverlayEnabled ? `<div class="platform-ui">${livePlatformOverlaySvg()}</div>` : ''}</body></html>`;
}
