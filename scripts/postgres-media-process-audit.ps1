param([ValidateSet('observe','closed')][string]$Mode,[string]$InputPath,[string]$OutputPath,[int]$Port)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputPath){throw 'Audit output already exists'}
$taskInput=Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
if($Mode -eq 'observe'){
 $taskProcesses=@(Get-CimInstance Win32_Process)
 $taskSelected=@{}
 foreach($taskId in $taskInput){
  if([int]$taskId -le 0){throw 'Positive root ProcessId required'}
  $taskRoot=@($taskProcesses|Where-Object {[int]$_.ProcessId -eq [int]$taskId})
  if($taskRoot.Count -gt 0){$taskSelected[[int]$taskId]=$taskRoot[0]}
 }
 $taskRejected=@{}
 do{
  $taskChanged=$false
  foreach($taskProcess in $taskProcesses){
   $taskParent=$taskSelected[[int]$taskProcess.ParentProcessId]
   if($null -eq $taskParent -or $taskSelected.ContainsKey([int]$taskProcess.ProcessId)){continue}
   # ParentProcessId alone is insufficient: Windows may reuse a dead parent's ID.
   if($taskProcess.CreationDate.ToUniversalTime() -lt $taskParent.CreationDate.ToUniversalTime()){
    $taskRejected[[int]$taskProcess.ProcessId]=@{pid=[int]$taskProcess.ProcessId;parent=[int]$taskProcess.ParentProcessId;name=$taskProcess.Name;created=$taskProcess.CreationDate.ToUniversalTime().ToString('o');currentParentCreated=$taskParent.CreationDate.ToUniversalTime().ToString('o');reason='child_created_before_current_parent_identity'}
    continue
   }
   $taskSelected[[int]$taskProcess.ProcessId]=$taskProcess
   $taskChanged=$true
  }
 }while($taskChanged)
 $taskFound=@($taskSelected.Values | Sort-Object ProcessId | ForEach-Object {@{pid=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;name=$_.Name;created=$_.CreationDate.ToUniversalTime().ToString('o')}})
 $taskResult=@{result='PASS';processes=$taskFound;rejectedStaleParentEdges=@($taskRejected.Values);identityFields=@('ProcessId','CreationDate');observedAt=[DateTime]::UtcNow.ToString('o')}
}else{
 $taskAlive=@()
 foreach($taskPrevious in $taskInput.processes){$taskCurrent=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$taskPrevious.pid);if($null -ne $taskCurrent -and $taskCurrent.CreationDate.ToUniversalTime().ToString('o') -eq $taskPrevious.created){$taskAlive+=[int]$taskPrevious.pid}}
 $taskListeners=@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
 $taskResult=@{result=if($taskAlive.Count -eq 0 -and $taskListeners.Count -eq 0){'PASS'}else{'FAIL'};alive=$taskAlive;listeners=$taskListeners.Count;identityFields=@('ProcessId','CreationDate');checkedAt=[DateTime]::UtcNow.ToString('o')}
}
$taskResult | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
if($taskResult.result -ne 'PASS'){exit 1}
