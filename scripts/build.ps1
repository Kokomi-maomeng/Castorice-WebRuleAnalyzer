[CmdletBinding()]
param([switch]$SkipTests, [switch]$BrowserTests, [switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseTag='v'+((Get-Content -LiteralPath (Join-Path $projectRoot 'VERSION') -Raw).Trim() -replace '\.0$','')
$outputRoot = Join-Path $projectRoot 'dist'
$packageName = ("Castorice-WebRuleAnalyzer-$releaseTag-windows-amd64")
$packageDir = Join-Path $outputRoot $packageName
foreach ($runtimeFolder in @('data', 'exports')) {
    if (Test-Path -LiteralPath (Join-Path $packageDir $runtimeFolder)) { throw '发布目录包含运行数据，请先将其备份并换用干净构建目录。' }
}
function Invoke-Checked { param([string]$File, [string[]]$Arguments) & $File @Arguments; if ($LASTEXITCODE -ne 0) { throw "$File failed ($LASTEXITCODE)" } }
$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
$goCommand = (Get-Command go -ErrorAction Stop).Source
Push-Location (Join-Path $projectRoot 'frontend')
try {
    if (-not $SkipInstall) { Invoke-Checked $npmCommand @('ci', '--no-audit', '--no-fund') }
    if (-not $SkipTests) { Invoke-Checked $npmCommand @('test') }
    Invoke-Checked $npmCommand @('run', 'build')
} finally { Pop-Location }
$oldCGO = $env:CGO_ENABLED; $oldGOOS = $env:GOOS; $oldGOARCH = $env:GOARCH; $oldBrowserTest = $env:CASTORICE_BROWSER_TEST
Push-Location (Join-Path $projectRoot 'backend')
try {
    $env:CGO_ENABLED = '0'; $env:GOOS = 'windows'; $env:GOARCH = 'amd64'
    Invoke-Checked $goCommand @('run','github.com/tc-hib/go-winres@v0.3.3','make','--in','cmd/castorice/winres/winres.json','--out','cmd/castorice/rsrc','--arch','amd64')
    if ($BrowserTests) { $env:CASTORICE_BROWSER_TEST = '1' }
    if (-not $SkipTests) { Invoke-Checked $goCommand @('test', './...', '-count=1', '-timeout=180s'); Invoke-Checked $goCommand @('vet', './...') }
    New-Item -ItemType Directory -Path $packageDir -Force | Out-Null
    Invoke-Checked $goCommand @('build', '-trimpath', '-buildvcs=false', '-ldflags=-H windowsgui -s -w', '-o', (Join-Path $packageDir 'Castorice-WebRuleAnalyzer.exe'), './cmd/castorice')
} finally {
    Pop-Location
    $env:CGO_ENABLED=$oldCGO; $env:GOOS=$oldGOOS; $env:GOARCH=$oldGOARCH; $env:CASTORICE_BROWSER_TEST=$oldBrowserTest
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE'), (Join-Path $projectRoot 'CHANGELOG.md') -Destination $packageDir -Force
Set-Content -LiteralPath (Join-Path $packageDir 'README.md') -Encoding utf8 -Value @"
# Castorice-WebRuleAnalyzer $releaseTag

请先解压到可写目录，再双击 Castorice-WebRuleAnalyzer.exe。需要 Windows x64、Edge WebView2 Runtime 和已安装的 Chrome、Edge 或 Chromium。

[用户运行说明](docs/用户运行说明.md) · [导出接入说明](docs/EXPORT-INTEGRATION.md) · [构建信息](BUILD-INFO.json) · [校验值](SHA256SUMS.txt)
"@
& (Join-Path $PSScriptRoot 'copy-release-docs.ps1') -PackageDirectory $packageDir
foreach ($old in @('TEST-REPORT.md', '用户运行说明.md', 'THIRD-PARTY-NOTICES.md')) {
    $oldPath = Join-Path $packageDir $old
    if (Test-Path -LiteralPath $oldPath -PathType Leaf) { Remove-Item -LiteralPath $oldPath }
}
& (Join-Path $PSScriptRoot 'collect-licenses.ps1') -OutputFile (Join-Path $packageDir 'THIRD-PARTY-LICENSES.txt')
$exePath = Join-Path $packageDir 'Castorice-WebRuleAnalyzer.exe'
$hash = Get-FileHash -LiteralPath $exePath -Algorithm SHA256
[IO.File]::WriteAllText((Join-Path $packageDir 'SHA256SUMS.txt'), ($hash.Hash.ToLowerInvariant() + '  Castorice-WebRuleAnalyzer.exe' + [Environment]::NewLine))
& (Join-Path $PSScriptRoot 'write-build-info.ps1') -PackageDirectory $packageDir -Executable 'Castorice-WebRuleAnalyzer.exe' -Target 'windows/amd64'
Invoke-Checked (Get-Command node -ErrorAction Stop).Source @((Join-Path $PSScriptRoot 'check-package-links.mjs'), $packageDir)
$zipPath = Join-Path $outputRoot ($packageName + '.zip')
Compress-Archive -LiteralPath $packageDir -DestinationPath $zipPath -Force
$zipHash = (Get-FileHash -LiteralPath $zipPath).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($zipPath + '.sha256'), ($zipHash + '  ' + (Split-Path $zipPath -Leaf) + [Environment]::NewLine))
Write-Host "构建完成：$exePath"
Write-Host "运行包：$zipPath"
