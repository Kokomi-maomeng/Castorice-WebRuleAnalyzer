[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$PackageDirectory,
 [ValidateSet('normal','active-close','force-crash')][string]$Scenario='normal',
 [switch]$SyncRules,
 [switch]$AutoClose,
 [int]$WaitForCloseSeconds=180
)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceExe=Join-Path ([IO.Path]::GetFullPath($PackageDirectory)) 'Castorice-WebRuleAnalyzer.exe'
if(-not(Test-Path -LiteralPath $sourceExe -PathType Leaf)){throw 'Release executable missing'}
$caseDir=Join-Path $projectRoot ('.runtime/桌面验收 空格/'+$Scenario+'-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $caseDir -Force | Out-Null
$caseExe=Join-Path $caseDir 'Castorice-WebRuleAnalyzer.exe'
Copy-Item -LiteralPath $sourceExe -Destination $caseExe
$runtimePath=Join-Path $caseDir 'data/runtime.json'
$runtime=$null;$supervisor=$null;$ownedBefore=@();$task=$null
function Wait-Runtime {
 $deadline=[DateTime]::UtcNow.AddSeconds(25)
 do{
  if(Test-Path -LiteralPath $runtimePath){try{$r=Get-Content -LiteralPath $runtimePath -Raw|ConvertFrom-Json;if($r.version -eq 'v1.3' -and (Get-Process -Id $r.pid -ErrorAction SilentlyContinue)){return $r}}catch{}}
  Start-Sleep -Milliseconds 150
 }while([DateTime]::UtcNow -lt $deadline)
 throw 'Native startup timed out'
}
function Owned-Processes {
 $all=@(Get-CimInstance Win32_Process)
 $owned=@{};if($supervisor){$owned[[int]$supervisor.Id]=$true}
 for($iteration=0;$iteration -lt 12;$iteration++){
  $changed=$false
  foreach($proc in $all){if(($owned.ContainsKey([int]$proc.ParentProcessId) -or $proc.ExecutablePath -eq $caseExe) -and -not $owned.ContainsKey([int]$proc.ProcessId)){$owned[[int]$proc.ProcessId]=$true;$changed=$true}}
  if(-not $changed){break}
 }
 @($all|Where-Object{$owned.ContainsKey([int]$_.ProcessId)}|Select-Object ProcessId,ParentProcessId,Name)
}
function Post-JSON([string]$Path,$Body){(Invoke-RestMethod ($runtime.url+$Path) -Method Post -ContentType 'application/json' -Headers $headers -Body ($Body|ConvertTo-Json -Depth 10 -Compress)).data}
try {
 if($AutoClose){$env:CASTORICE_DESKTOP_TEST='1';$env:CASTORICE_DESKTOP_TEST_PORT='19230'}
 $supervisor=Start-Process -FilePath $caseExe -WorkingDirectory $env:SystemRoot -WindowStyle Hidden -PassThru
 $runtime=Wait-Runtime
 $session=(Invoke-RestMethod ($runtime.url+'/api/session')).data;$headers=@{'X-Castorice-Token'=$session.token}
 $health=(Invoke-RestMethod ($runtime.url+'/api/health')).data
 if($health.version -ne 'v1.3'){throw 'Unexpected version'}
 if($Scenario -eq 'normal'){
  & (Join-Path $PSScriptRoot 'smoke.ps1') -BaseURL $runtime.url -OutputDirectory (Join-Path $caseDir 'exports/api-acceptance')
  if(-not $?){throw 'Packaged API acceptance failed'}
  foreach($file in Get-ChildItem -LiteralPath (Join-Path $caseDir 'exports/api-acceptance') -File|Where-Object Extension -in @('.yaml','.json')){
   if($file.Name -eq 'acceptance.json'){continue}
   $saved=Post-JSON '/api/desktop/export' @{filename=('中文桌面-'+$file.Name);content=[IO.File]::ReadAllText($file.FullName)}
   if(-not $saved.path.StartsWith((Join-Path $caseDir 'exports')+[IO.Path]::DirectorySeparatorChar)){throw 'Export escaped application folder'}
   if(-not(Test-Path -LiteralPath $saved.path)){throw 'Native file not written'}
  }
  $settings=(Invoke-RestMethod ($runtime.url+'/api/settings')).data
  $settings.theme='dark';$settings.policy='桌面验证组'
  Invoke-RestMethod ($runtime.url+'/api/settings') -Method Put -Headers $headers -ContentType 'application/json' -Body ($settings|ConvertTo-Json -Depth 8 -Compress) | Out-Null
  if($SyncRules){foreach($source in @('blackmatrix7','v2fly')){Post-JSON '/api/rules/sync' @{source=$source}|Out-Null}}
 } else {
  $options=@{mode='interactive';dns_mode='auto';max_seconds=180;max_depth=2;max_pages=20;navigation_seconds=15;quiet_millis=500;interval_millis=0;observe_seconds=2;visible=$true;browser_path=''}
  $task=Post-JSON '/api/scans' @{url='https://example.com';options=$options}
  $deadline=[DateTime]::UtcNow.AddSeconds(20)
  do{Start-Sleep -Milliseconds 200;$task=(Invoke-RestMethod ($runtime.url+'/api/scans/'+$task.id)).data}while($task.status -eq 'starting' -and [DateTime]::UtcNow -lt $deadline)
  if($task.status -ne 'running'){throw ('Interactive browser did not start: '+$task.status)}
 }
 $ownedBefore=@(Owned-Processes)
 [IO.File]::WriteAllText((Join-Path $caseDir 'data/acceptance-ready.json'),(@{scenario=$Scenario;url=$runtime.url;supervisor_pid=$supervisor.Id;owned=$ownedBefore}|ConvertTo-Json -Depth 6))
 Write-Host ('READY '+$Scenario+'：'+$caseDir+'；请关闭原生主窗口（测试会检查整个进程树和端口）。')
 if($Scenario -eq 'force-crash'){Stop-Process -Id $supervisor.Id -ErrorAction Stop}
 elseif($AutoClose){& node (Join-Path $PSScriptRoot 'close-test-window.mjs');if($LASTEXITCODE -ne 0){throw 'Native test close failed'}}
 $deadline=[DateTime]::UtcNow.AddSeconds($WaitForCloseSeconds)
 while(-not $supervisor.HasExited -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 250;$supervisor.Refresh()}
 if(-not $supervisor.HasExited){throw 'Window was not closed before deadline'}
 $deadline=[DateTime]::UtcNow.AddSeconds(8)
 do{$remaining=@(Owned-Processes);if($remaining.Count -eq 0){break};Start-Sleep -Milliseconds 200}while([DateTime]::UtcNow -lt $deadline)
 if($remaining.Count){throw ('Owned child processes remained: '+($remaining|ConvertTo-Json -Compress))}
 try{Invoke-RestMethod ($runtime.url+'/api/health') -TimeoutSec 2|Out-Null;throw 'Listener remained open'}catch{if($_.Exception.Message -eq 'Listener remained open'){throw}}
 if($Scenario -ne 'force-crash'){
  $exitReport=Get-Content -LiteralPath (Join-Path $caseDir 'data/logs/last-exit.json') -Raw|ConvertFrom-Json
  if($exitReport.RemainingProcesses -ne 0 -or $exitReport.exit_code -ne 0 -or $exitReport.cleanup_errors.Count){throw 'Shutdown report reported incomplete cleanup'}
  if(@(Get-ChildItem -LiteralPath (Join-Path $caseDir 'data/sessions') -Directory -Filter 'scan-*').Count){throw 'Session profile remained'}
  if(@(Get-ChildItem -LiteralPath (Join-Path $caseDir 'data/tmp') -Force).Count){throw 'Temporary files remained'}
 }
 $result=@{version='v1.3';scenario=$Scenario;executable_sha256=(Get-FileHash -LiteralPath $caseExe -Algorithm SHA256).Hash;owned_before=$ownedBefore;remaining_processes=$remaining.Count;listener_closed=$true;task_id=$task.id;passed=$true;case_directory=$caseDir}
 $resultPath=Join-Path $caseDir 'acceptance-result.json'
 [IO.File]::WriteAllText($resultPath,($result|ConvertTo-Json -Depth 8))
 Write-Host ('PASS '+$Scenario+'：无残留进程或监听端口；'+$resultPath)
} finally {
 if($AutoClose){Remove-Item Env:CASTORICE_DESKTOP_TEST,Env:CASTORICE_DESKTOP_TEST_PORT -ErrorAction SilentlyContinue}
 if($supervisor){$supervisor.Refresh();if(-not $supervisor.HasExited){Stop-Process -Id $supervisor.Id -ErrorAction SilentlyContinue}}
}
