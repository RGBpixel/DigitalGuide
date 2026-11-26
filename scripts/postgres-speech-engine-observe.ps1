param([int]$WorkerProcessId,[string]$SpeechDirectory,[string]$JobId,[string]$OutputPath,[switch]$TerminateOwnedWorkerOnObservation)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputPath){throw 'Fresh evidence path required'}
if($JobId -notmatch '^[a-f0-9-]{36}$'){throw 'Exact owned job id required'}
$taskRoot=Get-CimInstance Win32_Process -Filter "ProcessId=$WorkerProcessId"
if(-not $taskRoot -or $taskRoot.Name -ne 'node.exe'){throw 'The owned worker is not live'}
$taskRootHandle=Get-Process -Id $WorkerProcessId -ErrorAction Stop
[void]$taskRootHandle.Handle
$taskDeadline=[DateTime]::UtcNow.AddSeconds(45)
$taskSeenHelpers=@{};$taskSeenFiles=@{};$taskLastChildren=@()
do {
 if($taskRootHandle.HasExited){throw 'Owned worker exited before SAPI observation'}
 $taskLastChildren=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$WorkerProcessId")
 $taskSapi=@($taskLastChildren|Where-Object {$_.CreationDate -ge $taskRoot.CreationDate -and $_.Name -eq 'powershell.exe' -and $_.CommandLine -match 'system-speech\.ps1' -and $_.CommandLine -match '-InputPath'})
 foreach($taskChild in $taskSapi){$taskSeenHelpers[[int]$taskChild.ProcessId]=$taskChild}
 $taskFiles=@(Get-ChildItem -LiteralPath $SpeechDirectory -Directory -ErrorAction SilentlyContinue|Where-Object {$_.Name.StartsWith($JobId+'-',[StringComparison]::Ordinal)}|ForEach-Object {Get-ChildItem -LiteralPath $_.FullName -File -Filter '*.part*.wav' -ErrorAction SilentlyContinue})
 foreach($taskFile in $taskFiles){$taskSeenFiles[$taskFile.FullName]=$taskFile.Length}
 if($taskSapi.Count -and $taskFiles.Count){
  $taskEngineHandle=Get-Process -Id $taskSapi[0].ProcessId -ErrorAction SilentlyContinue
  if($taskEngineHandle){[void]$taskEngineHandle.Handle}
  if($taskEngineHandle -and -not $taskEngineHandle.HasExited -and -not $taskRootHandle.HasExited){
   $taskSelected=@($taskRoot)+@($taskSapi)
   $taskEvidence=@{result='PASS';checkedAt=[DateTime]::UtcNow.ToString('o');workerProcessId=$WorkerProcessId;actualSystemSpeechHelperObserved=$true;actualOutputFileCreated=$true;actualPartialWavBytesObserved=[bool](@($taskFiles|Where-Object {$_.Length -gt 44}).Count);helperAliveAtTermination=[bool]$TerminateOwnedWorkerOnObservation;workerHardTerminated=[bool]$TerminateOwnedWorkerOnObservation;workerTerminationMethod=if($TerminateOwnedWorkerOnObservation){'System.Diagnostics.Process.Kill on the held original worker handle'}else{$null};processes=@($taskSelected|ForEach-Object {@{pid=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;name=$_.Name;created=$_.CreationDate.ToUniversalTime().ToString('o')}});partialWavSizes=@($taskFiles|ForEach-Object {$_.Length})}
   if($TerminateOwnedWorkerOnObservation){$taskRootHandle.Kill()}
   $taskEvidence|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $OutputPath -Encoding utf8
   exit 0
  }
 }
 Start-Sleep -Milliseconds 20
}while([DateTime]::UtcNow -lt $taskDeadline)
@{result='FAIL';checkedAt=[DateTime]::UtcNow.ToString('o');workerProcessId=$WorkerProcessId;seenHelperIds=@($taskSeenHelpers.Keys);seenPartialFileSizes=@($taskSeenFiles.Values);lastChildren=@($taskLastChildren|ForEach-Object {@{pid=[int]$_.ProcessId;name=$_.Name;inputSwitch=[bool]($_.CommandLine -match '-InputPath');speechScript=[bool]($_.CommandLine -match 'system-speech\.ps1')}})}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath ($OutputPath+'.failed.json') -Encoding utf8
throw 'No active SAPI helper and created output file were observed during the bounded window'
