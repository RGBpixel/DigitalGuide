param([int]$WorkerProcessId,[string]$NativeDataDir,[string]$OutputPath)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputPath){throw 'Fresh evidence path required'}
$taskData=[IO.Path]::GetFullPath($NativeDataDir).TrimEnd('\')+'\'
$taskOriginal=Get-CimInstance Win32_Process -Filter "ProcessId=$WorkerProcessId"
if(-not $taskOriginal -or $taskOriginal.Name -ne 'node.exe' -or $taskOriginal.CommandLine -notmatch 'dist[\\/]worker\.mjs'){throw 'Expected the owned compiled native worker'}
$taskHeld=[Diagnostics.Process]::GetProcessById($WorkerProcessId)
$null=$taskHeld.Handle
$taskUntil=[DateTime]::UtcNow.AddSeconds(60)
do{
 $taskRows=@(Get-CimInstance Win32_Process)
 $taskRoot=@($taskRows | Where-Object {$_.ProcessId -eq $WorkerProcessId -and $_.CreationDate -eq $taskOriginal.CreationDate})
 if($taskRoot.Count -ne 1){throw 'Original owned worker closed before ASR observation'}
 $taskMembers=@{};$taskMembers[$WorkerProcessId]=$taskRoot[0];$taskMore=$true
 while($taskMore){$taskMore=$false;foreach($taskRow in $taskRows){if($taskMembers.ContainsKey([int]$taskRow.ParentProcessId) -and -not $taskMembers.ContainsKey([int]$taskRow.ProcessId) -and $taskRow.CreationDate -ge $taskMembers[[int]$taskRow.ParentProcessId].CreationDate){$taskMembers[[int]$taskRow.ProcessId]=$taskRow;$taskMore=$true}}}
 $taskAsr=@($taskMembers.Values | Where-Object {$_.Name -eq 'powershell.exe' -and $_.CommandLine -match 'system-asr\.ps1' -and $_.CommandLine -match '-InputPath\s+' -and ([double]$_.UserModeTime+[double]$_.KernelModeTime)/10000000 -gt .2})
 foreach($taskChild in $taskAsr){
  $taskMatch=[regex]::Match($taskChild.CommandLine,'-InputPath\s+(?:"([^"]+)"|(\S+))')
  $taskInput=if($taskMatch.Groups[1].Success){$taskMatch.Groups[1].Value}else{$taskMatch.Groups[2].Value}
  if(-not [IO.Path]::GetFullPath($taskInput).StartsWith($taskData,[StringComparison]::OrdinalIgnoreCase)){throw 'ASR request escaped the owned private runtime'}
  $taskRequest=Get-Content -LiteralPath $taskInput -Raw -Encoding utf8 | ConvertFrom-Json
  $taskAudio=[IO.Path]::GetFullPath([string]$taskRequest.audioFile)
  if(-not $taskAudio.StartsWith($taskData,[StringComparison]::OrdinalIgnoreCase)){throw 'ASR audio escaped the owned private runtime'}
  $taskFile=Get-Item -LiteralPath $taskAudio
  if($taskFile.Length -lt 44){throw 'ASR input has no real PCM audio'}
  $taskProcesses=@($taskMembers.Values | Sort-Object ProcessId | ForEach-Object {@{pid=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;name=$_.Name;created=$_.CreationDate.ToUniversalTime().ToString('o')}})
  $taskDigest=[Security.Cryptography.SHA256]::Create();$taskStream=[IO.File]::OpenRead($taskAudio);try{$taskAudioSHA=([BitConverter]::ToString($taskDigest.ComputeHash($taskStream))).Replace('-','').ToLowerInvariant()}finally{$taskStream.Dispose();$taskDigest.Dispose()}
  @{result='OBSERVED';processes=$taskProcesses;workerProcessId=$WorkerProcessId;actualFileAsrRequestProcessObserved=$true}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath ($OutputPath.Replace('.json','-before-kill.json')) -Encoding utf8
  $taskHeld.Kill();if(-not $taskHeld.WaitForExit(15000)){throw 'Held original worker did not close'}
  @{result='PASS';checkedAt=[DateTime]::UtcNow.ToString('o');workerProcessId=$WorkerProcessId;workerHardTerminated=$true;workerTerminationMethod='Process.Kill on held original compiled worker handle';actualFileAsrRequestProcessObserved=$true;exactRecognizedPhraseStageClaimed=$false;typescriptLoaderPresent=($taskOriginal.CommandLine -match '--import\s+tsx');audioBytes=$taskFile.Length;audioSHA256=$taskAudioSHA;processes=$taskProcesses;asrProcessId=[int]$taskChild.ProcessId;cpuSeconds=([double]$taskChild.UserModeTime+[double]$taskChild.KernelModeTime)/10000000}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $OutputPath -Encoding utf8
  exit 0
 }
 Start-Sleep -Milliseconds 100
}while([DateTime]::UtcNow -lt $taskUntil)
throw 'Owned actual file-ASR request process was not observed'
