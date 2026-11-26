param([ValidateSet('observe','closed')][string]$Mode,[string]$InputPath,[string]$OutputPath,[int]$Port)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputPath){throw 'Audit output already exists'}
$taskInput=Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
if($Mode -eq 'observe'){
 $taskProcesses=@(Get-CimInstance Win32_Process)
 $taskIds=[System.Collections.Generic.HashSet[int]]::new()
 foreach($taskId in $taskInput){[void]$taskIds.Add([int]$taskId)}
 do{$taskChanged=$false;foreach($taskProcess in $taskProcesses){if($taskIds.Contains([int]$taskProcess.ParentProcessId) -and $taskIds.Add([int]$taskProcess.ProcessId)){$taskChanged=$true}}}while($taskChanged)
 $taskFound=@($taskProcesses | Where-Object {$taskIds.Contains([int]$_.ProcessId)} | ForEach-Object {@{pid=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;name=$_.Name;created=$_.CreationDate.ToUniversalTime().ToString('o')}})
 $taskResult=@{result='PASS';processes=$taskFound;observedAt=[DateTime]::UtcNow.ToString('o')}
}else{
 $taskAlive=@()
 foreach($taskPrevious in $taskInput.processes){$taskCurrent=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$taskPrevious.pid);if($null -ne $taskCurrent -and $taskCurrent.CreationDate.ToUniversalTime().ToString('o') -eq $taskPrevious.created){$taskAlive+=[int]$taskPrevious.pid}}
 $taskListeners=@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
 $taskResult=@{result=if($taskAlive.Count -eq 0 -and $taskListeners.Count -eq 0){'PASS'}else{'FAIL'};alive=$taskAlive;listeners=$taskListeners.Count;checkedAt=[DateTime]::UtcNow.ToString('o')}
}
$taskResult | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
if($taskResult.result -ne 'PASS'){exit 1}
