param(
    [string]$Exe = "D:\desktop-translator\dist\win-x64\app\resources\runtime\llama\llama-server.exe",
    [string]$Model = "",
    [int]$Port = 8081,
    [int]$Threads = 6,
    [int]$Ctx = 4096,
    [string]$LogFile = "",
    [int]$WaitSeconds = 90
)
# NOTE: ASCII only (PS 5.1 reads BOM-less .ps1 as ANSI).
$ErrorActionPreference = 'Continue'

if (-not $LogFile) { $LogFile = Join-Path (Split-Path -Parent $PSScriptRoot) '_dl\llama-server-test.log' }
if (-not $Model) { throw 'Model path required' }

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $Exe
$psi.Arguments = "-m `"$Model`" --host 127.0.0.1 --port $Port -c $Ctx -t $Threads --cors-origins localhost"
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.WorkingDirectory = Split-Path -Parent $Exe

$p = New-Object System.Diagnostics.Process
$p.StartInfo = $psi
$null = $p.Start()

$outPath = [System.IO.Path]::Combine((Split-Path -Parent $LogFile), 'llama-stdout.log')
$errPath = [System.IO.Path]::Combine((Split-Path -Parent $LogFile), 'llama-stderr.log')
$sw = New-Object System.IO.StreamWriter($LogFile, $false, [System.Text.Encoding]::UTF8)
$sw.WriteLine("started pid=$($p.Id) port=$Port threads=$Threads ctx=$Ctx")
$sw.AutoFlush = $true

$null = $p.BeginOutputReadLine()
$null = $p.BeginErrorReadLine()
$handler = {
    param($sender, $e)
    if ($e.Data) { $sw.WriteLine($e.Data) }
}
Register-ObjectEvent -InputObject $p -EventName OutputDataReceived -Action $handler | Out-Null
Register-ObjectEvent -InputObject $p -EventName ErrorDataReceived -Action $handler | Out-Null

$healthUrl = "http://127.0.0.1:$Port/health"
$ready = $false
for ($i = 0; $i -lt $WaitSeconds; $i++) {
    Start-Sleep -Seconds 1
    try {
        $r = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3
        if ($r.StatusCode -eq 200) { $ready = $true; Write-Output "health OK after $($i+1)s"; break }
    } catch { }
    if ($p.HasExited) { Write-Output "process exited early: $($p.ExitCode)"; break }
}

Write-Output "ready=$ready pid=$($p.Id)"
if ($p.HasExited) { Write-Output ("exit code: " + $p.ExitCode) }

if ($ready) {
    $body = @{
        model    = 'hy-mt'
        messages = @(
            @{ role = 'system'; content = 'You are a translator. Translate the user text to Chinese. Output only the translated text, no explanation.' },
            @{ role = 'user'; content = 'Press Save to continue. Please click the link to fill in your details.' }
        )
        temperature = 0
        max_tokens  = 128
        stream      = $false
    } | ConvertTo-Json -Depth 6
    $t0 = Get-Date
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/v1/chat/completions" -Method POST -ContentType 'application/json' -Body $body -UseBasicParsing -TimeoutSec 120
        $dt = ((Get-Date) - $t0).TotalMilliseconds
        $j = $resp.Content | ConvertFrom-Json
        Write-Output ("chat status=$($resp.StatusCode) ms=" + [math]::Round($dt))
        Write-Output ("translation: " + $j.choices[0].message.content)
        Write-Output ("usage: prompt=$($j.usage.prompt_tokens) completion=$($j.usage.completion_tokens)")
    } catch {
        Write-Output ("chat failed: " + $_.Exception.Message)
    }

    # SEC-CORS-01: evil origin must be rejected
    try {
        $evil = Invoke-WebRequest -Uri $healthUrl -Headers @{ Origin = 'https://evil.example' } -UseBasicParsing -TimeoutSec 5
        Write-Output ("evil origin status=" + $evil.StatusCode + " (should be 403)")
    } catch {
        Write-Output ("evil origin rejected: " + $_.Exception.Message)
    }

    $mem = (Get-Process -Id $p.Id).WorkingSet64 / 1MB
    Write-Output ("rss MB: " + [math]::Round($mem))
}

$sw.Flush()
Write-Output "--- stopping server ---"
if (-not $p.HasExited) { $p.Kill(); $p.WaitForExit(5000) | Out-Null }
Write-Output "stopped"
