param(
    [Parameter(Mandatory = $true)][string]$Dir
)
# ASCII only. Allow electron's postinstall (binary download) and rebuild.
$ErrorActionPreference = 'Stop'

$node = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$pnpm = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"

Set-Location $Dir
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:npm_config_registry = "https://registry.npmmirror.com/"

Write-Output "== pnpm install (allow electron build) =="
& $node $pnpm install 2>&1 | Out-String

Write-Output "== pnpm rebuild electron =="
& $node $pnpm rebuild electron 2>&1 | Out-String

Write-Output "== verify =="
$exe = Join-Path $Dir "node_modules\electron\dist\electron.exe"
if (Test-Path $exe) {
    Write-Output "electron.exe OK"
    & $node -e "console.log('electron version:', require('electron/package.json').version)"
} else {
    Write-Output "electron.exe MISSING"
    if (Test-Path (Join-Path $Dir "node_modules\electron\path.txt")) {
        Write-Output "path.txt exists:"
        Get-Content (Join-Path $Dir "node_modules\electron\path.txt")
    }
    Get-ChildItem (Join-Path $Dir "node_modules\electron") -Force | Select-Object Name
}
