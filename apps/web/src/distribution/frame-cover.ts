export async function videoFramePng(video:HTMLVideoElement){
 if(video.readyState<2||!video.videoWidth||!video.videoHeight)throw new Error('视频画面尚未加载，请等待或重新载入成片。');
 const scale=Math.min(1,1280/Math.max(video.videoWidth,video.videoHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));const context=canvas.getContext('2d');if(!context)throw new Error('浏览器暂时无法生成封面，请使用其他PNG素材。');
 const timeMs=Math.round(video.currentTime*1000);context.drawImage(video,0,0,canvas.width,canvas.height);const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('封面编码失败，请重新选择画面。')),'image/png'));if(blob.size>8*1024*1024)throw new Error('生成封面超过8 MB，请选择其他画面或上传压缩后的PNG。');
 const contentBase64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('封面读取失败，请重试。'));reader.onload=()=>{if(typeof reader.result!=='string'||!reader.result.startsWith('data:image/png;base64,'))reject(new Error('封面格式不正确，请重试。'));else resolve(reader.result.split(',')[1]);};reader.readAsDataURL(blob);});
 return {contentBase64,width:canvas.width,height:canvas.height,timeMs};
}
