param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Target)
$ErrorActionPreference = 'Stop'
$taskRepository = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskExpectedFile = [System.IO.Path]::GetFullPath((Join-Path $taskRepository 'storage\tools\ffmpeg-9.0.2\download.zip'))
if ($Source -ne 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip' -or [System.IO.Path]::GetFullPath($Target) -ne $taskExpectedFile) { throw 'Unexpected source or target path.' }
if (Test-Path -LiteralPath $taskExpectedFile) { throw 'Target already exists; not overwritten.' }
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri $Source -OutFile $taskExpectedFile -TimeoutSec 180
} catch {
  if (Test-Path -LiteralPath $taskExpectedFile) { Remove-Item -LiteralPath $taskExpectedFile }
  throw
}
