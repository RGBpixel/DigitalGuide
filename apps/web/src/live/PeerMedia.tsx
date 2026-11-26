import {useEffect,useRef} from 'react';
export function PeerMedia({stream,label,muted=true,controls=true}:{stream:MediaStream|null;label:string;muted?:boolean;controls?:boolean}){
 const element=useRef<HTMLVideoElement>(null);
 useEffect(()=>{const video=element.current;if(!video)return;video.srcObject=stream;if(stream)void video.play().catch(()=>{});return()=>{video.pause();video.srcObject=null;};},[stream]);
 useEffect(()=>{if(element.current){element.current.muted=muted;if(!muted&&stream)void element.current.play().catch(()=>{});}},[muted,stream]);
 return <video ref={element} aria-label={label} autoPlay playsInline muted={muted} controls={controls}/>;
}
