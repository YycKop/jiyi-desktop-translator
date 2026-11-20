param(
    [string]$Out = "D:\tray-counts.txt",
    [string]$Exe = "",
    [string]$UserDataDir = ""
)
# ASCII only. Compare overflow/visible tray button counts with our app stopped vs running.
# NOTE: keep every literal ASCII; the exe path must be passed in via -Exe, otherwise
# PowerShell 5.1 decodes this BOM-less file as ANSI and mangles the Chinese path.
$ErrorActionPreference = 'Continue'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class TrayStat {
    [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    public const uint TB_BUTTONCOUNT = 0x0418;
    public static string Count() {
        IntPtr shell = FindWindow("Shell_TrayWnd", null);
        IntPtr notify = FindWindowEx(shell, IntPtr.Zero, "TrayNotifyWnd", null);
        int upgrade = 0, prompt = 0, overflow = 0;
        IntPtr tb = FindWindowEx(notify, IntPtr.Zero, "ToolbarWindow32", null);
        if (tb != IntPtr.Zero) upgrade = (int)SendMessage(tb, TB_BUTTONCOUNT, IntPtr.Zero, IntPtr.Zero).ToInt64();
        IntPtr pager = FindWindowEx(notify, IntPtr.Zero, "SysPager", null);
        if (pager != IntPtr.Zero) {
            IntPtr tb2 = FindWindowEx(pager, IntPtr.Zero, "ToolbarWindow32", null);
            if (tb2 != IntPtr.Zero) prompt = (int)SendMessage(tb2, TB_BUTTONCOUNT, IntPtr.Zero, IntPtr.Zero).ToInt64();
        }
        IntPtr over = FindWindow("NotifyIconOverflowWindow", null);
        if (over != IntPtr.Zero) {
            IntPtr tb3 = FindWindowEx(over, IntPtr.Zero, "ToolbarWindow32", null);
            if (tb3 != IntPtr.Zero) overflow = (int)SendMessage(tb3, TB_BUTTONCOUNT, IntPtr.Zero, IntPtr.Zero).ToInt64();
        }
        return "upgrade=" + upgrade + " prompt=" + prompt + " overflow=" + overflow;
    }
}
"@
$before = [TrayStat]::Count()
$killed = Get-Process -Name "即译","jiyi-core" -ErrorAction SilentlyContinue
if ($killed) { $killed | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 3 }
$stopped = [TrayStat]::Count()
cmd /c start "" $Exe "--user-data-dir=$UserDataDir" | Out-Null
Start-Sleep -Seconds 12
$running = [TrayStat]::Count()
$lines = @(
    "with app running (before kill): $before",
    "after killing our app:          $stopped",
    "after restarting our app:       $running"
)
$lines | Set-Content -Path $Out -Encoding UTF8
$lines | ForEach-Object { Write-Output $_ }
