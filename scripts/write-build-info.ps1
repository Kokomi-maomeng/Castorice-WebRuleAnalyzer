param(
    [Parameter(Mandatory)][string]$PackageDirectory,
    [Parameter(Mandatory)][string]$Executable,
    [Parameter(Mandatory)][string]$Target
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$revision = $null
$tree = $null
$dirty = $null
if ((Get-Command git -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath (Join-Path $root '.git'))) {
    $revision = (& git -C $root rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Cannot determine build revision' }
    $tree = (& git -C $root rev-parse 'HEAD^{tree}').Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Cannot determine source tree' }
    $status = & git -C $root status --porcelain --untracked-files=normal
    if ($LASTEXITCODE -ne 0) { throw 'Cannot determine worktree status' }
    $dirty = [bool]$status
}
$binary = Join-Path $PackageDirectory $Executable
$buildData = & go version -m $binary
if ($LASTEXITCODE -ne 0) { throw 'Cannot read Go build metadata' }
if ($buildData[0] -notmatch ':\s+(go\S+)$') { throw 'Cannot parse Go toolchain version' }
$goVersion = $Matches[1]
$npmVersion = (& npm.cmd --version).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot read npm version' }
$nodeVersion = (& node --version).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot read Node version' }
$info = [ordered]@{
    version = (Get-Content -LiteralPath (Join-Path $root 'VERSION') -Raw).Trim()
    target = $Target
    source_revision = $revision
    source_tree = $tree
    source_dirty = $dirty
    node = $nodeVersion
    npm = $npmVersion
    go = $goVersion
    npm_lock_sha256 = (Get-FileHash -LiteralPath (Join-Path $root 'frontend/package-lock.json')).Hash.ToLowerInvariant()
    go_sum_sha256 = (Get-FileHash -LiteralPath (Join-Path $root 'backend/go.sum')).Hash.ToLowerInvariant()
    executable = $Executable
    executable_sha256 = (Get-FileHash -LiteralPath $binary).Hash.ToLowerInvariant()
}
[IO.File]::WriteAllText((Join-Path $PackageDirectory 'BUILD-INFO.json'), ($info | ConvertTo-Json) + [Environment]::NewLine)
