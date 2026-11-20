param(
    [Parameter(Mandatory = $true)][string]$Path
)
# Ensure the given .ps1 is UTF-8 WITH BOM so Windows PowerShell 5.1 parses
# non-ASCII literals correctly. ASCII-only source (this file must stay readable
# by PS 5.1 itself).
$ErrorActionPreference = 'Stop'
$enc = New-Object System.Text.UTF8Encoding($true)
$text = [System.IO.File]::ReadAllText($Path, (New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::WriteAllText($Path, $text, $enc)
$bytes = [System.IO.File]::ReadAllBytes($Path)
Write-Output ("BOM added: {0} (first bytes: {1:X2} {2:X2} {3:X2})" -f (Split-Path $Path -Leaf), $bytes[0], $bytes[1], $bytes[2])
