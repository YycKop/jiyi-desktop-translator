# Probe: does the notification area accept a NATIVE WinForms NotifyIcon?
# If native works but Electron does not, the problem is Electron/Tray; if neither works, it is the shell environment.
# ASCII only on purpose: Windows PowerShell 5.1 reads BOM-less files as ANSI.
param(
    [string]$Icon = 'D:\桌面翻译助手\项目代码\assets\app.ico'
)
$ErrorActionPreference = 'Continue'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class TrayProbe {
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern IntPtr FindWindow(string cls, string win);
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string win);
    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    public const int TB_BUTTONCOUNT = 0x0418;

    public static int CountToolbar(IntPtr hTray) {
        if (hTray == IntPtr.Zero) return -1;
        IntPtr notify = FindWindowEx(hTray, IntPtr.Zero, "TrayNotifyWnd", null);
        if (notify == IntPtr.Zero) return -2;
        IntPtr pager = FindWindowEx(notify, IntPtr.Zero, "SysPager", null);
        IntPtr toolbar = IntPtr.Zero;
        if (pager != IntPtr.Zero) toolbar = FindWindowEx(pager, IntPtr.Zero, "ToolbarWindow32", null);
        if (toolbar == IntPtr.Zero) toolbar = FindWindowEx(notify, IntPtr.Zero, "ToolbarWindow32", null);
        if (toolbar == IntPtr.Zero) return -3;
        return (int)SendMessage(toolbar, TB_BUTTONCOUNT, IntPtr.Zero, IntPtr.Zero);
    }

    public static int CountOverflow() {
        IntPtr ov = FindWindow("NotifyIconOverflowWindow", null);
        if (ov == IntPtr.Zero) return -1;
        IntPtr toolbar = FindWindowEx(ov, IntPtr.Zero, "ToolbarWindow32", null);
        if (toolbar == IntPtr.Zero) return -2;
        return (int)SendMessage(toolbar, TB_BUTTONCOUNT, IntPtr.Zero, IntPtr.Zero);
    }
}
'@

if (-not (Test-Path -LiteralPath $Icon)) {
    Write-Output ("MISSING icon: " + $Icon)
    exit 2
}

$tray = [TrayProbe]::FindWindow('Shell_TrayWnd', $null)
Write-Output ("Shell_TrayWnd = " + $tray)
Write-Output ("before: tray=" + [TrayProbe]::CountToolbar($tray) + " overflow=" + [TrayProbe]::CountOverflow())

try {
    $ico = New-Object System.Drawing.Icon($Icon, 32, 32)
} catch {
    Write-Output ("icon load failed: " + $_.Exception.Message)
    exit 3
}

$ni = New-Object System.Windows.Forms.NotifyIcon
$ni.Icon = $ico
$ni.Text = 'TrayProbe'
$ni.Visible = $true
Write-Output ("NotifyIcon.Visible = " + $ni.Visible)

Start-Sleep -Seconds 2
Write-Output ("after 2s: tray=" + [TrayProbe]::CountToolbar($tray) + " overflow=" + [TrayProbe]::CountOverflow())
Start-Sleep -Seconds 3
Write-Output ("after 5s: tray=" + [TrayProbe]::CountToolbar($tray) + " overflow=" + [TrayProbe]::CountOverflow())

$ni.Visible = $false
$ni.Dispose()
Start-Sleep -Milliseconds 500
Write-Output ("after hide: tray=" + [TrayProbe]::CountToolbar($tray) + " overflow=" + [TrayProbe]::CountOverflow())
Write-Output 'probe done'
