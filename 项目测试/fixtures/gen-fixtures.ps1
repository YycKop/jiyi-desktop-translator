param(
    [Parameter(Mandatory = $true)][string]$OutDir
)
# Generate SYNTHETIC OCR fixtures (solid background + rendered text only).
# Compliant with SCR-02: no real desktop content is captured or stored.
# ASCII only source.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

function New-Fixture {
    param(
        [string]$Name,
        [int]$Width,
        [int]$Height,
        [string]$Background,
        [string]$Foreground,
        [string]$FontFamily,
        [int]$FontSize,
        [string]$Text,
        [int]$MarginX,
        [int]$LineHeight
    )
    $bmp = New-Object System.Drawing.Bitmap $Width, $Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $bg = [System.Drawing.ColorTranslator]::FromHtml($Background)
    $fg = [System.Drawing.ColorTranslator]::FromHtml($Foreground)
    $g.Clear($bg)
    $font = New-Object System.Drawing.Font($FontFamily, $FontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $brush = New-Object System.Drawing.SolidBrush $fg
    $y = 12
    foreach ($line in $Text.Split('|')) {
        $g.DrawString($line, $font, $brush, $MarginX, $y)
        $y += $LineHeight
    }
    $brush.Dispose()
    $font.Dispose()
    $g.Dispose()
    $path = Join-Path $OutDir $Name
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output ("{0}  {1}x{2}  {3} bytes" -f $Name, $Width, $Height, (Get-Item $path).Length)
}

# 1) 中英混排，白底黑字
New-Fixture -Name 'zh-en-640x200.png' -Width 640 -Height 200 -Background '#FFFFFF' -Foreground '#111111' `
    -FontFamily 'Microsoft YaHei' -FontSize 28 `
    -Text '欢迎使用桌面翻译助手|Hello World, this is a test.' -MarginX 24 -LineHeight 48

# 2) 纯英文
New-Fixture -Name 'en-480x120.png' -Width 480 -Height 120 -Background '#FFFFFF' -Foreground '#000000' `
    -FontFamily 'Segoe UI' -FontSize 22 `
    -Text 'The quick brown fox|jumps over the lazy dog.' -MarginX 18 -LineHeight 40

# 3) 纯中文
New-Fixture -Name 'zh-480x140.png' -Width 480 -Height 140 -Background '#FFFFFF' -Foreground '#000000' `
    -FontFamily 'Microsoft YaHei' -FontSize 26 `
    -Text '桌面翻译助手第一版|开发完成并已测试' -MarginX 20 -LineHeight 46

# 4) 深色背景浅色字（游戏/视频字幕典型场景）
New-Fixture -Name 'dark-640x160.png' -Width 640 -Height 160 -Background '#1E1E1E' -Foreground '#F5F5F5' `
    -FontFamily 'Microsoft YaHei' -FontSize 26 `
    -Text 'Press Save to continue|保存并继续' -MarginX 20 -LineHeight 46

# 5) 小字号（16px，字幕典型字号；14px 以下属已知精度下降区）
New-Fixture -Name 'small-360x90.png' -Width 360 -Height 90 -Background '#FFFFFF' -Foreground '#222222' `
    -FontFamily 'Microsoft YaHei' -FontSize 16 `
    -Text 'Subtitles line one|字幕第一行' -MarginX 12 -LineHeight 32
