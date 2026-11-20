param([string]$OutDir)
# Generate OCR fixtures that stress the i/l/1 confusion (ASCII only).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-Image {
    param([string]$Path, [int]$W, [int]$H, [string[]]$Lines, [int]$FontSize, [string]$FontName, [bool]$Dark = $false)
    $bmp = New-Object System.Drawing.Bitmap $W, $H
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.Clear($(if ($Dark) { [System.Drawing.Color]::FromArgb(30, 30, 30) } else { [System.Drawing.Color]::White }))
    $brush = New-Object System.Drawing.SolidBrush $(if ($Dark) { [System.Drawing.Color]::White } else { [System.Drawing.Color]::FromArgb(20, 20, 20) })
    $font = New-Object System.Drawing.Font($FontName, $FontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $y = 12
    foreach ($line in $Lines) {
        $g.DrawString($line, $font, $brush, 14, $y)
        $y += [int]($FontSize * 1.7)
    }
    $font.Dispose(); $brush.Dispose(); $g.Dispose()
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output ("wrote " + $Path + " " + (Get-Item $Path).Length + " bytes")
}

New-Image -Path (Join-Path $OutDir 'il-640x160.png') -W 640 -H 160 `
    -Lines @('Please click the link to fill in your details.', 'This is a little list of items.') `
    -FontSize 20 -FontName 'Segoe UI'

New-Image -Path (Join-Path $OutDir 'il-small-480x90.png') -W 480 -H 90 `
    -Lines @('Click the link, it will fill in.') -FontSize 16 -FontName 'Segoe UI'

New-Image -Path (Join-Path $OutDir 'il-dark-560x120.png') -W 560 -H 120 `
    -Lines @('Log in to see your profile settings.') -FontSize 18 -FontName 'Segoe UI' -Dark $true
