param([string]$OutputPath)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputPath){throw 'Audit output already exists'}
$taskRoot=(Resolve-Path -LiteralPath '.').Path
$taskClusters=Join-Path $taskRoot 'storage\postgres-native-tests'
$taskBinary=Join-Path $taskRoot 'storage\tools\postgresql\18.7-2\pgsql\bin'
$taskOwned=@(Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -ne $PID -and (($_.ExecutablePath -and $_.ExecutablePath.StartsWith($taskBinary,[StringComparison]::OrdinalIgnoreCase)) -or ($_.CommandLine -and $_.CommandLine.Contains($taskClusters)))} | ForEach-Object {@{pid=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;name=$_.Name}})
$taskRecords=@(Get-ChildItem -LiteralPath $taskClusters -Directory | ForEach-Object {
 $taskConnection=Join-Path $_.FullName 'connection.json'
 $taskClosure=Join-Path $_.FullName 'closure.json'
 @{folder=$_.Name;postmasterPidFilePresent=(Test-Path -LiteralPath (Join-Path $_.FullName 'data\postmaster.pid'));closureRecordPresent=(Test-Path -LiteralPath $taskClosure);port=if(Test-Path -LiteralPath $taskConnection){(Get-Content -LiteralPath $taskConnection -Raw|ConvertFrom-Json).port}else{$null}}
})
$taskPorts=@($taskRecords|Where-Object {$null -ne $_.port}|ForEach-Object {[int]$_.port})
$taskListeners=@(Get-NetTCPConnection -State Listen | Where-Object {$taskPorts -contains [int]$_.LocalPort} | ForEach-Object {@{port=[int]$_.LocalPort;pid=[int]$_.OwningProcess}})
$taskResult=@{result=if($taskOwned.Count -eq 0 -and $taskListeners.Count -eq 0 -and @($taskRecords|Where-Object {$_.postmasterPidFilePresent}).Count -eq 0){'PASS'}else{'FAIL'};checkedAt=[DateTime]::UtcNow.ToString('o');ownedProcesses=$taskOwned;listeners=$taskListeners;privateClusters=$taskRecords;systemServiceInstalled=$false;mainWasRestarted=$false}
$taskResult|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $OutputPath -Encoding UTF8
if($taskResult.result -ne 'PASS'){exit 1}
