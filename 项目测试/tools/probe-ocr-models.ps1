$ErrorActionPreference = 'Continue'
# ASCII only. Probe candidate ONNX OCR model URLs (ModelScope mirrors first, then GitHub).
$targets = @(
    'https://modelscope.cn/api/v1/models/RapidAI/RapidOCR/repo?Revision=master&FilePath=onnx/PP-OCRv4/ch_PP-OCRv4_det_infer.onnx',
    'https://modelscope.cn/api/v1/models/SWHL/RapidOCR/repo?Revision=master&FilePath=onnx/PP-OCRv4/ch_PP-OCRv4_det_infer.onnx',
    'https://modelscope.cn/api/v1/models/RapidAI/RapidOCR/repo?Revision=master&FilePath=README.md',
    'https://modelscope.cn/api/v1/models/demo-paddle-ocr/ch_PP-OCRv4_det_infer/repo?Revision=master&FilePath=ch_PP-OCRv4_det_infer.onnx',
    'https://github.com/RapidAI/RapidOCR/releases/download/v1.3.0/ch_PP-OCRv4_det_infer.onnx',
    'https://ghproxy.net/https://github.com/RapidAI/RapidOCR/releases/download/v1.3.0/ch_PP-OCRv4_det_infer.onnx'
)
foreach ($t in $targets) {
    $code = & curl.exe -sS -o NUL -w '%{http_code} %{size_download}' --ssl-no-revoke -I --max-time 25 $t 2>$null
    Write-Output ("{0}  <- {1}" -f $code, $t)
}
