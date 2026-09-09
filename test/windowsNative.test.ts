import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { WindowsWindowManager, selectOBSProjectorWindow } from '../src/main/windowsWindowManager';

// Runs on the Windows release runner against real Win32 windows, not UI mocks.
describe.skipIf(process.platform !== 'win32')('Windows native projector layout', () => {
  it('reads Chinese titles and restores output position without moving the OBS main window', async () => {
    const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
$main = New-Object System.Windows.Forms.Form
$main.Text = 'OBS 32.0 - Profile: UI Test'
$main.SetBounds(10,10,640,480)
$projector = New-Object System.Windows.Forms.Form
$projector.Text = '投影 - 输出'
$projector.SetBounds(100,100,480,300)
$preview = New-Object System.Windows.Forms.Form
$preview.Text = '投影 - 预览'
$preview.SetBounds(200,200,480,300)
$main.Show(); $projector.Show(); $preview.Show()
[Console]::WriteLine('READY')
$deadline = [DateTime]::UtcNow.AddSeconds(90)
while ([DateTime]::UtcNow -lt $deadline) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 30 }
`;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Native fixture startup timeout')), 20000);
        child.stdout.on('data', data => { if (String(data).includes('READY')) { clearTimeout(timer); resolve(); } });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Fixture exited: ${code}`)); });
      });
      const manager = new WindowsWindowManager();
      const before = await manager.listWindows([child.pid!]);
      console.log('Native fixture windows:', JSON.stringify(before));
      const projector = selectOBSProjectorWindow(before);
      expect(projector?.title).toBe('投影 - 输出');
      const main = before.find(w => w.title.startsWith('OBS 32'));
      expect(main, JSON.stringify(before)).toBeDefined();
      const bounds = { x: 60, y: 80, width: 520, height: 340 };
      await manager.moveWindow(projector!.handle, bounds, 'normal');
      const after = await manager.listWindows([child.pid!]);
      expect(after.find(w => w.handle === projector!.handle)?.bounds).toEqual(bounds);
      expect(after.find(w => w.handle === main!.handle)?.bounds).toEqual(main!.bounds);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit'); child.kill(); await exited;
      }
    }
  }, 60000);
});
