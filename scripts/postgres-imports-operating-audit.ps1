param([string]$OutputPath)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputPath){throw 'Fresh evidence path required'}
$taskWorkspace=(Get-Location).Path
$taskFixtureRoot=[IO.Path]::GetFullPath((Join-Path $taskWorkspace 'storage/postgres-native-tests'))
$taskBinaryRoot=[IO.Path]::GetFullPath((Join-Path $taskWorkspace 'storage/tools/postgresql/18.7-2'))
$taskClusters=@(Get-ChildItem -LiteralPath $taskFixtureRoot -Directory|ForEach-Object {
 $taskConnection=Join-Path $_.FullName 'connection.json'
 $taskPort=$null
 if(Test-Path -LiteralPath $taskConnection){$taskPort=(Get-Content -LiteralPath $taskConnection -Raw|ConvertFrom-Json).port}
 @{folder=$_.Name;port=$taskPort;postmasterPidFilePresent=[bool](Test-Path -LiteralPath (Join-Path $_.FullName 'data/postmaster.pid'));closureRecordPresent=[bool](Test-Path -LiteralPath (Join-Path $_.FullName 'native-runtime-closure.json'))}
})
$taskProcesses=@(Get-CimInstance Win32_Process)
$taskOwned=@($taskProcesses|Where-Object {
 ($_.Name -eq 'postgres.exe' -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($taskBinaryRoot,[StringComparison]::OrdinalIgnoreCase)) -or
 ($_.CommandLine -and $_.CommandLine.IndexOf($taskFixtureRoot,[StringComparison]::OrdinalIgnoreCase) -ge 0)
}|ForEach-Object {@{ProcessId=[int]$_.ProcessId;name=$_.Name;created=$_.CreationDate.ToUniversalTime().ToString('o')}})
$taskIds=@($taskOwned|ForEach-Object {$_.ProcessId})
$taskListeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$taskIds -contains $_.OwningProcess}|Select-Object LocalAddress,LocalPort,OwningProcess)
$taskResult=@{result=if($taskOwned.Count -eq 0 -and $taskListeners.Count -eq 0 -and @($taskClusters|Where-Object {$_.postmasterPidFilePresent}).Count -eq 0){'PASS'}else{'FAIL'};checkedAt=[DateTime]::UtcNow.ToString('o');privateClusters=$taskClusters;ownedProcesses=$taskOwned;listeners=$taskListeners;unrelatedProcessesStopped=$false;scope='Repository private fixture roots and repository PostgreSQL binaries; no action on unrelated reused historical ports'}
$taskResult|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $OutputPath -Encoding UTF8
if($taskResult.result -ne 'PASS'){exit 1}
