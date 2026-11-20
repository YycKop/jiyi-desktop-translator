param(
    [string]$Counter = "",
    [string]$ProbeExe = "",
    [string]$IconPath = "",
    [int]$Seconds = 25,
    [string]$Out = ""
)
# ASCII only. Runs the WinForms tray probe and samples tray counts while it is visible.
$ErrorActionPreference = 'Continue'
$lines = New-Object System.Collections.Generic.List[string]

function Sample([string]$tag) {
    $text = & powershell -NoProfile -ExecutionPolicy Bypass -File $Counter 2>&1 | Out-String
    $match = [regex]::Matches($text, "buttons=(\d+)")
    $vals = @()
    foreach ($m in $match) { $vals += $m.Groups[1].Value }
    $line = $tag + " -> " + ($vals -join ",")
    $lines.Add($line)
    Write-Output $line
}

Sample "before"
$p = Start-Process -FilePath $ProbeExe -ArgumentList @($IconPath, "$Seconds") -PassThru
Write-Output ("probe pid=" + $p.Id)
Start-Sleep -Seconds 4
Sample "probe+4s"
Start-Sleep -Seconds 5
Sample "probe+9s"
Start-Sleep -Seconds 5
Sample "probe+14s"
if (-not $p.HasExited) { $p.Kill() }
Start-Sleep -Seconds 3
Sample "probe killed"
$lines | Set-Content -Path $Out -Encoding UTF8
