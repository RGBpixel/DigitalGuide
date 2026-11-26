export const isVideoMediaType=(value:string|undefined)=>value==='video/mp4'||value==='video/quicktime';
export const mediaFileExtension=(value:string)=>({'image/png':'png','audio/wav':'wav','video/mp4':'mp4','video/quicktime':'mov'} as Record<string,string>)[value];
