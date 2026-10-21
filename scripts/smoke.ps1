[CmdletBinding()]
param([string]$BaseURL='http://127.0.0.1:19110', [string]$OutputDirectory='')
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if(-not $OutputDirectory){$OutputDirectory=Join-Path $projectRoot '.runtime/smoke'}
$health=(Invoke-RestMethod ($BaseURL+'/api/health')).data
if($health.name -ne 'Castorice-WebRuleAnalyzer' -or $health.version -ne 'v1.1'){throw 'Unexpected server'}
$session=(Invoke-RestMethod ($BaseURL+'/api/session')).data
$headers=@{'X-Castorice-Token'=$session.token}
function Post-JSON([string]$Path,$Value){return (Invoke-RestMethod ($BaseURL+$Path) -Method Post -ContentType 'application/json' -Headers $headers -Body ($Value|ConvertTo-Json -Depth 12 -Compress)).data}
$options=@{mode='quick';dns_mode='auto';max_seconds=30;max_depth=2;max_pages=20;navigation_seconds=15;quiet_millis=500;interval_millis=0;observe_seconds=2;visible=$false;browser_path=''}
$task=Post-JSON '/api/scans' @{url='https://example.com';options=$options}
$deadline=[DateTime]::UtcNow.AddSeconds(40)
do {
    Start-Sleep -Milliseconds 200
    $task=(Invoke-RestMethod ($BaseURL+'/api/scans/'+$task.id)).data
} while($task.status -in @('starting','running','stopping') -and [DateTime]::UtcNow -lt $deadline)
if($task.status -in @('starting','running','stopping')){Post-JSON ('/api/scans/'+$task.id+'/stop') @{} | Out-Null;throw 'Smoke timeout'}
if($task.status -ne 'completed' -or $task.test_mode){throw ('Normal-mode scan failed: '+($task|ConvertTo-Json -Depth 6))}
$domains=(Invoke-RestMethod ($BaseURL+'/api/scans/'+$task.id+'/domains')).data
$requests=(Invoke-RestMethod ($BaseURL+'/api/scans/'+$task.id+'/requests?limit=200')).data
if(-not ($domains | Where-Object { $_.hostname -eq 'example.com' -and $_.kind -eq 'domain' })){throw 'example.com not actually observed'}
if(-not ($requests.items | Where-Object { $_.resource_type -eq 'Document' -and $_.status_code -eq 200 })){throw 'Main document HTTP 200 not observed'}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$exports=@()
foreach($format in @('clash','provider','singbox')){
    $result=Post-JSON '/api/export' @{task_id=$task.id;mode='observed';category_ids=@();format=$format;policy='dibao';filename=('acceptance-'+$format);list_only=$false;use_suffix=$false;domains=@($domains|Where-Object kind -eq 'domain'|ForEach-Object hostname);excluded=@()}
    if($result.final_rules -lt 1){throw 'Empty export'}
    if($format -eq 'singbox' -and ($result.content|ConvertFrom-Json).version -ne 3){throw 'Bad sing-box version'}
    if($format -eq 'provider' -and $result.content -match ',dibao'){throw 'Provider includes policy'}
    [IO.File]::WriteAllText((Join-Path $OutputDirectory $result.filename),$result.content,[Text.UTF8Encoding]::new($false))
    $exports+=@{format=$format;file=$result.filename;rules=$result.final_rules}
}
$history=(Invoke-RestMethod ($BaseURL+'/api/scans')).data
if(-not ($history|Where-Object id -eq $task.id)){throw 'History not persisted'}
$report=@{health=$health;task=$task;domains=$domains;requests=$requests;exports=$exports}
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'acceptance.json'),($report|ConvertTo-Json -Depth 16),[Text.UTF8Encoding]::new($false))
Write-Host ('普通模式验收通过：'+$task.domain_count+' 个域名，'+$task.request_count+' 条请求，三种导出；结果 '+$OutputDirectory)
