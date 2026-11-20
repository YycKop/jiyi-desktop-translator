param(
    [Parameter(Mandatory = $true)][string]$Dest
)
# ASCII only: the destination path arrives as a command-line argument (Unicode-safe),
# never as a string literal inside this file.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

New-Item -ItemType Directory -Force -Path $Dest | Out-Null

$found = Get-ChildItem -Path 'D:\' -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    Get-ChildItem -Path $_.FullName -Directory -Recurse -Depth 3 -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq 'models' -and $_.FullName -match 'ocr-rapid' }
}

if (-not $found) {
    Write-Output 'NO-SOURCE'
    exit 0
}

foreach ($d in $found) {
    Write-Output ("SOURCE: " + $d.FullName)
    foreach ($f in Get-ChildItem -Path $d.FullName -File) {
        $target = Join-Path $Dest $f.Name
        Copy-Item -Path $f.FullName -Destination $target -Force
        Write-Output ("  copied {0} -> {1} bytes" -f $f.Name, (Get-Item $target).Length)
    }
    $root = Split-Path -Parent (Split-Path -Parent $d.FullName)
    $top = Split-Path -Parent $root
    Write-Output ("  stray tree: " + $top)
}

Write-Output '=== dest ==='
Get-ChildItem -Path $Dest -File | ForEach-Object { Write-Output ("  {0}  {1}" -f $_.Name, $_.Length) }
