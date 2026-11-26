param([Parameter(Mandatory=$true)][int]$HelperPid,[Parameter(Mandatory=$true)][string]$CompiledRoot,[Parameter(Mandatory=$true)][string]$ExpectedTool,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath($CompiledRoot)
$taskTool=[IO.Path]::GetFullPath($ExpectedTool)
$helper=Get-CimInstance Win32_Process -Filter "ProcessId=$HelperPid"
if(-not $helper -or -not $helper.CommandLine -or $helper.CommandLine.IndexOf((Join-Path $taskRoot 'dist\live-output.mjs'),[StringComparison]::OrdinalIgnoreCase) -lt 0){throw 'The helper is not the owned compiled live output process'}
$targets=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$HelperPid AND Name='ffmpeg.exe'" | Where-Object {$_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).Equals($taskTool,[StringComparison]::OrdinalIgnoreCase) -and $_.CommandLine -and $_.CommandLine.Contains('part-%06d.m4s') -and $_.CommandLine.Contains('live.m3u8')})
if($targets.Count -ne 1){throw 'A unique owned encoder was not observed'}
$target=$targets[0];$created=$target.CreationDate.ToUniversalTime().ToString('o')
$again=Get-CimInstance Win32_Process -Filter "ProcessId=$($target.ProcessId)"
if(-not $again -or $again.ParentProcessId -ne $HelperPid -or $again.CreationDate.ToUniversalTime().ToString('o') -ne $created){throw 'Encoder identity changed'}
Stop-Process -Id $target.ProcessId -Force
$deadline=[DateTime]::UtcNow.AddSeconds(10)
do{$remaining=Get-CimInstance Win32_Process -Filter "ProcessId=$($target.ProcessId)";if(-not $remaining -or $remaining.CreationDate.ToUniversalTime().ToString('o') -ne $created){break};Start-Sleep -Milliseconds 100}while([DateTime]::UtcNow -lt $deadline)
if($remaining -and $remaining.CreationDate.ToUniversalTime().ToString('o') -eq $created){throw 'Owned encoder did not close'}
$taskStream=[IO.File]::OpenRead($taskTool)
$taskHasher=[Security.Cryptography.SHA256]::Create()
try{$taskDigest=[BitConverter]::ToString($taskHasher.ComputeHash($taskStream)).Replace('-','').ToLowerInvariant()}finally{$taskHasher.Dispose();$taskStream.Dispose()}
@{result='PASS';encoderPid=[int]$target.ProcessId;helperPid=$HelperPid;created=$created;actualEncoderKilled=$true;executableSHA256=$taskDigest} | ConvertTo-Json | Set-Content -LiteralPath $OutputPath -Encoding UTF8 -NoNewline
