param(
    [Parameter(Mandatory = $true)][string]$Dir,
    [Parameter(Mandatory = $true)][string]$Version
)
# ASCII only by design.
$ErrorActionPreference = 'Stop'
$node = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$pnpm = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"

Set-Location $Dir
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"

Write-Output "== add electron@$Version =="
& $node $pnpm add -D ("electron@" + $Version) 2>&1 | Out-String

Write-Output "== run install.js =="
& $node "node_modules\electron\install.js" 2>&1 | Out-String

$exe = Join-Path $Dir "node_modules\electron\dist\electron.exe"
if (Test-Path $exe) {
    Write-Output ("electron.exe OK size=" + (Get-Item $exe).Length)
    Write-Output ("package version=" + (& $node -e "console.log(require('electron/package.json').version)"))
} else {
    Write-Output "electron.exe MISSING"
    exit 2
}
