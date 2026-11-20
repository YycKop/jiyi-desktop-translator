<#
.SYNOPSIS
  把工作区的源码 / 文档推到 GitHub，并挂上 Release 资产（不依赖 git 客户端）。

.DESCRIPTION
  只用 GitHub REST API：
    1) 可选：创建仓库（需要 Administration 权限的 token）
    2) 逐个文件 POST /git/blobs（base64）
    3) 一次性 POST /git/trees → /git/commits → 更新 refs/heads/main
    4) 创建 Release，并用流式上传挂上 zip 资产

  令牌只从参数或环境变量读，不落盘、不回显。

.EXAMPLE
  $env:DSH_GH_PAT = 'github_pat_xxx'
  ./gh-publish.ps1 -Owner YycKop -Repo jiyi-desktop-translator -Tag v1.0.0 -Zip 'dist\即译-1.0.0-portable-win-x64-nomodel.zip'
#>
param(
  [Parameter(Mandatory = $true)][string]$Owner,
  [Parameter(Mandatory = $true)][string]$Repo,
  [string]$Token = $env:DSH_GH_PAT,
  [string]$Tag = 'v1.0.0',
  [string]$Zip = '',
  [string]$Root = '',
  [switch]$CreateRepo,
  [switch]$DryRun,
  [switch]$SkipFiles
)

$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = (Get-Location).Path }
if (-not $Token) { throw '缺少令牌：请设置 $env:DSH_GH_PAT 或传 -Token' }

$api = 'https://api.github.com'
$headers = @{
  Authorization = "Bearer $Token"
  'User-Agent'  = 'dsh-publisher'
  Accept        = 'application/vnd.github+json'
}

function Invoke-GH {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$Method = 'GET',
    $Body = $null,
    [string]$ContentType = 'application/json; charset=utf-8'
  )
  $uri = if ($Path.StartsWith('http')) { $Path } else { "$api$Path" }
  $req = @{ Uri = $uri; Method = $Method; Headers = $headers; TimeoutSec = 120 }
  if ($null -ne $Body) {
    # 统一用 UTF-8 字节体，避免中文被按 ANSI 发送
    $json = if ($Body -is [string]) { $Body } else { ($Body | ConvertTo-Json -Depth 8 -Compress) }
    $req.Body = [System.Text.Encoding]::UTF8.GetBytes($json)
    $req.ContentType = $ContentType
  }
  return Invoke-RestMethod @req
}

# ---------------------------------------------------------------- 收集文件
$excludeDir = @('node_modules', 'userdata', 'tmp', '_runtime', 'reports', 'dist', 'electron-userdata', '__pycache__')
$excludeExt = @('.log', '.bak', '.flag', '.zip', '.7z', '.prep.png', '.dll', '.pdb', '.exe')
$excludeName = @('Thumbs.db', 'desktop.ini', '.DS_Store')
$excludePathPart = @('runtime\llama', 'runtime\ocr-rapid\models', 'runtime\onnxruntime', '_dl', '_tools')

function Should-Skip([System.IO.FileInfo]$f) {
  $rel = $f.FullName.Substring($Root.Length + 1)
  if ($excludeName -contains $f.Name) { return $true }
  foreach ($d in $excludeDir) { if ($rel -match "(^|\\)$([regex]::Escape($d))(\\)") { return $true } }
  foreach ($p in $excludePathPart) { if ($rel -like "*$p*") { return $true } }
  if ($f.Name -like '*.prep.png') { return $true }
  if ($excludeExt -contains $f.Extension.ToLower()) { return $true }
  if ($rel -like '项目代码\runtime\*') { return $true }
  return $false
}

$roots = @('项目代码', '项目测试', 'dsh-plugins', 'docs', 'README.md', '.gitignore') |
  Where-Object { Test-Path (Join-Path $Root $_) }

$files = New-Object System.Collections.Generic.List[System.IO.FileInfo]
foreach ($r in $roots) {
  $p = Join-Path $Root $r
  if (Test-Path $p -PathType Leaf) { $files.Add((Get-Item $p)); continue }
  Get-ChildItem $p -Recurse -File | ForEach-Object {
    if (-not (Should-Skip $_)) { $files.Add($_) }
  }
}

$total = ($files | Measure-Object Length -Sum).Sum
Write-Host ("[gh] 待上传 {0} 个文件，{1:N2} MB" -f $files.Count, ($total / 1MB))
if ($DryRun) {
  $files | ForEach-Object { $_.FullName.Substring($Root.Length + 1) } | Sort-Object | Select-Object -First 40
  Write-Host "[gh] dry-run 结束"
  return
}

# ---------------------------------------------------------------- 仓库
$repoPath = "/repos/$Owner/$Repo"
if ($CreateRepo) {
  Write-Host "[gh] 创建仓库 $Owner/$Repo"
  Invoke-GH -Path '/user/repos' -Method POST -Body @{
    name        = $Repo
    description = '即译 · 桌面翻译助手：框选屏幕任意位置即可翻译，支持联网 API 与本地离线模型（Windows）'
    private     = $false
    auto_init   = $false
    has_wiki    = $false
  } | Out-Null
}

$info = Invoke-GH -Path $repoPath
Write-Host "[gh] 目标仓库：$($info.full_name)（默认分支 $($info.default_branch)）"

# ---------------------------------------------------------------- 上传文件
if (-not $SkipFiles) {
  $tree = New-Object System.Collections.Generic.List[object]
  $i = 0
  foreach ($f in $files) {
    $i++
    $rel = $f.FullName.Substring($Root.Length + 1) -replace '\\', '/'
    $b64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($f.FullName))
    $blob = Invoke-GH -Path "$repoPath/git/blobs" -Method POST -Body @{ content = $b64; encoding = 'base64' }
    $tree.Add(@{ path = $rel; mode = '100644'; type = 'blob'; sha = $blob.sha })
    if ($i % 25 -eq 0 -or $i -eq $files.Count) { Write-Host ("[gh] blob {0}/{1}" -f $i, $files.Count) }
  }

  Write-Host "[gh] 建树（$($tree.Count) 项）"
  $newTree = Invoke-GH -Path "$repoPath/git/trees" -Method POST -Body @{ tree = $tree }

  $parent = $null
  try {
    $ref = Invoke-GH -Path "$repoPath/git/ref/heads/$($info.default_branch)"
    $parent = $ref.object.sha
    Write-Host "[gh] 已有分支头：$parent（以它作为父提交）"
  } catch { Write-Host '[gh] 空仓库，首个提交' }

  $commitBody = @{ message = "即译 v1.0.0：源码、测试与使用文档`n`n- 桌面翻译助手（Electron 28.3.3 + 纯 Node 核心）`n- pp-ocrv4 中/日/韩识别 + 离线 GGUF 翻译`n- 27 个测试文件 / 打包脚本齐全"; tree = $newTree.sha }
  if ($parent) { $commitBody.parents = @($parent) }
  $commit = Invoke-GH -Path "$repoPath/git/commits" -Method POST -Body $commitBody
  Write-Host "[gh] 提交：$($commit.sha)"

  if ($parent) {
    Invoke-GH -Path "$repoPath/git/refs/heads/$($info.default_branch)" -Method PATCH -Body @{ sha = $commit.sha; force = $false } | Out-Null
  } else {
    Invoke-GH -Path "$repoPath/git/refs" -Method POST -Body @{ ref = "refs/heads/$($info.default_branch)"; sha = $commit.sha } | Out-Null
  }
  Write-Host "[gh] 已推送分支 $($info.default_branch)"
}

# ---------------------------------------------------------------- Release
if ($Zip) {
  $zipFull = if ([System.IO.Path]::IsPathRooted($Zip)) { $Zip } else { Join-Path $Root $Zip }
  if (-not (Test-Path $zipFull)) { throw "找不到 zip：$zipFull" }
  $assetName = [System.IO.Path]::GetFileName($zipFull)

  $release = $null
  try { $release = Invoke-GH -Path "$repoPath/releases/tags/$Tag" }
  catch {
    Write-Host "[gh] 创建 Release $Tag"
    $notes = @"
## 即译 v1.0.0（Windows x64 免安装）

框选屏幕任意位置即可翻译。可联网（OpenAI 兼容接口），也可完全离线（本地 GGUF 模型）。

### 这个包
- 不含离线模型（约 212 MB）。想离线翻译：把 ``HY-MT1.5-1.8B-Q4_K_M.gguf`` 放进 ``userdata\models\``。
- 解压后双击 ``即译.exe``。未签名程序会触发 SmartScreen：更多信息 → 仍要运行。

### 快速开始
1. 解压到任意非系统目录
2. 双击 ``即译.exe``，按引导选目标语言
3. ``Ctrl+Shift+T`` 拖框选区 → 松手出译文

使用文档：[docs/使用说明.md](https://github.com/$Owner/$Repo/blob/main/docs/%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E.md)
"@
    $release = Invoke-GH -Path "$repoPath/releases" -Method POST -Body @{
      tag_name         = $Tag
      target_commitish = $info.default_branch
      name             = "即译 v1.0.0"
      body             = $notes
      draft            = $false
      prerelease       = $false
    }
  }

  Write-Host "[gh] 上传资产 $assetName（$([math]::Round((Get-Item $zipFull).Length / 1MB, 1)) MB）"
  $uploadUrl = "https://uploads.github.com/repos/$Owner/$Repo/releases/$($release.id)/assets?name=$assetName"

  # PS 5.1 没有预加载 HttpClient；这里改用 HttpWebRequest 流式上传，避免把 200 MB+ 读进内存
  $req = [System.Net.HttpWebRequest]::Create($uploadUrl)
  $req.Method = 'POST'
  $req.Headers.Add('Authorization', "Bearer $Token")
  $req.UserAgent = 'dsh-publisher'
  $req.ContentType = 'application/zip'
  $req.Accept = 'application/vnd.github+json'
  $req.Timeout = 3600000
  $req.ReadWriteTimeout = 3600000
  $req.AllowWriteStreamBuffering = $false
  $req.ContentLength = (Get-Item $zipFull).Length
  $fs = [System.IO.File]::OpenRead($zipFull)
  try {
    $s = $req.GetRequestStream()
    try { $fs.CopyTo($s, 1048576) } finally { $s.Dispose() }
  } finally { $fs.Dispose() }
  try {
    $resp = $req.GetResponse()
  } catch [System.Net.WebException] {
    $err = $_.Exception.Response
    $body = if ($err) { (New-Object System.IO.StreamReader($err.GetResponseStream())).ReadToEnd() } else { '' }
    throw "上传失败：$($_.Exception.Message) $body"
  }
  $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
  $text = $reader.ReadToEnd()
  $reader.Dispose(); $resp.Dispose()
  $asset = $text | ConvertFrom-Json
  Write-Host "[gh] 资产就绪：$($asset.browser_download_url)"
}

Write-Host "[gh] 完成：https://github.com/$Owner/$Repo"
