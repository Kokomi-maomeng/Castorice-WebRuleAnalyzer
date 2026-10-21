[CmdletBinding()]
param([switch]$BackendOnly)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$npmCommand=(Get-Command npm.cmd -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'frontend/node_modules'))) {
    Push-Location (Join-Path $projectRoot 'frontend')
    try { & $npmCommand ci; if($LASTEXITCODE -ne 0){throw 'npm ci failed'} } finally { Pop-Location }
}
Push-Location (Join-Path $projectRoot 'frontend')
try { & $npmCommand run build; if($LASTEXITCODE -ne 0){throw '前端构建失败'} } finally { Pop-Location }
$viteProcess=$null
try {
    if (-not $BackendOnly) {
        $nodeCommand=(Get-Command node -ErrorAction Stop).Source
        $viteScript=Join-Path $projectRoot 'frontend/node_modules/vite/bin/vite.js'
        $viteProcess=Start-Process -FilePath $nodeCommand -ArgumentList @(('"'+$viteScript+'"'), '--host', '127.0.0.1') -WorkingDirectory (Join-Path $projectRoot 'frontend') -WindowStyle Hidden -PassThru
        Write-Host '前端热更新：http://127.0.0.1:5173 （后台 Vite，退出脚本自动停止）'
    }
    Push-Location (Join-Path $projectRoot 'backend')
    try { & go run ./cmd/castorice --no-open --listen 127.0.0.1:19110 --dev-origin http://127.0.0.1:5173 --data-dir (Join-Path $projectRoot '.runtime/dev'); if($LASTEXITCODE -ne 0){throw '后端退出'} } finally { Pop-Location }
} finally { if($viteProcess -and -not $viteProcess.HasExited){ Stop-Process -Id $viteProcess.Id -ErrorAction SilentlyContinue } }
