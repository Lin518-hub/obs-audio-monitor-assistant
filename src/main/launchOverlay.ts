import { BrowserWindow, screen } from 'electron';
import type { PreflightProgress } from '../shared/types.js';

/** Independent desktop windows keep the controls reachable while apps are moving. */
export class LaunchOverlay {
  private windows: BrowserWindow[] = [];
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private progress: PreflightProgress = { message: '正在检查启动路径与运行状态', percent: 0 };
  constructor(private preload: string, private load: (window: BrowserWindow) => void, private cancel: () => void) {}
  state(): PreflightProgress { return this.progress; }
  show(): void {
    this.close();
    this.progress = { message: '正在检查启动路径与运行状态', percent: 0, startedAt: Date.now() };
    for (const display of screen.getAllDisplays()) {
      const window = new BrowserWindow({ ...display.bounds, frame: false, transparent: true, backgroundColor: '#00000000', show: false,
        resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: true, enableLargerThanScreen: true, hasShadow: false, skipTaskbar: true, alwaysOnTop: true,
        webPreferences: { preload: this.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
      this.windows.push(window);
      window.setAlwaysOnTop(true, 'screen-saver');
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      window.once('ready-to-show', () => {
        if (window.isDestroyed()) return;
        window.show();
        if (process.platform === 'darwin') window.setSimpleFullScreen(true);
        else window.setBounds(display.bounds);
      });
      window.on('close', () => { if (this.windows.includes(window)) this.cancel(); });
      window.webContents.on('render-process-gone', () => this.cancel());
      window.webContents.on('unresponsive', () => this.cancel());
      window.webContents.on('did-fail-load', () => this.cancel());
      this.load(window);
    }
    this.watchdog = setTimeout(() => this.cancel(), 180_000);
  }
  report(message: string, percent: number): void {
    this.progress = { ...this.progress, message, percent };
    for (const window of this.windows) if (!window.isDestroyed()) window.webContents.send('preflight:progress', this.progress);
  }
  close(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    const windows = this.windows;
    this.windows = [];
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
  }
}
