[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$OutputFile)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$text=[Text.StringBuilder]::new()
[void]$text.AppendLine('Castorice-WebRuleAnalyzer v1.0 - bundled third-party license texts')
[void]$text.AppendLine('External rule datasets are downloaded separately and retain their own licenses.')
function Add-LicenseDirectory([string]$Component,[string]$Directory) {
    if(-not (Test-Path -LiteralPath $Directory)){return}
    $licenseFiles=Get-ChildItem -LiteralPath $Directory -File | Where-Object { $_.Name -match '^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$|-)' }
    foreach($licenseFile in $licenseFiles){
        [void]$text.AppendLine("`n================================================================")
        [void]$text.AppendLine($Component+' / '+$licenseFile.Name)
        [void]$text.AppendLine([IO.File]::ReadAllText($licenseFile.FullName))
    }
}
$goRoot=& go env GOROOT
if($LASTEXITCODE -ne 0){throw 'go env failed'}
Add-LicenseDirectory 'Go standard library' $goRoot
Push-Location (Join-Path $projectRoot 'backend')
try {
    $moduleRows=& go list -m -f '{{.Path}}|{{.Version}}|{{.Dir}}' all
    if($LASTEXITCODE -ne 0){throw 'Go module inventory failed'}
    foreach($row in $moduleRows){$fields=$row -split '\|',3;if($fields.Length -eq 3 -and $fields[1]){Add-LicenseDirectory ($fields[0]+' '+$fields[1]) $fields[2]}}
} finally{Pop-Location}
Push-Location (Join-Path $projectRoot 'frontend')
try {
    $packagePaths=& npm.cmd ls --omit=dev --all --parseable
    if($LASTEXITCODE -ne 0){throw 'npm production dependency inventory failed'}
    $seen=@{}
    foreach($packagePath in $packagePaths){
        $manifest=Join-Path $packagePath 'package.json'
        if(-not (Test-Path -LiteralPath $manifest)){continue}
        $package=Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
        if($package.name -eq 'castorice-webruleanalyzer'){continue}
        $key=$package.name+' '+$package.version
        if(-not $seen[$key]){Add-LicenseDirectory $key $packagePath;$seen[$key]=$true}
    }
} finally{Pop-Location}
$outputPath=[IO.Path]::GetFullPath($OutputFile)
New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($outputPath)) -Force | Out-Null
[IO.File]::WriteAllText($outputPath,$text.ToString(),[Text.UTF8Encoding]::new($false))
Write-Host ('已收集实际依赖许可证：'+$outputPath)
