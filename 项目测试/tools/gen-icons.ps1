param(
    [Parameter(Mandatory = $true)][string]$OutDir
)
# ASCII only by design (PowerShell 5.1 without BOM mangles non-ASCII source).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

function New-Icon {
    param([int]$Size, [string]$Path)

    $bmp = New-Object System.Drawing.Bitmap $Size, $Size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $pad = [int]($Size * 0.06)
    $rect = New-Object System.Drawing.Rectangle $pad, $pad, ($Size - 2 * $pad), ($Size - 2 * $pad)
    $radius = [int]($Size * 0.24)
    $path2 = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path2.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
    $path2.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
    $path2.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
    $path2.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
    $path2.CloseFigure()

    $c1 = [System.Drawing.Color]::FromArgb(255, 46, 116, 255)
    $c2 = [System.Drawing.Color]::FromArgb(255, 120, 80, 240)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $c1, $c2, 45
    $g.FillPath($brush, $path2)

    # White "T" mark (kept ASCII to stay encoding-safe)
    $fontSize = [float]($Size * 0.56)
    $font = New-Object System.Drawing.Font "Segoe UI", $fontSize, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = [System.Drawing.StringAlignment]::Center
    $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
    $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $g.DrawString("T", $font, $white, (New-Object System.Drawing.RectangleF 0, 0, $Size, $Size), $fmt)

    $font.Dispose(); $fmt.Dispose(); $white.Dispose(); $brush.Dispose(); $path2.Dispose(); $g.Dispose()
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output ("wrote " + $Path)
}

New-Icon -Size 32 -Path (Join-Path $OutDir 'tray.png')
New-Icon -Size 64 -Path (Join-Path $OutDir 'tray@2x.png')
New-Icon -Size 256 -Path (Join-Path $OutDir 'app.png')
