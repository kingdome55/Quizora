#requires -Version 5.1
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $root 'manifest.json'
if (-not (Test-Path $manifestPath)) { throw "找不到 manifest.json：$manifestPath" }

$manifest = [System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$version = [string]$manifest.version
if (-not $version) { throw 'manifest.json 缺少 version' }
if ([int]$manifest.manifest_version -ne 3) { throw '仅支持 Manifest V3' }

$name = "quizora-v$version"
$distRoot = Join-Path $root 'dist'
$stage = Join-Path $distRoot $name
$releaseDir = Join-Path $root 'release'
$zipPath = Join-Path $releaseDir "$name.zip"

Write-Host "题灵（Quizora）生产构建 v$version" -ForegroundColor Cyan
Write-Host "输出目录：$stage"

if (Test-Path $stage) { Remove-Item -Path $stage -Recurse -Force }
if (Test-Path $zipPath) { Remove-Item -Path $zipPath -Force }
New-Item -ItemType Directory -Force -Path $stage, $releaseDir | Out-Null

# 1) 只复制运行所需文件
Copy-Item -Path (Join-Path $root 'manifest.json') -Destination $stage
Copy-Item -Path (Join-Path $root 'src') -Destination (Join-Path $stage 'src') -Recurse
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'assets') | Out-Null
foreach ($icon in 'icon16.png', 'icon48.png', 'icon128.png') {
  $iconPath = Join-Path $root "assets\$icon"
  if (-not (Test-Path $iconPath)) { throw "缺少图标：assets/$icon" }
  Copy-Item -Path $iconPath -Destination (Join-Path $stage 'assets')
}
foreach ($doc in 'README.md', 'CHANGELOG.md', 'LICENSE') {
  $docPath = Join-Path $root $doc
  if (Test-Path $docPath) { Copy-Item -Path $docPath -Destination $stage }
}

# 2) 校验必需文件与 manifest 引用
$required = @(
  'manifest.json',
  'src/background.js',
  'src/panel.html',
  'src/panel.js',
  'src/panel.css',
  'assets/icon16.png',
  'assets/icon48.png',
  'assets/icon128.png'
)
foreach ($rel in $required) {
  if (-not (Test-Path (Join-Path $stage $rel))) { throw "构建缺少必需文件：$rel" }
}
foreach ($iconRel in $manifest.icons.PSObject.Properties.Value) {
  if (-not (Test-Path (Join-Path $stage $iconRel))) { throw "manifest 引用的图标不存在：$iconRel" }
}
foreach ($fileRel in $manifest.content_scripts[0].js) {
  if (-not (Test-Path (Join-Path $stage $fileRel))) { throw "manifest 引用的内容脚本不存在：$fileRel" }
}

# 3) 语法检查（有 node 时执行）
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  Get-ChildItem -Path (Join-Path $stage 'src') -Recurse -File -Filter *.js | ForEach-Object {
    node --check $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "语法检查失败：$($_.FullName)" }
  }
  Write-Host '✅ JS 语法检查通过'
} else {
  Write-Host '⚠ 未找到 node，跳过 JS 语法检查' -ForegroundColor Yellow
}

# 4) 打包 ZIP（条目使用正斜杠，ZIP 内含顶层目录 quizora-v<version>）
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$zipArchive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -Path $stage -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zipArchive, $_.FullName, "$name/$rel", [System.IO.Compression.CompressionLevel]::Optimal)
  }
} finally {
  $zipArchive.Dispose()
}

# 5) 校验 ZIP 内容
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $entries = $zip.Entries | ForEach-Object { $_.FullName }
  foreach ($rel in 'manifest.json', 'src/background.js', 'assets/icon128.png') {
    if ($entries -notcontains "$name/$rel") { throw "ZIP 缺少：$name/$rel" }
  }
  $count = $entries.Count
} finally {
  $zip.Dispose()
}

$size = (Get-Item $zipPath).Length
$sha = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash
Write-Host ''
Write-Host '构建完成' -ForegroundColor Green
Write-Host "解压目录：$stage"
Write-Host "发布包  ：$zipPath"
Write-Host "文件数量：$count"
Write-Host ("大小    ：{0:N1} KB" -f ($size / 1KB))
Write-Host "SHA256  ：$sha"
Write-Host ''
Write-Host '安装：解压 ZIP -> edge://extensions -> 开发人员模式 -> 加载解压缩的扩展 -> 选择解压目录'
