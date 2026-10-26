[CmdletBinding()]
param([switch]$Browser, [switch]$LiveRules, [switch]$LiveDNS, [switch]$Race)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$oldBrowser=$env:CASTORICE_BROWSER_TEST; $oldRules=$env:CASTORICE_RULES_LIVE; $oldDNS=$env:CASTORICE_DNS_LIVE
try {
    if($Browser){$env:CASTORICE_BROWSER_TEST='1'}
    if($LiveRules){$env:CASTORICE_RULES_LIVE='1'}
    if($LiveDNS){$env:CASTORICE_DNS_LIVE='1'}
    Push-Location (Join-Path $projectRoot 'backend')
    try {
        $testArgs=@('test','./...','-count=1','-timeout=12m')
        if($Race){$testArgs+= '-race'}
        & go @testArgs; if($LASTEXITCODE -ne 0){throw 'Go 测试失败'}
        & go vet ./...; if($LASTEXITCODE -ne 0){throw 'go vet 失败'}
    } finally { Pop-Location }
    Push-Location (Join-Path $projectRoot 'frontend')
    try { & npm.cmd test; if($LASTEXITCODE -ne 0){throw '前端测试失败'}; & npm.cmd run build; if($LASTEXITCODE -ne 0){throw '前端构建失败'} } finally { Pop-Location }
} finally {$env:CASTORICE_BROWSER_TEST=$oldBrowser; $env:CASTORICE_RULES_LIVE=$oldRules; $env:CASTORICE_DNS_LIVE=$oldDNS}
