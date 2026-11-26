import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError } from '@digitalguide/domain';
const refused = (message:string) => new AppError('CONTENT_URL_REFUSED',message,422);
export function contentUrl(value:string) {
  let url:URL;try{url=new URL(value);}catch{throw refused('网页地址无效，请输入公开HTTPS页面。');}
  if(url.protocol!=='https:' || (url.port&&url.port!=='443') || url.username || url.password || url.href.length>2048)throw refused('只支持无账户密码、标准443端口的公开HTTPS页面。');
  const host=url.hostname.toLowerCase().replace(/\.$/,'').replace(/^\[|\]$/g,'');
  if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||!host.includes('.')||isIP(host))throw refused('不读取本机、内网或直接IP地址，请复制正文快照。');
  url.hash='';return url;
}
export function publicContentAddress(address:string) {
  const kind=isIP(address);
  if(kind===4){
    const [a,b,c]=address.split('.').map(Number);
    return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===2))||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113));
  }
  if(kind===6){
    // Permit ordinary global unicast only; reject transition/mapped, local, documentation and special-use ranges.
    const v=address.toLowerCase(), first=Number.parseInt(v.split(':')[0],16);
    const second=Number.parseInt(v.split(':')[1]||'0',16);
    return first>=0x2000&&first<=0x3fff&&!(first===0x2001&&(second<0x200||second===0xdb8))&&first!==0x2002&&!v.startsWith('3fff:');
  }
  return false;
}
export async function fetchContentWeb(value:string, signal?:AbortSignal):Promise<{bytes:Buffer;url:string;contentType:string}>{
  let url=contentUrl(value);
  const end=Date.now()+12000;
  for(let redirects=0;redirects<=3;redirects++){
    if(signal?.aborted)throw new AppError('CONTENT_FETCH_ABORTED','网页读取已取消。',409);
    const remaining=end-Date.now();if(remaining<=0)throw refused('网页读取超时，请复制正文快照。');
    const deadline=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(remaining)]);
    let list:{address:string;family:number}[];
    try{list=await Promise.race([lookup(url.hostname,{all:true,verbatim:true}),new Promise<never>((_,reject)=>{deadline.addEventListener('abort',()=>reject(refused('网页解析超时，请复制正文。')),{once:true});})]);}catch{throw refused('网页域名解析失败或超时，请复制正文快照。');}
    if(!list.length||list.some(a=>!publicContentAddress(a.address)))throw refused('网页解析到非公开网络，已停止读取。');
    const chosen=list[0];
    const result=await new Promise<{status:number;location?:string;bytes:Buffer;type:string}>((resolve,reject)=>{
      const request=https.get(url,{
        signal:deadline,
        headers:{'User-Agent':'DigitalGuide-ContentReader/0.1','Accept':'text/html,text/plain;q=0.9','Accept-Encoding':'identity'},
        lookup:(_hostname,options,callback)=>{
          // Pin exactly the checked DNS address. TLS SNI and certificate validation still use the original hostname.
          if(typeof options==='object'&&options.all)callback(null,[chosen]);
          else callback(null,chosen.address,chosen.family);
        }
      },response=>{
        const status=response.statusCode||0,location=response.headers.location,type=String(response.headers['content-type']||'').toLowerCase(),encoding=response.headers['content-encoding'];
        if([301,302,303,307,308].includes(status)){response.destroy();resolve({status,location,bytes:Buffer.alloc(0),type});return;}
        if(status!==200 || !/^text\/(?:html|plain)(?:;|$)/.test(type) || (encoding&&encoding!=='identity') || (/charset\s*=/.test(type)&&!/charset\s*=\s*["']?utf-8\b/i.test(type))){response.destroy();reject(refused('网页不是可读取的UTF-8静态正文，或需要登录/脚本；请复制正文快照。'));return;}
        if(Number(response.headers['content-length']||0)>1000000){response.destroy();reject(refused('网页超过1MB，请选摘正文。'));return;}
        const chunks:Buffer[]=[];let size=0;
        response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>1000000){response.destroy();reject(refused('网页实际大小超过1MB，请选摘正文。'));}else chunks.push(chunk);});
        response.on('error',()=>reject(refused('网页读取中断，请复制正文快照。')));
        response.on('end',()=>resolve({status,bytes:Buffer.concat(chunks),type}));
      });
      request.on('error',()=>reject(refused('网页连接失败或超时，请复制正文快照。')));
    });
    if([301,302,303,307,308].includes(result.status)){
      if(!result.location||redirects===3)throw refused('网页重定向过多或地址缺失，请复制正文。');
      url=contentUrl(new URL(result.location,url).href);continue;
    }
    return {bytes:result.bytes,url:url.href,contentType:result.type};
  }
  throw refused('网页未能读取，请复制正文快照。');
}
