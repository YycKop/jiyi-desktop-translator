$ErrorActionPreference = 'Continue'
# ASCII only. Download PP-OCRv4 ONNX models + dict from ModelScope into runtime\ocr-rapid.
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$root = 'D:\桌面翻译助手\项目代码\runtime\ocr-rapid'
New-Item -ItemType Directory -Force -Path $root | Out-Null
New-Item -ItemType Directory -Force -Path "$root\models" | Out-Null

$base = 'https://modelscope.cn/api/v1/models/RapidAI/RapidOCR/repo?Revision=master&FilePath='

$items = @(
    @{ file = 'onnx/PP-OCRv4/det/ch_PP-OCRv4_det_mobile.onnx'; out = "$root\models\ch_PP-OCRv4_det_mobile.onnx"; size = 4745517 },
    @{ file = 'onnx/PP-OCRv4/rec/ch_PP-OCRv4_rec_mobile.onnx'; out = "$root\models\ch_PP-OCRv4_rec_mobile.onnx"; size = 10857958 },
    @{ file = 'onnx/PP-OCRv4/cls/ch_ppocr_mobile_v2.0_cls_mobile.onnx'; out = "$root\models\ch_ppocr_mobile_v2.0_cls_mobile.onnx"; size = 585532 },
    @{ file = 'paddle/PP-OCRv4/rec/ch_PP-OCRv4_rec_mobile/ppocr_keys_v1.txt'; out = "$root\models\ppocr_keys_v1.txt"; size = 26249 }
)

foreach ($it in $items) {
    $url = $base + $it.file
    for ($i = 1; $i -le 4; $i++) {
        & curl.exe -sS --ssl-no-revoke -L -o $it.out $url 2>&1 | Out-Null
        $len = if (Test-Path $it.out) { (Get-Item $it.out).Length } else { 0 }
        if ($len -eq $it.size) { break }
        Start-Sleep -Seconds 2
    }
    $len = if (Test-Path $it.out) { (Get-Item $it.out).Length } else { 0 }
    Write-Output ("{0} -> {1} / {2}  {3}" -f $it.file, $len, $it.size, $(if ($len -eq $it.size) { 'OK' } else { 'SIZE-MISMATCH' }))
}

Write-Output "=== manifest ==="
Get-ChildItem -Recurse -File $root | ForEach-Object { Write-Output ("{0}`t{1}" -f $_.FullName, $_.Length) }
