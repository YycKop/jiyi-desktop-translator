param(
    [Parameter(Mandatory = $true)][string]$Src,
    [Parameter(Mandatory = $true)][string]$Dest
)
# NOTE: ASCII only (Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI).
$ErrorActionPreference = 'Stop'
if (Test-Path $Dest) { Remove-Item -LiteralPath $Dest -Force }
Write-Output ("compressing " + $Src)
Compress-Archive -Path (Join-Path $Src '*') -DestinationPath $Dest -CompressionLevel Fastest -Force
Write-Output ("zip bytes: " + (Get-Item $Dest).Length)
