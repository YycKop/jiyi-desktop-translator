$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing

function Await-Async {
    param($AsyncOp, [Type]$ResultType)
    $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0].MakeGenericMethod($ResultType)
    $task = $asTask.Invoke($null, @($AsyncOp))
    $task.Wait(-1) | Out-Null
    $task.Result
}

function Await-Action {
    param($AsyncOp)
    $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
    })[0]
    $task = $asTask.Invoke($null, @($AsyncOp))
    $task.Wait(-1) | Out-Null
}

# 1) capture a region with System.Drawing
$out = Join-Path $env:TEMP 'dsh-ocr-probe.png'
$bmp = New-Object System.Drawing.Bitmap 400, 120
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(0, 0, 0, 0, $bmp.Size)
$g.Dispose()
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"capture ok: $out size=$((Get-Item $out).Length)"

# 2) WinRT OCR
$engineType = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
"ocr engine type: $($engineType.FullName)"
$langs = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages
"available languages: " + (($langs | ForEach-Object { $_.LanguageTag }) -join ', ')

$storageFile = [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]
$file = Await-Async ([Windows.Storage.StorageFile]::GetFileFromPathAsync($out)) ([Windows.Storage.StorageFile])
$stream = Await-Async ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])

$bitmapDecoderType = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$decoder = Await-Async ($bitmapDecoderType::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$softwareBitmap = Await-Async ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
"engine: $($engine.RecognizerLanguage.LanguageTag)"
$result = Await-Async ($engine.RecognizeAsync($softwareBitmap)) ([Windows.Media.Ocr.OcrResult])
"OCR TEXT >>>"
$result.Text
"<<< END"
