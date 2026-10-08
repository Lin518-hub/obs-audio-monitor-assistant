import { BrowserWindow, screen } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { containedVideoRect, normalizeProjectorSafety, safetyOverlayHtml, type ProjectorSafetyConfig, type ProjectorSafetyStatus } from '../shared/projectorSafety.js';
import { PROJECTOR_TRACKER_SCRIPT } from './projectorSafetyTracker.js';
interface Target { handle: string; title: string; x: number; y: number; width: number; height: number; moving: boolean; covered: boolean }
export class ProjectorSafetyOverlay {
  private config = normalizeProjectorSafety(null);
  private worker: ChildProcessWithoutNullStreams | null = null;
  private window: BrowserWindow | null = null;
  private ready = false;
  private selected = '';
  private signature = '';
  private stableSince = 0;
  private lastFrame = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private previewWindow: BrowserWindow | null = null;
  private status: ProjectorSafetyStatus = {message: '未开启', visible: false, selectedHandle: '', targets: []};
  getStatus() { return this.status; }
  select(handle: string) { this.selected = this.status.targets.some(t => t.handle === handle) ? handle : ''; this.signature = ''; this.hide(); }
  configure(raw: ProjectorSafetyConfig) {
    const next = normalizeProjectorSafety(raw);
    const changed = JSON.stringify(next) !== JSON.stringify(this.config);
    this.config = next;
    if (!next.enabled) { this.stop(); return; }
    if (process.platform !== 'win32') { this.status.message = '自动跟随目前支持 Windows；本机可预览安全区并保存设置'; return; }
    if (changed && this.window) { this.window.destroy(); this.window = null; this.ready = false; }
    if (!this.worker) this.start();
  }
  preview(config: ProjectorSafetyConfig) {
    this.previewWindow?.destroy();
    const c = normalizeProjectorSafety(config);
    this.previewWindow = new BrowserWindow({width: Math.round(Math.min(540, 680 * c.sourceWidth / c.sourceHeight)), height: Math.round(Math.min(680, 540 * c.sourceHeight / c.sourceWidth)), useContentSize: true, title: '投影安全区预览', backgroundColor: '#183b32', autoHideMenuBar: true,
      webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false}});
    const preview = this.previewWindow;
    preview.on('closed', () => { if (this.previewWindow === preview) this.previewWindow = null; });
    const html = safetyOverlayHtml(c).replace('<title>OBS Safety Overlay</title>', '<title>投影安全区预览</title>').replace('<body>', '<body><div style="position:absolute;inset:0;display:grid;place-items:center;color:#d1e4db;font:16px system-ui;text-align:center;background:linear-gradient(150deg,#102e28,#456559)"></div>');
    void this.previewWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() => {});
  }
  stop() {
    const worker = this.worker; this.worker = null; worker?.kill();
    if (this.watchdog) clearInterval(this.watchdog); this.watchdog = null;
    this.window?.destroy(); this.window = null; this.ready = false; this.signature = '';
    this.status = {message: '未开启', visible: false, selectedHandle: '', targets: []};
  }
  destroy() { this.stop(); this.previewWindow?.destroy(); }
  private hide(message?: string) {
    this.window?.hide(); this.status.visible = false;
    if (message) this.status.message = message;
  }
  private start() {
    this.status.message = '正在识别 OBS 投影窗口…'; this.lastFrame = Date.now();
    const worker = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(PROJECTOR_TRACKER_SCRIPT, 'utf16le').toString('base64')], {windowsHide: true});
    this.worker = worker;
    worker.stderr.on('data', () => { if (this.worker === worker) this.hide('窗口识别失败，请关闭后重新开启安全区'); });
    const lines = createInterface({input: worker.stdout});
    lines.on('line', line => {
      if (this.worker !== worker) return;
      try {
        const frame = JSON.parse(line);
        if (!Array.isArray(frame.targets)) return;
        this.lastFrame = Date.now();
        this.track(frame.targets.filter((t: Target) => typeof t.handle === 'string' && typeof t.title === 'string' && [t.x,t.y,t.width,t.height].every(Number.isFinite) && t.width > 0 && t.height > 0));
      } catch { this.hide('窗口状态暂不可用'); }
    });
    const failed = () => { if (this.worker !== worker) return; this.worker = null; lines.close(); if (this.watchdog) clearInterval(this.watchdog); this.watchdog = null; this.hide('窗口跟随已中断，请关闭后重新开启安全区'); };
    worker.on('error', failed); worker.on('exit', failed);
    this.watchdog = setInterval(() => { if (Date.now() - this.lastFrame > 1500) this.hide('正在等待投影窗口响应…'); }, 500);
  }
  private track(targets: Target[]) {
    this.status.targets = targets.map(({handle,title}) => ({handle,title}));
    const preferred = targets.find(t => t.handle === this.selected);
    const matches = this.config.targetTitle ? targets.filter(t => t.title === this.config.targetTitle) : targets;
    const target = preferred ?? (matches.length === 1 ? matches[0] : undefined);
    this.status.selectedHandle = target?.handle ?? '';
    if (!target) { this.signature = ''; this.hide(targets.length ? '请选择目标投影窗口（原目标未找到或存在多个投影）' : '等待 OBS 投影窗口打开'); return; }
    const signature = [target.handle,target.x,target.y,target.width,target.height].join(':');
    if (signature !== this.signature || target.moving) { this.signature = signature; this.stableSince = Date.now(); this.hide('正在移动或缩放，安全区暂时隐藏'); return; }
    if (target.covered && this.config.hideWhenCovered) { this.hide('投影被其他窗口遮挡，安全区暂时隐藏'); return; }
    if (Date.now() - this.stableSince < 280) return;
    if (!this.window) {
      const win = new BrowserWindow({title: 'OBS Safety Overlay', frame: false, transparent: true, backgroundColor: '#00000000', show: false,
        focusable: false, skipTaskbar: true, resizable: false, movable: false, hasShadow: false, alwaysOnTop: true,
        webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false}});
      this.window = win; this.ready = false;
      win.setIgnoreMouseEvents(true); win.setContentProtection(true);
      win.on('closed', () => { if (this.window === win) { this.window = null; this.ready = false; } });
      void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(safetyOverlayHtml(this.config))).then(() => { if (this.window === win) this.ready = true; }).catch(() => this.hide('安全区加载失败，请重新开启'));
    }
    if (!this.ready) return;
    const video = containedVideoRect(target.width, target.height, this.config);
    const bounds = screen.screenToDipRect(null, {x: Math.round(target.x + video.x), y: Math.round(target.y + video.y), width: Math.max(1,Math.round(video.width)), height: Math.max(1,Math.round(video.height))});
    const current = this.window.getBounds();
    if (Object.keys(bounds).some(k => bounds[k as keyof typeof bounds] !== current[k as keyof typeof current])) this.window.setBounds(bounds);
    if (!this.window.isVisible()) this.window.showInactive();
    this.status.visible = true; this.status.message = '安全区已对齐 · 拖动或缩放时自动隐藏';
  }
}
