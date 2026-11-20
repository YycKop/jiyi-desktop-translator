param(
    [Parameter(Mandatory = $true)][string]$ImagePath,
    [Parameter(Mandatory = $true)][string]$OutPath,
    [string]$Lang = "",
    [int]$Scale = 2,
    [int]$Sharpen = 0,
    [int]$Contrast = 0,
    [string]$CacheDir = "",
    # Escape hatch used by tests: skip the C# prep stage entirely (pure GDI+ resize).
    [switch]$NoPrep
)
# Windows.Media.Ocr bridge. Keep comments ASCII only: WinPS 5.1 reads ANSI when the file has no BOM,
# and a mis-decoded multi-byte comment can swallow the following code line (that already cost a bug).
# Writes UTF-8 JSON to $OutPath: { ok, engine, lang, text, lines[], ms, error, sharpened, prepFallback, meanLuma }
$ErrorActionPreference = 'Stop'
$sw = [System.Diagnostics.Stopwatch]::StartNew()

function Write-Json {
    param($Obj)
    $json = $Obj | ConvertTo-Json -Depth 8 -Compress
    [System.IO.File]::WriteAllText($OutPath, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Await-Op {
    param($AsyncOp, [Type]$ResultType)
    $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
            $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
            $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
        })[0].MakeGenericMethod($ResultType)
    $task = $asTask.Invoke($null, @($AsyncOp))
    try {
        $task.Wait(-1) | Out-Null
    } catch {
        # AggregateException hides the real cause in InnerException; unwrap it so the log is usable.
        $msg = $_.Exception.Message
        $inner = $_.Exception.InnerException
        while ($null -ne $inner) {
            $msg = $msg + " << " + $inner.GetType().Name + ": " + $inner.Message
            if ($null -ne $inner.InnerException) { $inner = $inner.InnerException } else { break }
        }
        throw ("await=" + $ResultType.Name + " | " + $msg)
    }
    return $task.Result
}

# Image preparation (bicubic upscale + unsharp mask + contrast stretch). See README for the
# measurements: small CJK glyphs need USM, not a bigger scale factor and not polarity inversion.
$prepSource = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class OcrPrep
{
    public static int[] Prepare(string inPath, string outPath, double scale, float amount, float contrast)
    {
        using (var src = new Bitmap(inPath))
        {
            int w = Math.Max(1, (int)Math.Round(src.Width * scale));
            int h = Math.Max(1, (int)Math.Round(src.Height * scale));
            var big = new Bitmap(w, h, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(big))
            {
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.DrawImage(src, 0, 0, w, h);
            }

            var rect = new Rectangle(0, 0, w, h);
            int bytes = w * h * 4;
            BitmapData db = big.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            byte[] a = new byte[bytes];
            Marshal.Copy(db.Scan0, a, 0, bytes);
            big.UnlockBits(db);

            long lumaSum = 0;
            long lumaCount = 0;
            for (int i = 0; i < bytes; i += 28)
            {
                lumaSum += (long)(0.114 * a[i] + 0.587 * a[i + 1] + 0.299 * a[i + 2]);
                lumaCount++;
            }
            int meanLuma = lumaCount > 0 ? (int)(lumaSum / lumaCount) : -1;

            if (amount <= 0f && contrast <= 0f)
            {
                big.Save(outPath, ImageFormat.Png);
                big.Dispose();
                return new int[] { meanLuma, 0 };
            }

            var blurred = new Bitmap(w, h, PixelFormat.Format32bppArgb);
            using (var g2 = Graphics.FromImage(blurred))
            {
                g2.InterpolationMode = InterpolationMode.HighQualityBilinear;
                int sw = Math.Max(1, w / 3);
                int sh = Math.Max(1, h / 3);
                using (var small = new Bitmap(sw, sh))
                {
                    using (var gs = Graphics.FromImage(small))
                    {
                        gs.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        gs.DrawImage(big, 0, 0, sw, sh);
                    }
                    g2.DrawImage(small, 0, 0, w, h);
                }
            }

            BitmapData bb = blurred.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            byte[] b = new byte[bytes];
            Marshal.Copy(bb.Scan0, b, 0, bytes);
            blurred.UnlockBits(bb);
            blurred.Dispose();

            float cf = 1f + contrast / 100f;
            byte[] o = new byte[bytes];
            for (int i = 0; i < bytes; i += 4)
            {
                for (int k = 0; k < 3; k++)
                {
                    float v = a[i + k] + amount * (a[i + k] - b[i + k]);
                    v = (v - 127.5f) * cf + 127.5f;
                    if (v < 0f) { v = 0f; }
                    if (v > 255f) { v = 255f; }
                    o[i + k] = (byte)v;
                }
                o[i + 3] = 255;
            }

            var outBmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
            BitmapData ob = outBmp.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
            Marshal.Copy(o, 0, ob.Scan0, bytes);
            outBmp.UnlockBits(ob);
            big.Dispose();
            outBmp.Save(outPath, ImageFormat.Png);
            outBmp.Dispose();
            return new int[] { meanLuma, 1 };
        }
    }
}
'@

# The C# helper is optional. If compilation is unavailable (locked down PowerShell, missing csc,
# read-only temp) we fall back to plain bicubic scaling so OCR still works with slightly lower
# accuracy instead of reporting OCR_UNAVAILABLE. A compiled copy is cached because multi-pass
# launches two of these processes at once and paying the compiler cost twice is wasteful.
function Initialize-Prep {
    if ($NoPrep) { return $false }
    # No cache dir: fall back to in-memory compilation instead of giving up
    # (slower, but the image prep still applies).
    if (-not $CacheDir) {
        try {
            Add-Type -TypeDefinition $prepSource -ReferencedAssemblies System.Drawing -ErrorAction Stop
            return $true
        } catch { return $false }
    }
    if (-not (Test-Path -LiteralPath $CacheDir)) {
        try { New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null } catch { return $false }
    }
    $dll = Join-Path $CacheDir 'OcrPrep.dll'
    if (Test-Path -LiteralPath $dll) {
        try { Add-Type -Path $dll -ErrorAction Stop; return $true } catch { }
    }
    try {
        Add-Type -TypeDefinition $prepSource -ReferencedAssemblies System.Drawing -OutputAssembly $dll -ErrorAction Stop
        Add-Type -Path $dll -ErrorAction Stop
        return $true
    } catch { }
    try {
        Add-Type -TypeDefinition $prepSource -ReferencedAssemblies System.Drawing -ErrorAction Stop
        return $true
    } catch { return $false }
}

function Resize-Only {
    param([string]$inPath, [string]$outPath, [double]$scale)
    $src = [System.Drawing.Image]::FromFile($inPath)
    try {
        $w = [Math]::Max(1, [int][Math]::Round($src.Width * $scale))
        $h = [Math]::Max(1, [int][Math]::Round($src.Height * $scale))
        $bmp = New-Object System.Drawing.Bitmap $w, $h
        try {
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $g.DrawImage($src, 0, 0, $w, $h)
            $g.Dispose()
            $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $bmp.Dispose() }
    } finally { $src.Dispose() }
}

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    Add-Type -AssemblyName System.Drawing

    if (-not (Test-Path -LiteralPath $ImagePath)) { throw "image not found" }

    $ocrPath = $ImagePath
    $sharpened = $false
    $meanLuma = -1
    $fallback = $false
    if ($Scale -gt 1 -or $Sharpen -gt 0 -or $Contrast -gt 0) {
        $scaleF = [double]$Scale
        if ($scaleF -lt 1) { $scaleF = 1 }
        $ocrPath = $ImagePath + '.prep.png'
        $ready = (-not $NoPrep) -and (Initialize-Prep)
        if ($ready) {
            $info = [OcrPrep]::Prepare($ImagePath, $ocrPath, $scaleF, [float]($Sharpen / 100.0), [float]$Contrast)
            $meanLuma = [int]$info[0]
            $sharpened = ($info[1] -eq 1)
        } else {
            Resize-Only -inPath $ImagePath -outPath $ocrPath -scale $scaleF
            $fallback = $true
        }
    }

    # WinRT projections must be resolved explicitly once before the short type names work.
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]

    # Do not use StorageFile.GetFileFromPathAsync: inside a subprocess spawned by Electron the WinRT
    # file broker rejects temp files with UnauthorizedAccessException. Read bytes into an
    # InMemoryRandomAccessStream instead (same script works from Node and fails from Electron).
    $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Storage.Streams.DataWriter, Windows.Foundation, ContentType = WindowsRuntime]

    if ([string]::IsNullOrEmpty($ocrPath)) { throw "prepared image path is empty" }
    $bytes = [System.IO.File]::ReadAllBytes($ocrPath)
    $memStream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $writer = New-Object Windows.Storage.Streams.DataWriter($memStream)
    $writer.WriteBytes($bytes)
    $written = Await-Op ($writer.StoreAsync()) ([uint32])
    $null = $writer.DetachStream()
    $writer.Dispose()
    $memStream.Seek(0)

    $decoderType = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
    $decoder = Await-Op ($decoderType::CreateAsync($memStream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $softwareBitmap = Await-Op ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

    $engine = $null
    if ($Lang) {
        foreach ($tag in $Lang.Split(',')) {
            $t = $tag.Trim()
            if (-not $t) { continue }
            try {
                $langObj = [Windows.Globalization.Language]::new($t)
                $e = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($langObj)
                if ($null -ne $e) { $engine = $e; break }
            } catch { }
        }
    }
    if ($null -eq $engine) {
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    }
    if ($null -eq $engine) { throw "no OCR engine available" }

    $ocr = Await-Op ($engine.RecognizeAsync($softwareBitmap)) ([Windows.Media.Ocr.OcrResult])

    $lines = @()
    foreach ($line in $ocr.Lines) {
        $words = @()
        foreach ($w in $line.Words) {
            $r = $w.BoundingRect
            $words += @{ t = $w.Text; x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height }
        }
        $lines += @{ text = $line.Text; words = $words }
    }

    Write-Json @{
        ok           = $true
        engine       = 'winrt'
        lang         = $engine.RecognizerLanguage.LanguageTag
        width        = [int]$softwareBitmap.PixelWidth
        height       = [int]$softwareBitmap.PixelHeight
        text         = ($lines | ForEach-Object { $_.text }) -join "`n"
        lines        = $lines
        sharpened    = $sharpened
        prepFallback = $fallback
        meanLuma     = $meanLuma
        ms           = [int]$sw.ElapsedMilliseconds
    }
}
catch {
    Write-Json @{ ok = $false; engine = 'winrt'; error = ($_.Exception.Message); ms = [int]$sw.ElapsedMilliseconds }
    exit 1
}
