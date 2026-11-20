param(
    [Parameter(Mandatory = $true)][int]$X,
    [Parameter(Mandatory = $true)][int]$Y,
    [Parameter(Mandatory = $true)][int]$W,
    [Parameter(Mandatory = $true)][int]$H,
    [Parameter(Mandatory = $true)][string]$Out
)
# Region capture via GDI (System.Drawing). ASCII only.
# Coordinates are physical pixels in the virtual screen space.
$ErrorActionPreference = 'Stop'
$sw = [System.Diagnostics.Stopwatch]::StartNew()

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class NativeDpi {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[NativeDpi]::SetProcessDPIAware() | Out-Null

$result = @{ ok = $false; engine = 'gdi'; error = '' }
try {
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap $W, $H
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($X, $Y, 0, 0, (New-Object System.Drawing.Size $W, $H))
    $g.Dispose()
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    $result.width = $bmp.Width
    $result.height = $bmp.Height
    $bmp.Dispose()
    $result.ok = $true
} catch {
    $result.error = $_.Exception.Message
}

$result.ms = [int]$sw.ElapsedMilliseconds
$json = $result | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText($Out + '.json', $json, (New-Object System.Text.UTF8Encoding($false)))
if (-not $result.ok) { exit 1 }
