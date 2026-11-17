param([Parameter(Mandatory=$true)][string]$PackageDirectory)
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '../docs'
$target = Join-Path $PackageDirectory 'docs'
New-Item -ItemType Directory -Path $target -Force | Out-Null
$guides = @(
    '用户运行说明.md',
    'ARCHITECTURE.md',
    'EXPORT-INTEGRATION.md',
    'RELEASE-WORKFLOW.md',
    'TEST-REPORT.md',
    'THIRD-PARTY-NOTICES.md'
)
foreach ($guide in $guides) {
    Copy-Item -LiteralPath (Join-Path $source $guide) -Destination $target -Force
}
