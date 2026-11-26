param([switch]$List,[string]$InputPath,[string]$OutputPath,[int]$ParentProcessId)
$ErrorActionPreference='Stop'
$taskVoice=$null
$taskStream=$null
try {
 [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
 $taskParentProcess=Get-Process -Id $ParentProcessId -ErrorAction Stop
 [void]$taskParentProcess.Handle
 $taskVoice=New-Object -ComObject SAPI.SpVoice
 $taskTokens=@($taskVoice.GetVoices())
 if ($List) {
  $taskRows=@($taskTokens | ForEach-Object {
   $taskToken=$_
   $taskLocales=@($taskToken.GetAttribute('Language').Split(';') | ForEach-Object { try { [System.Globalization.CultureInfo]::GetCultureInfo([Convert]::ToInt32($_,16)).Name } catch {} })
   @{tokenId=$taskToken.Id;name=$taskToken.GetDescription();locales=$taskLocales}
  })
  ConvertTo-Json -InputObject $taskRows -Compress
 } else {
  if ([string]::IsNullOrWhiteSpace($InputPath) -or [string]::IsNullOrWhiteSpace($OutputPath)) { throw 'Missing controlled input/output paths' }
  $taskInput=Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $taskSelected=@($taskTokens | Where-Object { $_.Id -ceq $taskInput.tokenId })
  if ($taskSelected.Count -ne 1) { throw 'Requested voice unavailable' }
  $taskVoice.Voice=$taskSelected[0]
  $taskParts=@($taskInput.chunks)
  if ($taskParts.Count -lt 1 -or $taskParts.Count -gt 101) { throw 'Invalid controlled speech chunk count' }
  for ($taskIndex=0;$taskIndex -lt $taskParts.Count;$taskIndex++) {
   if ($taskParentProcess.HasExited) { throw 'Owner exited' }
   $taskStream=New-Object -ComObject SAPI.SpFileStream
   $taskStream.Format.Type=22
   $taskStream.Open($OutputPath+'.part'+$taskIndex+'.wav',3,$false)
   $taskVoice.AudioOutputStream=$taskStream
   [void]$taskVoice.Speak([string]$taskParts[$taskIndex].sapiXml,9)
   while (-not $taskVoice.WaitUntilDone(100)) {
    if ($taskParentProcess.HasExited) { [void]$taskVoice.Speak('',2); throw 'Owner exited' }
   }
   if ($taskParentProcess.HasExited) { throw 'Owner exited' }
   $taskStream.Close()
   [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($taskStream)
   $taskStream=$null
  }
  ConvertTo-Json -InputObject @{result='completed';provider='windows-sapi';parts=$taskParts.Count;fileOutputOnly=$true} -Compress
 }
} catch {
 [Console]::Error.WriteLine('SYSTEM_SPEECH_FAILED')
 exit 1
} finally {
 if ($null -ne $taskStream) { try { $taskStream.Close() } catch {}; [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($taskStream) }
 if ($null -ne $taskVoice) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($taskVoice) }
}
