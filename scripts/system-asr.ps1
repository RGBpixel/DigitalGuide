param([switch]$List,[string]$InputPath,[string]$OutputPath,[int]$ParentProcessId)
$ErrorActionPreference='Stop'
try {
 [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
 Add-Type -AssemblyName System.Speech
 $taskOwner=Get-Process -Id $ParentProcessId -ErrorAction Stop
 [void]$taskOwner.Handle
 $taskRecognizers=@([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers())
 if ($List) {
  $taskRows=@($taskRecognizers | ForEach-Object { @{id=$_.Id;name=$_.Description;locale=$_.Culture.Name;engineVersion=[System.Speech.Recognition.SpeechRecognitionEngine].Assembly.GetName().Version.ToString()} })
  ConvertTo-Json -InputObject $taskRows -Compress
 } else {
  if ([string]::IsNullOrWhiteSpace($InputPath) -or [string]::IsNullOrWhiteSpace($OutputPath)) { throw 'Missing controlled paths' }
  $taskRequest=Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $taskSelected=@($taskRecognizers | Where-Object { $_.Id -ceq $taskRequest.recognizerId -and $_.Culture.Name -ceq $taskRequest.locale })
  if ($taskSelected.Count -ne 1) { throw 'Requested recognizer unavailable' }
  $taskFile=Get-Item -LiteralPath ([string]$taskRequest.audioFile)
  if ($taskFile.Length -lt 44 -or $taskFile.Length -gt 19210000) { throw 'Invalid audio size' }
  Add-Type -ReferencedAssemblies ([System.Speech.Recognition.SpeechRecognitionEngine].Assembly.Location) -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Speech.Recognition;
public class DigitalGuideAsrWord { public string text; public double confidence; }
public class DigitalGuideAsrSegment { public string text; public double startMs; public double durationMs; public double confidence; public List<DigitalGuideAsrWord> words; }
public class DigitalGuideAsrReport { public bool inputStreamEnded; public int rejectedCount; public List<DigitalGuideAsrSegment> segments=new List<DigitalGuideAsrSegment>(); }
public static class DigitalGuideOfflineAsr {
 public static DigitalGuideAsrReport Recognize(string recognizerId,string file,int parentId) {
  var report=new DigitalGuideAsrReport();var gate=new object();var completed=new ManualResetEvent(false);Exception failure=null;int characters=0,words=0,lastProgress=0;bool cancelled=false;
  using(var owner=Process.GetProcessById(parentId)) using(var engine=new SpeechRecognitionEngine(recognizerId)) {
   var grammar=new DictationGrammar();engine.LoadGrammar(grammar);
   engine.InitialSilenceTimeout=TimeSpan.FromMinutes(11);engine.BabbleTimeout=TimeSpan.FromMinutes(11);engine.EndSilenceTimeout=TimeSpan.FromMilliseconds(550);engine.EndSilenceTimeoutAmbiguous=TimeSpan.FromMilliseconds(800);
   engine.SpeechRecognized+=(sender,args)=>{try{var r=args.Result;if(r==null||r.Audio==null)return;var segment=new DigitalGuideAsrSegment{text=r.Text,startMs=r.Audio.AudioPosition.TotalMilliseconds,durationMs=r.Audio.Duration.TotalMilliseconds,confidence=r.Confidence,words=new List<DigitalGuideAsrWord>()};foreach(var w in r.Words)segment.words.Add(new DigitalGuideAsrWord{text=w.Text,confidence=w.Confidence});lock(gate){characters+=segment.text.Length;words+=segment.words.Count;if(characters>60000||words>20000||report.segments.Count>=2000)throw new InvalidOperationException("Recognition limit");report.segments.Add(segment);}}catch(Exception e){lock(gate){failure=e;}}};
   engine.SpeechRecognitionRejected+=(sender,args)=>{lock(gate){report.rejectedCount++;}};
   engine.RecognizeCompleted+=(sender,args)=>{lock(gate){report.inputStreamEnded=args.InputStreamEnded;cancelled=args.Cancelled;if(args.Error!=null)failure=args.Error;}completed.Set();};
   engine.SetInputToWaveFile(file);engine.RecognizeAsync(RecognizeMode.Multiple);var watch=Stopwatch.StartNew();
   while(!completed.WaitOne(200)) {
    bool failed;lock(gate){failed=failure!=null;}
    if(owner.HasExited||failed||watch.Elapsed.TotalMinutes>20){engine.RecognizeAsyncCancel();completed.WaitOne(2000);throw new InvalidOperationException("Recognition interrupted");}
    int position=(int)engine.AudioPosition.TotalMilliseconds;if(position-lastProgress>=500){Console.WriteLine("{\"processedMs\":"+position.ToString(System.Globalization.CultureInfo.InvariantCulture)+"}");lastProgress=position;}
   }
   lock(gate){if(failure!=null||cancelled||!report.inputStreamEnded)throw new InvalidOperationException("Incomplete input stream");}
  }
  completed.Dispose();return report;
 }
}
'@
  $taskResult=[DigitalGuideOfflineAsr]::Recognize([string]$taskSelected[0].Id,$taskFile.FullName,$ParentProcessId)
  if ($taskOwner.HasExited) { throw 'Owner exited' }
  $taskJson=ConvertTo-Json -InputObject $taskResult -Depth 12 -Compress
  if ([System.Text.Encoding]::UTF8.GetByteCount($taskJson) -gt 4194304) { throw 'Recognition output limit' }
  [IO.File]::WriteAllText($OutputPath,$taskJson,[System.Text.UTF8Encoding]::new($false))
  ConvertTo-Json -InputObject @{result='completed';provider='windows-offline-asr';fileInputOnly=$true;inputStreamEnded=$taskResult.inputStreamEnded} -Compress
 }
} catch {
 [Console]::Error.WriteLine('SYSTEM_ASR_FAILED')
 exit 1
}
