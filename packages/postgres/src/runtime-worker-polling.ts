/** Idle queues yield database capacity; running jobs keep their own concurrency. */
export class NativeWorkerPolling {
 private readonly due=new Map<string,number>();
 constructor(private readonly now=()=>performance.now(),private readonly idleDelayMs=500,private readonly failureDelayMs=1000){}
 async run<T>(key:string,work:()=>Promise<T>):Promise<T|false>{
  if(this.now()<(this.due.get(key)??0))return false;
  try{const result=await work();this.due.set(key,this.now()+(result===false||result==null?this.idleDelayMs:0));return result;}
  catch(error){this.due.set(key,this.now()+this.failureDelayMs);throw error;}
 }
}
