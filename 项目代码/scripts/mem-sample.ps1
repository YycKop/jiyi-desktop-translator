param(
    [Parameter(Mandatory = $true)][string]$Pids,
    [Parameter(Mandatory = $true)][string]$OutPath
)
# Sample working-set / private bytes for the given PIDs. ASCII only.
# Writes UTF-8 JSON: { ts, total, items:[{pid,name,wsMB,pmMB}] }
$ErrorActionPreference = 'Continue'

$items = @()
foreach ($p in $Pids.Split(',')) {
    $id = 0
    if (-not [int]::TryParse($p.Trim(), [ref]$id)) { continue }
    $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($null -eq $proc) { continue }
    $items += @{
        pid  = $id
        name = $proc.ProcessName
        wsMB = [math]::Round($proc.WorkingSet64 / 1MB, 1)
        pmMB = [math]::Round($proc.PrivateMemorySize64 / 1MB, 1)
    }
}
$total = 0
foreach ($i in $items) { $total += $i.wsMB }

$payload = @{
    ts    = (Get-Date).ToString('o')
    total = [math]::Round($total, 1)
    items = $items
}
$json = $payload | ConvertTo-Json -Depth 4 -Compress
[System.IO.File]::WriteAllText($OutPath, $json, (New-Object System.Text.UTF8Encoding($false)))
