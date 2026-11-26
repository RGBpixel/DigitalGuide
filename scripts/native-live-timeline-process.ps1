param([Parameter(Mandatory=$true)][int]$HelperPid,[Parameter(Mandatory=$true)][string]$CompiledRoot,[Parameter(Mandatory=$true)][string]$WorkRoot,[Parameter(Mandatory=$true)][string]$ExpectedTool,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath($CompiledRoot)
$taskWork=[IO.Path]::GetFullPath($WorkRoot)
$taskTool=[IO.Path]::GetFullPath($ExpectedTool)
if(-not $taskWork.StartsWith((Join-Path (Split-Path $taskRoot -Parent) 'compiled-native-data\live-timeline-work\'),[StringComparison]::OrdinalIgnoreCase)){throw 'Work directory is outside the owned private runtime'}
$helper=Get-CimInstance Win32_Process -Filter "ProcessId=$HelperPid"
if(-not $helper -or -not $helper.CommandLine -or $helper.CommandLine.IndexOf((Join-Path $taskRoot 'dist\live-timeline.mjs'),[StringComparison]::OrdinalIgnoreCase) -lt 0 -or $helper.CommandLine.IndexOf($taskWork,[StringComparison]::OrdinalIgnoreCase) -lt 0){throw 'The process is not the owned compiled timeline helper'}
$created=$helper.CreationDate.ToUniversalTime().ToString('o')
$deadline=[DateTime]::UtcNow.AddSeconds(12)
do{
 $encoders=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$HelperPid AND Name='ffmpeg.exe'" | Where-Object {$_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).Equals($taskTool,[StringComparison]::OrdinalIgnoreCase) -and $_.CommandLine -and $_.CommandLine.IndexOf($taskWork,[StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine.Contains('part-0.mkv')})
 if($encoders.Count -eq 1){break};Start-Sleep -Milliseconds 50
}while([DateTime]::UtcNow -lt $deadline)
if($encoders.Count -ne 1){throw 'A unique real encoder for the owned first timeline part was not observed'}
$encoder=$encoders[0];$encoderCreated=$encoder.CreationDate.ToUniversalTime().ToString('o')
$again=Get-CimInstance Win32_Process -Filter "ProcessId=$HelperPid"
if(-not $again -or $again.CreationDate.ToUniversalTime().ToString('o') -ne $created){throw 'Owned helper identity changed'}
Stop-Process -Id $HelperPid -Force
$deadline=[DateTime]::UtcNow.AddSeconds(10)
do{
 $left=Get-CimInstance Win32_Process -Filter "ProcessId=$($encoder.ProcessId)"
 if(-not $left -or $left.CreationDate.ToUniversalTime().ToString('o') -ne $encoderCreated){break};Start-Sleep -Milliseconds 100
}while([DateTime]::UtcNow -lt $deadline)
if($left -and $left.CreationDate.ToUniversalTime().ToString('o') -eq $encoderCreated){throw 'Actual FFmpeg descendant survived owned helper death'}
@{result='PASS';helperPid=$HelperPid;helperCreated=$created;encoderPid=[int]$encoder.ProcessId;encoderCreated=$encoderCreated;actualHelperKilled=$true;actualEncoderClosed=$true;workRoot=$taskWork} | ConvertTo-Json | Set-Content -LiteralPath $OutputPath -Encoding UTF8 -NoNewline
