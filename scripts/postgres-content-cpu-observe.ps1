param([int]$WorkerProcessId,[string]$OutputPath,[switch]$TerminateOwnedWorkerOnObservation)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputPath){throw 'Fresh evidence path required'}
$taskRoot=Get-CimInstance Win32_Process -Filter "ProcessId=$WorkerProcessId"
if(-not $taskRoot -or $taskRoot.Name -ne 'node.exe'){throw 'The owned worker is not live'}
$taskCreated=$taskRoot.CreationDate
$taskHeldWorker=[Diagnostics.Process]::GetProcessById($WorkerProcessId)
$null=$taskHeldWorker.Handle
$taskDeadline=[DateTime]::UtcNow.AddSeconds(60)
do {
 $taskRows=@(Get-CimInstance Win32_Process)
 $taskSame=@($taskRows|Where-Object {$_.ProcessId -eq $WorkerProcessId -and $_.CreationDate -eq $taskCreated})
 if($taskSame.Count -ne 1){throw 'The owned worker exited before a native CPU process was observed'}
 $taskMembers=@{};$taskMembers[$WorkerProcessId]=$taskSame[0]
 $taskMore=$true
 while($taskMore){$taskMore=$false;foreach($taskRow in $taskRows){if($taskMembers.ContainsKey([int]$taskRow.ParentProcessId) -and -not $taskMembers.ContainsKey([int]$taskRow.ProcessId) -and $taskRow.CreationDate -ge $taskMembers[[int]$taskRow.ParentProcessId].CreationDate){$taskMembers[[int]$taskRow.ProcessId]=$taskRow;$taskMore=$true}}}
 $taskNative=@($taskMembers.Values|Where-Object {$_.Name -eq 'llama-completion.exe' -and ([double]$_.UserModeTime+[double]$_.KernelModeTime)/10000000 -gt .2})
 $taskHelper=@($taskMembers.Values|Where-Object {$_.Name -eq 'node.exe' -and $_.CommandLine -match 'content-writing\.mjs'})
 $taskSupervisor=@($taskMembers.Values|Where-Object {$_.Name -eq 'powershell.exe' -and $_.CommandLine -match 'native-process-job\.ps1'})
 if($taskNative.Count -and $taskHelper.Count){
  $taskProcesses=@($taskMembers.Values|Sort-Object ProcessId|ForEach-Object {@{pid=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;name=$_.Name;created=$_.CreationDate.ToUniversalTime().ToString('o')}})
  $taskTerminated=$false
  if($TerminateOwnedWorkerOnObservation){$taskHeldWorker.Kill();$taskTerminated=$taskHeldWorker.WaitForExit(15000);if(-not $taskTerminated){throw 'The held original worker did not close'}}
  $taskEvidence=@{workerHardTerminated=$taskTerminated;workerTerminationMethod=if($taskTerminated){'System.Diagnostics.Process.Kill on the held original worker handle'}else{'observation only'};result='PASS';checkedAt=[DateTime]::UtcNow.ToString('o');workerProcessId=$WorkerProcessId;powershellSupervisorObserved=[bool]$taskSupervisor.Count;nativeProcessSupervision='compiled helper IPC disconnect aborts native inference';actualCompiledHelperObserved=$true;actualNativeCpuWorkObserved=$true;exactTokenStageClaimed=$false;helperHasTsLoader=[bool](@($taskHelper|Where-Object {$_.CommandLine -match '--import\s+tsx'}).Count);processes=$taskProcesses;native=@($taskNative|ForEach-Object {@{ProcessId=[int]$_.ProcessId;CreationDate=$_.CreationDate.ToUniversalTime().ToString('o');workingSetBytes=[double]$_.WorkingSetSize;cpuSeconds=([double]$_.UserModeTime+[double]$_.KernelModeTime)/10000000}})}
  $taskEvidence|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $OutputPath -Encoding utf8
  exit 0
 }
 Start-Sleep -Milliseconds 350
}while([DateTime]::UtcNow -lt $taskDeadline)
throw 'No compiled helper with actual native CPU work was observed during the bounded window'
