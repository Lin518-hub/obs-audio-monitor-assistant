/** One resident helper: no repeated PowerShell launches or C# compilation while tracking. */
export const PROJECTOR_TRACKER_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
public class SafetyWindow {
 public string handle; public string title; public int x; public int y; public int width; public int height; public bool moving; public bool covered;
}
public class SafetyTracker {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left,top,right,bottom; }
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x,y; }
 [StructLayout(LayoutKind.Sequential)] public struct GUI { public int size,flags; public IntPtr active,focus,capture,menu,move,caret; public RECT rect; }
 public delegate bool EnumProc(IntPtr h, IntPtr p);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f,IntPtr p);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h,ref POINT p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint t,ref GUI g);
 [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
 [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h,int a,out int v,int n);
 public static SafetyWindow[] Read() {
  SetThreadDpiAwarenessContext(new IntPtr(-4));
  var result=new List<SafetyWindow>(); var above=new List<RECT>();
  EnumWindows(delegate(IntPtr h,IntPtr p) {
   if(!IsWindowVisible(h)||IsIconic(h)) return true;
   int cloaked; if(DwmGetWindowAttribute(h,14,out cloaked,4)==0 && cloaked!=0) return true;
   var s=new StringBuilder(1024); GetWindowText(h,s,s.Capacity); string title=s.ToString();
   if(title.Length==0 || title=="OBS Safety Overlay") return true;
   RECT outer; if(!GetWindowRect(h,out outer)) return true;
   if(title.IndexOf("projector",StringComparison.OrdinalIgnoreCase)>=0 || title.Contains("投影")) {
    uint pid; uint tid=GetWindowThreadProcessId(h,out pid); string name="";
    try { using(var proc=Process.GetProcessById((int)pid)) name=proc.ProcessName; } catch {}
    if(name.Equals("obs64",StringComparison.OrdinalIgnoreCase)||name.Equals("obs32",StringComparison.OrdinalIgnoreCase)||name.Equals("obs",StringComparison.OrdinalIgnoreCase)) {
     RECT r; POINT origin=new POINT();
     if(GetClientRect(h,out r)&&ClientToScreen(h,ref origin)&&r.right>0&&r.bottom>0) {
      GUI g=new GUI(); g.size=Marshal.SizeOf(typeof(GUI)); GetGUIThreadInfo(tid,ref g);
      bool covered=false;
      foreach(var a in above) if(a.left<origin.x+r.right && a.right>origin.x && a.top<origin.y+r.bottom && a.bottom>origin.y) {covered=true;break;}
      result.Add(new SafetyWindow {handle=h.ToInt64().ToString(),title=title,x=origin.x,y=origin.y,width=r.right,height=r.bottom,moving=(g.flags&2)!=0,covered=covered});
     }
    }
   }
   if(outer.right>outer.left && outer.bottom>outer.top) above.Add(outer);
   return true;
  },IntPtr.Zero);
  return result.ToArray();
 }
}
'@
while($true) {
 $items=@([SafetyTracker]::Read())
 ConvertTo-Json -InputObject @{targets=$items} -Depth 4 -Compress
 Start-Sleep -Milliseconds 80
}
`;
