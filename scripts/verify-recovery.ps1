[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$CaseDirectory)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$casePath=[IO.Path]::GetFullPath($CaseDirectory)
$allowedRoot=Join-Path $projectRoot '.runtime'
if(-not $casePath.StartsWith($allowedRoot+[IO.Path]::DirectorySeparatorChar)){throw 'Recovery requires a test case under .runtime'}
$previous=Get-Content -LiteralPath (Join-Path $casePath 'acceptance-result.json') -Raw | ConvertFrom-Json
if($previous.scenario -ne 'force-crash' -or -not $previous.passed){throw 'Expected a passed force-crash case'}
$exe=Join-Path $casePath 'Castorice-WebRuleAnalyzer.exe'
$runtimePath=Join-Path $casePath 'data/runtime.json'
$oldPID=0
if(Test-Path -LiteralPath $runtimePath){$oldPID=(Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json).pid}
$env:CASTORICE_DESKTOP_TEST='1'; $env:CASTORICE_DESKTOP_TEST_PORT='19230'
$process=Start-Process -FilePath $exe -WindowStyle Hidden -PassThru
try {
 $deadline=[DateTime]::UtcNow.AddSeconds(25)
 $runtime=$null
 do {
  Start-Sleep -Milliseconds 200
  if(Test-Path -LiteralPath $runtimePath){try{$runtime=Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json}catch{$runtime=$null}}
 } while((!$runtime -or $runtime.pid -eq $oldPID -or -not(Get-Process -Id $runtime.pid -ErrorAction SilentlyContinue)) -and [DateTime]::UtcNow -lt $deadline)
 if(!$runtime -or $runtime.pid -eq $oldPID){throw 'Restart did not create a fresh runtime'}
 $task=(Invoke-RestMethod ($runtime.url+'/api/scans/'+$previous.task_id)).data
 if($task.status -ne 'failed' -or $task.end_reason -ne 'service_interrupted'){throw 'Interrupted task was not recovered'}
 if(@(Get-ChildItem -LiteralPath (Join-Path $casePath 'data/sessions') -Directory -Filter 'scan-*').Count){throw 'Stale profile remained'}
 & (Join-Path $PSScriptRoot 'smoke.ps1') -BaseURL $runtime.url -OutputDirectory (Join-Path $casePath 'exports/recovery')
 if(-not $?){throw 'Recovery smoke failed'}
 & node (Join-Path $PSScriptRoot 'close-test-window.mjs')
 if($LASTEXITCODE -ne 0){throw 'Native close failed'}
 if(-not $process.WaitForExit(15000)){throw 'Recovered application did not exit'}
 [IO.File]::WriteAllText((Join-Path $casePath 'recovery-result.json'),'{"passed":true,"interrupted_task_recovered":true,"stale_profiles":0,"next_scan_and_exports":true}')
 Write-Output 'PASS recovery: interrupted task, profile cleanup, subsequent public scan and exports'
} finally {
 Remove-Item Env:CASTORICE_DESKTOP_TEST,Env:CASTORICE_DESKTOP_TEST_PORT -ErrorAction SilentlyContinue
 if(-not $process.HasExited){Stop-Process -Id $process.Id -ErrorAction SilentlyContinue}
}
