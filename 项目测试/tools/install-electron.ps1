param(
    [Parameter(Mandatory = $true)][string]$Dir
)
# NOTE: ASCII only. Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI,
# so non-ASCII literals must be passed as parameters instead.
$ErrorActionPreference = 'Stop'

$node = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$pnpm = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"

Set-Location $Dir
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:npm_config_registry = "https://registry.npmmirror.com/"

Write-Output "== cwd =="
(Get-Location).Path

Write-Output "== registry -> npmmirror (project .npmrc) =="
& $node $pnpm config set registry https://registry.npmmirror.com/ --location project 2>&1 | Out-String

Write-Output "== pnpm add -D electron =="
& $node $pnpm add -D electron 2>&1 | Out-String

Write-Output "== verify =="
$exe = Join-Path $Dir "node_modules\electron\dist\electron.exe"
if (Test-Path $exe) {
    Write-Output "electron.exe OK"
    & $node -e "console.log('electron version:', require('electron/package.json').version)"
} else {
    Write-Output "electron.exe MISSING"
    exit 2
}
