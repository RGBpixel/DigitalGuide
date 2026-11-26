$ErrorActionPreference='Stop'
$taskWorkspace=(Resolve-Path -LiteralPath '.').Path
$taskRoot=(Resolve-Path -LiteralPath 'storage/postgres-native-tests/cluster-fxwB0E').Path
$taskSource=[IO.Path]::GetFullPath((Join-Path $taskRoot 'data/postmaster.pid'))
$taskTarget=[IO.Path]::GetFullPath((Join-Path $taskWorkspace 'docs/evidence/T20/postgres-speech/runtime/stale-owned-postmaster.pid.txt'))
$taskRecord=[IO.Path]::GetFullPath((Join-Path $taskWorkspace 'docs/evidence/T20/postgres-speech/runtime/owned-pid-cleanup.json'))
if(-not $taskRoot.StartsWith((Join-Path $taskWorkspace 'storage/postgres-native-tests')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Fixture root escaped workspace'}
foreach($taskPath in @($taskSource,$taskTarget,$taskRecord)){if(-not $taskPath.StartsWith($taskWorkspace+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Resolved file operation escaped workspace'}}
foreach($taskDir in @($taskRoot,(Join-Path $taskRoot 'data'),(Split-Path -Parent $taskTarget))){if((Get-Item -LiteralPath $taskDir).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked file operation rejected'}}
if((Get-Item -LiteralPath $taskSource).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked PID file rejected'}
if((Test-Path -LiteralPath $taskTarget) -or (Test-Path -LiteralPath $taskRecord)){throw 'Fresh evidence paths required'}
$taskLines=@(Get-Content -LiteralPath $taskSource)
$taskOldProcessId=[int]$taskLines[0]
$taskData=[IO.Path]::GetFullPath($taskLines[1])
if($taskData -ne [IO.Path]::GetFullPath((Join-Path $taskRoot 'data')) -or $taskOldProcessId -le 0){throw 'PID file belongs to another data directory'}
$taskStarted=[DateTimeOffset]::FromUnixTimeSeconds([long]$taskLines[2]).UtcDateTime
$taskPort=[int]$taskLines[3]
$taskRows=@(Get-CimInstance Win32_Process)
$taskSameId=@($taskRows|Where-Object {$_.ProcessId -eq $taskOldProcessId})
$taskOldIdentity=@($taskSameId|Where-Object {$_.Name -eq 'postgres.exe' -and [Math]::Abs(($_.CreationDate.ToUniversalTime()-$taskStarted).TotalSeconds) -lt 2})
$taskPointingAtData=@($taskRows|Where-Object {$_.CommandLine -and $_.CommandLine.IndexOf($taskData,[StringComparison]::OrdinalIgnoreCase) -ge 0})
$taskListeners=@(Get-NetTCPConnection -State Listen -LocalPort $taskPort -ErrorAction SilentlyContinue)
if($taskOldIdentity.Count -or $taskPointingAtData.Count -or $taskListeners.Count){throw 'Original process/data directory/port is still live; no file changed'}
$taskSHA=(Get-FileHash -LiteralPath $taskSource -Algorithm SHA256).Hash.ToLowerInvariant()
# One verified stale lock file only; original bytes move to evidence, without deleting data or stopping processes.
Move-Item -LiteralPath $taskSource -Destination $taskTarget -ErrorAction Stop
if((Get-FileHash -LiteralPath $taskTarget -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskSHA){throw 'Archived PID bytes changed'}
@{result='PASS';checkedAt=[DateTime]::UtcNow.ToString('o');source=$taskSource;archivedOriginal=$taskTarget;sha256=$taskSHA;originalProcessId=$taskOldProcessId;originalProcessStartedAt=$taskStarted.ToString('o');port=$taskPort;oldIdentityAlive=$false;dataDirectoryProcesses=0;listeners=0;processesStopped=0;databaseFilesDeletedOrRewritten=$false;resolvedPathsVerifiedInsideWorkspace=$true;earlierFailedClosureReportPreserved=$true}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $taskRecord -Encoding utf8
