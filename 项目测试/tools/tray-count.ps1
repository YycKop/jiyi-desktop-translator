param(
    [string]$Out = "D:\ta-count.txt"
)
# ASCII only, BOM-free is fine (no non-ASCII literals).
# Count buttons on every notification-area ToolbarWindow32 using IntPtr handles
# (the earlier probe used Python-style 'int' signatures, which truncate 64-bit HWNDs).
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class TrayCount {
    [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool IsWindowVisible(IntPtr h);
    public const uint TB_BUTTONCOUNT = 0x0418;

    public static List<string> Dump(IntPtr parent, int depth, int maxDepth) {
        var rows = new List<string>();
        if (depth > maxDepth) { return rows; }
        IntPtr child = IntPtr.Zero;
        while (true) {
            child = FindWindowEx(parent, child, null, null);
            if (child == IntPtr.Zero) { break; }
            var cls = new StringBuilder(256);
            GetClassName(child, cls, 256);
            var txt = new StringBuilder(256);
            GetWindowText(child, txt, 256);
            string extra = "";
            if (cls.ToString() == "ToolbarWindow32") {
                IntPtr n = SendMessage(child, TB_BUTTONCOUNT, IntPtr.Zero, IntPtr.Zero);
                extra = " buttons=" + n.ToInt64();
            }
            rows.Add(new string(' ', depth * 2) + "0x" + child.ToInt64().ToString("X") +
                     " " + cls + " '" + txt + "' vis=" + IsWindowVisible(child) + extra);
            rows.AddRange(Dump(child, depth + 1, maxDepth));
        }
        return rows;
    }
}
"@
$lines = New-Object System.Collections.Generic.List[string]
$shell = [TrayCount]::FindWindow("Shell_TrayWnd", $null)
$lines.Add("Shell_TrayWnd=0x" + $shell.ToInt64().ToString("X"))
$lines.AddRange([TrayCount]::Dump($shell, 1, 4))
$over = [TrayCount]::FindWindow("NotifyIconOverflowWindow", $null)
$lines.Add("NotifyIconOverflowWindow=0x" + $over.ToInt64().ToString("X"))
if ($over -ne [IntPtr]::Zero) { $lines.AddRange([TrayCount]::Dump($over, 1, 4)) }
$top = [TrayCount]::FindWindow("TopLevelWindowForOverflowXamlIsland", $null)
$lines.Add("TopLevelWindowForOverflowXamlIsland=0x" + $top.ToInt64().ToString("X"))
if ($top -ne [IntPtr]::Zero) { $lines.AddRange([TrayCount]::Dump($top, 1, 4)) }
$lines | Set-Content -Path $Out -Encoding UTF8
$lines | ForEach-Object { Write-Output $_ }
