[CmdletBinding()]
param([switch]$SkipTests, [switch]$BrowserTests, [switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputRoot = Join-Path $projectRoot 'dist'
$packageName = 'Castorice-WebRuleAnalyzer-v1.3-windows-amd64'
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
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE'), (Join-Path $projectRoot 'README.md'), (Join-Path $projectRoot 'CHANGELOG.md'), (Join-Path $projectRoot 'docs/THIRD-PARTY-NOTICES.md'), (Join-Path $projectRoot 'docs/用户运行说明.md') -Destination $packageDir -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs') -Destination $packageDir -Recurse -Force
$oldReportPath = Join-Path $packageDir 'TEST-REPORT.md'
if (Test-Path -LiteralPath $oldReportPath -PathType Leaf) { Remove-Item -LiteralPath $oldReportPath }
& (Join-Path $PSScriptRoot 'collect-licenses.ps1') -OutputFile (Join-Path $packageDir 'THIRD-PARTY-LICENSES.txt')
$exePath = Join-Path $packageDir 'Castorice-WebRuleAnalyzer.exe'
$hash = Get-FileHash -LiteralPath $exePath -Algorithm SHA256
[IO.File]::WriteAllText((Join-Path $packageDir 'SHA256SUMS.txt'), ($hash.Hash.ToLowerInvariant() + '  Castorice-WebRuleAnalyzer.exe' + [Environment]::NewLine))
$zipPath = Join-Path $outputRoot ($packageName + '.zip')
Compress-Archive -LiteralPath $packageDir -DestinationPath $zipPath -Force
Write-Host "构建完成：$exePath"
Write-Host "运行包：$zipPath"
