param([int]$ParentProcessId,[string]$InputPath)
$ErrorActionPreference='Stop'
# A suspended native child joins a private kill-on-close Job before it executes.
# No user command text reaches a shell; this helper accepts a server-generated JSON argument array.
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public sealed class OwnedMediaJob : IDisposable {
 [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a,b,c,d,e,f; }
 [StructLayout(LayoutKind.Sequential)] struct BASIC { public long a,b; public uint flags; public UIntPtr d,e; public uint f; public UIntPtr g; public uint h,i; }
 [StructLayout(LayoutKind.Sequential)] struct LIMITS { public BASIC basic; public IO_COUNTERS io; public UIntPtr a,b,c,d; }
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct STARTUP { public uint cb; public string reserved,desktop,title; public uint x,y,xs,ys,xc,yc,fill,flags; public ushort show,r2; public IntPtr p2,input,output,error; }
 [StructLayout(LayoutKind.Sequential)] struct INFO { public IntPtr process,thread; public uint pid,tid; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr p,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int cls,ref LIMITS info,uint size);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string application,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUP startup,out INFO info);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job,uint code);
 [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
 [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 IntPtr job,process; public uint Pid;
 static string Quote(string text) {
  var b=new StringBuilder("\"");int slashes=0;
  foreach(char c in text) {if(c=='\\'){slashes++;continue;} if(c=='\"'){b.Append('\\',slashes*2+1);b.Append(c);}else{b.Append('\\',slashes);b.Append(c);}slashes=0;}
  b.Append('\\',slashes*2);b.Append('"');return b.ToString();
 }
 public OwnedMediaJob(string exe,string[] args,string cwd) {
  job=CreateJobObject(IntPtr.Zero,null);if(job==IntPtr.Zero)throw new Exception("job create");
  var limits=new LIMITS();limits.basic.flags=0x2000;
  if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(LIMITS)))) {Dispose();throw new Exception("job limit");}
  var cmd=new StringBuilder(Quote(exe));foreach(var s in args)cmd.Append(" ").Append(Quote(s));
  var startup=new STARTUP();startup.cb=(uint)Marshal.SizeOf(typeof(STARTUP));INFO info;
  if(!CreateProcess(exe,cmd,IntPtr.Zero,IntPtr.Zero,false,0x08000004,IntPtr.Zero,cwd,ref startup,out info)){Dispose();throw new Exception("process create");}
  process=info.process;Pid=info.pid;
  if(!AssignProcessToJobObject(job,process)){TerminateProcess(process,125);CloseHandle(info.thread);Dispose();throw new Exception("job assign");}
  if(ResumeThread(info.thread)==0xffffffff){CloseHandle(info.thread);Dispose();throw new Exception("resume");}CloseHandle(info.thread);
 }
 public bool Wait(int ms){return WaitForSingleObject(process,(uint)ms)==0;}
 public uint ExitCode(){uint c;return GetExitCodeProcess(process,out c)?c:126;}
 public void Stop(){if(job!=IntPtr.Zero)TerminateJobObject(job,130);if(process!=IntPtr.Zero)WaitForSingleObject(process,5000);}
 public void Dispose(){if(job!=IntPtr.Zero){CloseHandle(job);job=IntPtr.Zero;}if(process!=IntPtr.Zero){CloseHandle(process);process=IntPtr.Zero;}}
}
'@
$taskJob=$null
try {
 $taskParent=Get-Process -Id $ParentProcessId -ErrorAction Stop
 [void]$taskParent.Handle
 $taskConfig=Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
 if ($taskParent.HasExited) { throw 'Owner exited' }
 $taskJob=[OwnedMediaJob]::new([string]$taskConfig.executable,[string[]]$taskConfig.arguments,[string]$taskConfig.directory)
 [System.IO.File]::WriteAllText([string]$taskConfig.marker,('{"pid":'+$taskJob.Pid+',"jobObject":true}'),[System.Text.UTF8Encoding]::new($false))
 while (-not $taskJob.Wait(50)) {
  if ($taskParent.HasExited -or (Test-Path -LiteralPath ([string]$taskConfig.cancelFile))) { $taskJob.Stop();exit 130 }
 }
 exit ([int]$taskJob.ExitCode())
} catch { [Console]::Error.WriteLine('OWNED_MEDIA_NATIVE_FAILED');exit 1 }
finally { if ($null -ne $taskJob) { $taskJob.Stop();$taskJob.Dispose() } }
