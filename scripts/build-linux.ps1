[CmdletBinding()]
param(
 [switch]$SkipFrontend,
 [ValidateSet('linux','darwin')][string]$Platform='linux',
 [ValidateSet('amd64','arm64')][string]$Architecture='amd64',
 [switch]$DockerPackage
)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseTag='v'+((Get-Content -LiteralPath (Join-Path $projectRoot 'VERSION') -Raw).Trim() -replace '\.0$','')
$platformName = if ($Platform -eq 'darwin') { 'macos' } else { 'linux' }
$packageDir=Join-Path $projectRoot ("dist/Castorice-WebRuleAnalyzer-$releaseTag-$platformName-$Architecture")
if ($DockerPackage -and $Platform -ne 'linux') { throw 'Docker packaging requires a Linux executable.' }
foreach($runtimeFolder in @('data','exports')){if(Test-Path -LiteralPath (Join-Path $packageDir $runtimeFolder)){throw '发布目录包含运行数据，请先备份并换用干净构建目录。'}}
if(-not $SkipFrontend){
 Push-Location (Join-Path $projectRoot 'frontend')
 try { & npm.cmd ci --no-audit --no-fund; if($LASTEXITCODE -ne 0){throw 'npm ci failed'}; & npm.cmd run build; if($LASTEXITCODE -ne 0){throw 'Frontend build failed'} } finally {Pop-Location}
}
New-Item -ItemType Directory -Path $packageDir -Force | Out-Null
$oldOS=$env:GOOS; $oldArch=$env:GOARCH; $oldCGO=$env:CGO_ENABLED
Push-Location (Join-Path $projectRoot 'backend')
try {
 $env:GOOS=$Platform; $env:GOARCH=$Architecture; $env:CGO_ENABLED='0'
 & go build -trimpath -buildvcs=false -ldflags='-s -w' -o (Join-Path $packageDir 'castorice') ./cmd/castorice
 if($LASTEXITCODE -ne 0){throw "$Platform/$Architecture build failed"}
} finally {Pop-Location; $env:GOOS=$oldOS; $env:GOARCH=$oldArch; $env:CGO_ENABLED=$oldCGO}
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE'),(Join-Path $projectRoot 'CHANGELOG.md') -Destination $packageDir -Force
if ($Platform -eq 'linux') {
 Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination $packageDir -Force
} else {
 Set-Content -LiteralPath (Join-Path $packageDir 'README.md') -Encoding utf8 -Value @"
# Castorice-WebRuleAnalyzer $releaseTag (macOS $Architecture)

安装 Chrome、Edge 或 Chromium 后，在终端进入解压目录，运行 ./start.sh，应用会在默认浏览器打开。

[用户运行说明](docs/用户运行说明.md) · [导出接入说明](docs/EXPORT-INTEGRATION.md) · [构建信息](BUILD-INFO.json) · [校验值](SHA256SUMS.txt)
"@
}
& (Join-Path $PSScriptRoot 'copy-release-docs.ps1') -PackageDirectory $packageDir
$launcher = if ($Platform -eq 'linux') { @'
#!/bin/sh
set -eu
cd -- "$(dirname -- "$0")"
if [ "$#" -eq 0 ] && [ -n "${WAYLAND_DISPLAY:-${DISPLAY:-}}" ]; then
  exec ./castorice --desktop
fi
exec ./castorice --server --data-dir "$PWD/data" "$@"
'@
} else { @'
#!/bin/sh
set -eu
cd -- "$(dirname -- "$0")"
exec ./castorice --server --data-dir "$PWD/data" "$@"
'@
}
$launcher = $launcher.Replace("`r`n", "`n") + "`n"
[IO.File]::WriteAllText((Join-Path $packageDir 'start.sh'),$launcher,[Text.UTF8Encoding]::new($false))
if ($Platform -eq 'linux') {
 $dockerfile=Join-Path $projectRoot 'deploy/Dockerfile.runtime'
 Copy-Item -LiteralPath $dockerfile -Destination (Join-Path $packageDir 'Dockerfile') -Force
 Copy-Item -LiteralPath (Join-Path $projectRoot 'compose.yaml'), (Join-Path $projectRoot 'compose.apparmor.yaml') -Destination $packageDir -Force
 New-Item -ItemType Directory -Path (Join-Path $packageDir 'deploy') -Force | Out-Null
 foreach ($file in @('castorice-browser.apparmor', 'castorice-seccomp.json', 'LICENSE-moby-profiles', 'README.md', 'Caddyfile.example', 'castorice.service.example')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot "deploy/$file") -Destination (Join-Path $packageDir 'deploy') -Force
 }
}
& (Join-Path $PSScriptRoot 'collect-licenses.ps1') -OutputFile (Join-Path $packageDir 'THIRD-PARTY-LICENSES.txt')
$hash=(Get-FileHash -LiteralPath (Join-Path $packageDir 'castorice') -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $packageDir 'SHA256SUMS.txt'),$hash+'  castorice'+"`n")
Write-Host "$Platform/$Architecture package: $packageDir"
& (Join-Path $PSScriptRoot 'write-build-info.ps1') -PackageDirectory $packageDir -Executable 'castorice' -Target "$Platform/$Architecture"
& node (Join-Path $PSScriptRoot 'check-package-links.mjs') $packageDir
if($LASTEXITCODE -ne 0){throw 'Package document links failed'}
function Write-ReleaseArchive([string]$directory) {
 & python (Join-Path $PSScriptRoot 'package-linux.py') $directory
 if($LASTEXITCODE -ne 0){throw 'Release archive failed'}
 $archive=$directory+'.tar.gz'
 $archiveHash=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
 [IO.File]::WriteAllText(($archive+'.sha256'),$archiveHash+'  '+(Split-Path $archive -Leaf)+"`n")
}
Write-ReleaseArchive $packageDir
if ($DockerPackage) {
 $dockerDir=Join-Path $projectRoot ("dist/Castorice-WebRuleAnalyzer-$releaseTag-docker-$Architecture")
 New-Item -ItemType Directory -Path $dockerDir -Force | Out-Null
 $files=@('castorice','Dockerfile','compose.yaml','compose.apparmor.yaml','deploy','docs','README.md','LICENSE','CHANGELOG.md','THIRD-PARTY-LICENSES.txt','BUILD-INFO.json','SHA256SUMS.txt')
 $sources=@($files | ForEach-Object { Join-Path $packageDir $_ })
 Copy-Item -LiteralPath $sources -Destination $dockerDir -Recurse -Force
 Write-ReleaseArchive $dockerDir
}
