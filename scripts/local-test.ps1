# Run this test-only server in one terminal; use the printed explicit flags in
# another terminal. Never use these flags for ordinary untrusted website scans.
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Write-Host '测试站 URL：http://scan.test:19111'
Write-Host '后端测试启动命令（在 backend 目录）：'
Write-Host 'go run ./cmd/castorice --no-open --test-map-loopback "scan.test:19111=127.0.0.1,assets.scan.test:19111=127.0.0.1,api.scan.test:19111=127.0.0.1"'
Push-Location (Join-Path $projectRoot 'backend')
try { & go run ./cmd/testsite --mapped-hosts --listen 127.0.0.1:19111 } finally { Pop-Location }
