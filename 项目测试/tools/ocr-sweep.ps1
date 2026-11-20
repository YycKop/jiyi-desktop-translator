param(
    [string]$Script = "",
    [string]$Image = "",
    [string]$OutDir = ""
)
# ASCII only. Sweep -Contrast / -Sharpen / -Scale on one image and print the recognised text.
$ErrorActionPreference = 'Continue'
$combos = @(
    @(2, 0, 0),
    @(2, 0, 30),
    @(2, 0, 50),
    @(2, 0, 70),
    @(2, 160, 0),
    @(2, 160, 40),
    @(3, 0, 50),
    @(2, 0, 85)
)
foreach ($c in $combos) {
    $scale = $c[0]; $sharpen = $c[1]; $contrast = $c[2]
    $out = Join-Path $OutDir ("s{0}-sh{1}-c{2}.json" -f $scale, $sharpen, $contrast)
    & powershell -NoProfile -ExecutionPolicy Bypass -File $Script -ImagePath $Image -OutPath $out -Lang "zh-Hans-CN,en-US" -Scale $scale -Sharpen $sharpen -Contrast $contrast -CacheDir $OutDir 2>&1 | Out-Null
    if (Test-Path $out) {
        $j = Get-Content $out -Raw -Encoding UTF8 | ConvertFrom-Json
        Write-Output ("--- scale=$scale sharpen=$sharpen contrast=$contrast ms=" + $j.ms + " prepFallback=" + $j.prepFallback + " ---")
        Write-Output $j.text
        Remove-Item $out -Force -ErrorAction SilentlyContinue
    } else {
        Write-Output ("--- scale=$scale sharpen=$sharpen contrast=$contrast FAILED ---")
    }
}
