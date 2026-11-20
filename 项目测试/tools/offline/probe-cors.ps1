param(
    [int]$Port = 8081
)
# ASCII only. Probes llama-server CORS behaviour (SEC-CORS-01).
$ErrorActionPreference = 'Continue'
$base = "http://127.0.0.1:$Port"

function Probe([string]$label, [hashtable]$headers, [string]$method, [string]$url, [string]$body) {
    try {
        $r = if ($body) {
            Invoke-WebRequest -Uri $url -Method $method -Headers $headers -Body $body -ContentType 'application/json' -UseBasicParsing -TimeoutSec 20
        } else {
            Invoke-WebRequest -Uri $url -Method $method -Headers $headers -UseBasicParsing -TimeoutSec 10
        }
        $acao = $r.Headers['Access-Control-Allow-Origin']
        Write-Output ("[$label] status=" + $r.StatusCode + " ACAO=" + $acao)
    } catch {
        $resp = $_.Exception.Response
        if ($resp) {
            Write-Output ("[$label] status=" + [int]$resp.StatusCode + " (rejected)")
        } else {
            Write-Output ("[$label] error: " + $_.Exception.Message)
        }
    }
}

Probe 'GET /health  no-origin' @{} 'GET' "$base/health" ''
Probe 'GET /health  evil'      @{ Origin = 'https://evil.example' } 'GET' "$base/health" ''
Probe 'GET /props   evil'      @{ Origin = 'https://evil.example' } 'GET' "$base/props" ''
Probe 'GET /props   localhost' @{ Origin = 'http://127.0.0.1:5173' } 'GET' "$base/props" ''
Probe 'OPTIONS preflight evil' @{ Origin = 'https://evil.example'; 'Access-Control-Request-Method' = 'POST'; 'Access-Control-Request-Headers' = 'content-type' } 'OPTIONS' "$base/v1/chat/completions" ''
Probe 'OPTIONS preflight local' @{ Origin = 'http://localhost'; 'Access-Control-Request-Method' = 'POST'; 'Access-Control-Request-Headers' = 'content-type' } 'OPTIONS' "$base/v1/chat/completions" ''
$body = '{"model":"hy-mt","messages":[{"role":"user","content":"hi"}],"max_tokens":8,"temperature":0}'
Probe 'POST chat evil'         @{ Origin = 'https://evil.example' } 'POST' "$base/v1/chat/completions" $body
