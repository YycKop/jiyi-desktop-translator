$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
# Tray counter probe: counts notification-area toolbar buttons (before / during / after an app shows a tray icon).
Add-Type -Namespace Tb -Name Api -MemberDefinition @'
[DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr FindWindow(string c, string n);
[DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string n);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
'@
$NULL = [NullString]::Value

function Get-TrayCounts {
    $tray = [Tb.Api]::FindWindow('Shell_TrayWnd', $NULL)
    $notify = if ($tray -ne [IntPtr]::Zero) { [Tb.Api]::FindWindowEx($tray, [IntPtr]::Zero, 'TrayNotifyWnd', $NULL) } else { [IntPtr]::Zero }
    $pager = if ($notify -ne [IntPtr]::Zero) { [Tb.Api]::FindWindowEx($notify, [IntPtr]::Zero, 'SysPager', $NULL) } else { [IntPtr]::Zero }
    $toolbar = if ($pager -ne [IntPtr]::Zero) { [Tb.Api]::FindWindowEx($pager, [IntPtr]::Zero, 'ToolbarWindow32', $NULL) } else { [IntPtr]::Zero }
    $t = if ($toolbar -ne [IntPtr]::Zero) { [int][Tb.Api]::SendMessage($toolbar, 0x0418, [IntPtr]::Zero, [IntPtr]::Zero) } else { -1 }

    $ov = [Tb.Api]::FindWindow('NotifyIconOverflowWindow', $NULL)
    $ovbar = if ($ov -ne [IntPtr]::Zero) { [Tb.Api]::FindWindowEx($ov, [IntPtr]::Zero, 'ToolbarWindow32', $NULL) } else { [IntPtr]::Zero }
    $o = if ($ovbar -ne [IntPtr]::Zero) { [int][Tb.Api]::SendMessage($ovbar, 0x0418, [IntPtr]::Zero, [IntPtr]::Zero) } else { -1 }

    return [pscustomobject]@{
        shell   = $tray.ToInt64()
        notify  = $notify.ToInt64()
        pager   = $pager.ToInt64()
        toolbar = $toolbar.ToInt64()
        tray    = $t
        overflow = $o
    }
}

$before = Get-TrayCounts
Write-Output ("BEFORE tray={0} overflow={1} shell={2} notify={3} pager={4} toolbar={5}" -f $before.tray, $before.overflow, $before.shell, $before.notify, $before.pager, $before.toolbar)

# 启动 Electron 托盘探针（1s 后创建 Tray，5s 后销毁退出）
$env:ELECTRON_RUN_AS_NODE = $null
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$exe = "D:\桌面翻译助手\项目代码\node_modules\electron\dist\electron.exe"
$ud = "D:\桌面翻译助手\项目测试\_runtime\tray-probe-ud"
New-Item -ItemType Directory -Force -Path $ud | Out-Null
$outFile = "D:\桌面翻译助手\项目测试\_runtime\tray-probe.out.log"
$errFile = "D:\桌面翻译助手\项目测试\_runtime\tray-probe.err.log"
$p = Start-Process -FilePath $exe -ArgumentList @("D:\桌面翻译助手\项目测试\tools\tray-probe-electron.js", '--no-sandbox', '--disable-gpu', "--user-data-dir=$ud") -PassThru -NoNewWindow -RedirectStandardOutput $outFile -RedirectStandardError $errFile

for ($i = 1; $i -le 12; $i++) {
    Start-Sleep -Milliseconds 600
    $c = Get-TrayCounts
    Write-Output ("t={0:n1}s tray={1} overflow={2}" -f ($i * 0.6), $c.tray, $c.overflow)
}
$p.WaitForExit(6000) | Out-Null
Write-Output "--- probe stdout ---"
Get-Content $outFile -Encoding UTF8 -ErrorAction SilentlyContinue | Out-String
Write-Output "--- probe stderr (tail) ---"
Get-Content $errFile -Encoding UTF8 -ErrorAction SilentlyContinue | Select-Object -Last 5 | Out-String
