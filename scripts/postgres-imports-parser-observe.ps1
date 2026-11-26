param([int]$WorkerProcessId,[string]$OutputPath)
$ErrorActionPreference='Stop'
if($WorkerProcessId -le 0 -or (Test-Path -LiteralPath $OutputPath)){throw 'Positive owned process and fresh evidence path required'}
$taskDeadline=[DateTime]::UtcNow.AddSeconds(35)
do {
 $taskAll=@(Get-CimInstance Win32_Process)
 $taskRoot=@($taskAll|Where-Object {[int]$_.ProcessId -eq $WorkerProcessId})[0]
 if($null -eq $taskRoot){throw 'Owned worker already exited'}
 $taskParsers=@($taskAll|Where-Object {[int]$_.ParentProcessId -eq $WorkerProcessId -and $_.CreationDate -ge $taskRoot.CreationDate -and $_.CommandLine -like '*document-import.mjs*'})
 if($taskParsers.Count -gt 0){
  $taskParser=$taskParsers[0]
  $taskProcesses=@(@($taskRoot,$taskParser)|ForEach-Object {@{pid=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;name=$_.Name;created=$_.CreationDate.ToUniversalTime().ToString('o')}})
  @{result='PASS';processes=$taskProcesses;actualCompiledParserObserved=$true;parserHasTsLoader=[bool]($taskParser.CommandLine -match 'tsx|\.ts(?:\s|$)');identityFields=@('ProcessId','CreationDate');observedAt=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $OutputPath -Encoding UTF8
  exit 0
 }
 Start-Sleep -Milliseconds 50
}while([DateTime]::UtcNow -lt $taskDeadline)
throw 'Actual compiled document parser was not observed'
