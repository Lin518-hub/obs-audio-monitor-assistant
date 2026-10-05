import { BrowserWindow, dialog, screen } from 'electron';
import type { WindowsTopLevelWindow } from './windowsWindowManager.js';

/** Highlight only; never focus, move or resize the target application. */
export async function confirmLayoutWindow(label: string, suggested: WindowsTopLevelWindow | null, candidates: WindowsTopLevelWindow[]): Promise<WindowsTopLevelWindow | null> {
  let selected = suggested;
  while (true) {
    if (!selected) {
      if (!candidates.length) { await dialog.showMessageBox({ message: `${label}：未找到可选择的窗口`, detail: '请打开目标软件；若仍未识别，请重新选择正确的程序路径后保存。', buttons: ['返回'] }); return null; }
      let page = 0;
      while (!selected) {
        const items = candidates.slice(page * 6, page * 6 + 6);
        const choice = await dialog.showMessageBox({ title: `选择 ${label} 的窗口`, message: '选择要保存位置的窗口', detail: `第 ${page + 1} / ${Math.ceil(candidates.length / 6)} 页；选择后会高亮供你确认。`, buttons: [...items.map(w => `${w.title.slice(0, 60)}（${w.pid}）`), '下一页', '跳过此项'], cancelId: items.length + 1, noLink: true });
        if (choice.response === items.length + 1) return null;
        if (choice.response === items.length) { page = (page + 1) % Math.ceil(candidates.length / 6); continue; }
        if (!items[choice.response]) return null;
        selected = items[choice.response];
      }
    }
    const bounds = screen.screenToDipRect(null, selected.bounds);
    const highlight = new BrowserWindow({ ...bounds, frame: false, transparent: true, alwaysOnTop: true, focusable: false, skipTaskbar: true, hasShadow: false, show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
    highlight.setIgnoreMouseEvents(true);
    try {
      await highlight.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<html style="box-sizing:border-box;border:5px solid #36d69a;background:rgba(54,214,154,.12);height:100%;border-radius:10px"><body></body></html>'));
      highlight.showInactive();
      const answer = await dialog.showMessageBox({ title: `确认 ${label}`, message: '绿色高亮的是要保存的窗口吗？', detail: selected.title || `窗口 ${selected.handle}`, buttons: ['确认保存', '手动选择其他窗口', '跳过此项'], defaultId: 0, cancelId: 2, noLink: true });
      if (answer.response === 0) return selected;
      if (answer.response === 2) return null;
      selected = null;
    } finally { highlight.destroy(); }
  }
}
