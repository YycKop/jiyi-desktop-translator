param(
    [string]$Out = "D:\桌面翻译助手\项目测试\reports\tray-shot-1.png",
    [int]$X = 1180,
    [int]$Y = 1032,
    [int]$W = 740,
    [int]$H = 48
)
# ASCII only. Capture a screen rectangle (taskbar / notification area) via GDI.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap $W, $H
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($X, $Y, 0, 0, (New-Object System.Drawing.Size $W, $H))
$gfx.Dispose()
$dir = Split-Path -Parent $Out
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("saved " + $Out)
