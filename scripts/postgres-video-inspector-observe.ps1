param([int]$WorkerProcessId,[string]$OutputPath)
$ErrorActionPreference='Stop'
if($WorkerProcessId -le 0 -or (Test-Path -LiteralPath $OutputPath)){throw 'Positive owned process and fresh evidence path required'}
$taskDeadline=[DateTime]::UtcNow.AddSeconds(45)
do {
 $taskAll=@(Get-CimInstance Win32_Process)
 $taskRoot=@($taskAll|Where-Object {[int]$_.ProcessId -eq $WorkerProcessId})[0]
 if($null -eq $taskRoot){throw 'Owned worker already exited'}
 $taskInspect=@($taskAll|Where-Object {[int]$_.ParentProcessId -eq $WorkerProcessId -and $_.CreationDate -ge $taskRoot.CreationDate -and $_.CommandLine -like '*video-inspect.mjs*'})
 if($taskInspect.Count -gt 0){
  $taskInspector=$taskInspect[0]
  $taskCodec=@($taskAll|Where-Object {[int]$_.ParentProcessId -eq [int]$taskInspector.ProcessId -and $_.CreationDate -ge $taskInspector.CreationDate -and $_.Name -eq 'ffmpeg.exe'})
  if($taskCodec.Count -gt 0){
   $taskProcesses=@(@($taskRoot,$taskInspector)+$taskCodec|ForEach-Object {@{pid=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;name=$_.Name;created=$_.CreationDate.ToUniversalTime().ToString('o')}})
   @{result='PASS';processes=$taskProcesses;inspectorIsCompiled=$true;inspectorHasTsLoader=[bool]($taskInspector.CommandLine -match 'tsx|\.ts(?:\s|$)');actualFfmpegObserved=$true;identityFields=@('ProcessId','CreationDate');observedAt=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $OutputPath -Encoding UTF8
   exit 0
  }
 }
 Start-Sleep -Milliseconds 100
}while([DateTime]::UtcNow -lt $taskDeadline)
throw 'Actual compiled inspector and its FFmpeg child were not observed'
