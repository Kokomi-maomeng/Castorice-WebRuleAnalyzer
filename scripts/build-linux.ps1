[CmdletBinding()]
param([switch]$SkipFrontend)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$packageDir=Join-Path $projectRoot 'dist/Castorice-WebRuleAnalyzer-v1.3-linux-amd64'
foreach($runtimeFolder in @('data','exports')){if(Test-Path -LiteralPath (Join-Path $packageDir $runtimeFolder)){throw '发布目录包含运行数据，请先备份并换用干净构建目录。'}}
if(-not $SkipFrontend){
 Push-Location (Join-Path $projectRoot 'frontend')
 try { & npm.cmd ci --no-audit --no-fund; if($LASTEXITCODE -ne 0){throw 'npm ci failed'}; & npm.cmd run build; if($LASTEXITCODE -ne 0){throw 'Frontend build failed'} } finally {Pop-Location}
}
New-Item -ItemType Directory -Path $packageDir -Force | Out-Null
$oldOS=$env:GOOS; $oldArch=$env:GOARCH; $oldCGO=$env:CGO_ENABLED
Push-Location (Join-Path $projectRoot 'backend')
try {
 $env:GOOS='linux'; $env:GOARCH='amd64'; $env:CGO_ENABLED='0'
 & go build -trimpath -buildvcs=false -ldflags='-s -w' -o (Join-Path $packageDir 'castorice') ./cmd/castorice
 if($LASTEXITCODE -ne 0){throw 'Linux build failed'}
} finally {Pop-Location; $env:GOOS=$oldOS; $env:GOARCH=$oldArch; $env:CGO_ENABLED=$oldCGO}
Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md'),(Join-Path $projectRoot 'LICENSE'),(Join-Path $projectRoot 'CHANGELOG.md') -Destination $packageDir -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs') -Destination $packageDir -Recurse -Force
$launcher = '#!/bin/sh' + "`n" + 'set -eu' + "`n" + 'cd -- "$(dirname -- "$0")"' + "`n" + 'exec ./castorice --server --data-dir "$PWD/data" "$@"' + "`n"
[IO.File]::WriteAllText((Join-Path $packageDir 'start.sh'),$launcher,[Text.UTF8Encoding]::new($false))
$dockerfile=Join-Path $projectRoot 'deploy/Dockerfile.runtime'
Copy-Item -LiteralPath $dockerfile -Destination (Join-Path $packageDir 'Dockerfile') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'compose.yaml') -Destination $packageDir -Force
New-Item -ItemType Directory -Path (Join-Path $packageDir 'deploy') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'deploy/castorice-browser.apparmor') -Destination (Join-Path $packageDir 'deploy') -Force
& (Join-Path $PSScriptRoot 'collect-licenses.ps1') -OutputFile (Join-Path $packageDir 'THIRD-PARTY-LICENSES.txt')
$hash=(Get-FileHash -LiteralPath (Join-Path $packageDir 'castorice') -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $packageDir 'SHA256SUMS.txt'),$hash+'  castorice'+"`n")
Write-Host "Linux package: $packageDir (Linux: chmod +x castorice start.sh)"
