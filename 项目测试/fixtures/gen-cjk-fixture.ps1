# ASCII-only generator (PowerShell 5.1 reads BOM-less UTF-8 as ANSI, so Chinese text
# must be passed in as parameters from the caller).
#
# 用法示例（在 pwsh 工具里调用时可以直接写中文）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File gen-cjk-fixture.ps1 `
#     -Out "D:\桌面翻译助手\项目测试\fixtures\cjk-punct-640x200.png" `
#     -Line1 "请点击保存按钮，然后继续。" -Line2 "提示：请勿关闭窗口！" -FontSize 26
param(
    [Parameter(Mandatory = $true)][string]$Out,
    [Parameter(Mandatory = $true)][string]$Line1,
    [Parameter(Mandatory = $true)][string]$Line2,
    [int]$FontSize = 26,
    [int]$Width = 640,
    [int]$Height = 200
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$bmp = New-Object System.Drawing.Bitmap $Width, $Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$font = New-Object System.Drawing.Font 'Microsoft YaHei', $FontSize, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$brush = [System.Drawing.Brushes]::Black
$g.DrawString($Line1, $font, $brush, 16, 24)
$g.DrawString($Line2, $font, $brush, 16, (24 + $FontSize + 16))
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$font.Dispose()
Write-Output ("saved " + $Out + " " + (Get-Item $Out).Length + " bytes")
