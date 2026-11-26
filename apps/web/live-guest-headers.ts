import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Plugin} from 'vite';
export function liveGuestHeaders():Plugin {
 const protect=(request:IncomingMessage,response:ServerResponse,next:()=>void)=>{if(/^\/(?:live-guest|live-programme)\/[a-f0-9-]{36}(?:\?|$)/.test(request.url||'')){response.setHeader('Content-Security-Policy',"frame-ancestors 'none'");response.setHeader('X-Frame-Options','DENY');response.setHeader('Referrer-Policy','no-referrer');response.setHeader('Permissions-Policy',request.url?.startsWith('/live-programme/')?'camera=(), microphone=(), display-capture=()':'camera=(self), microphone=(self), display-capture=()');}next();};
 return{name:'digitalguide-live-guest-headers',configureServer(server){server.middlewares.use(protect);},configurePreviewServer(server){server.middlewares.use(protect);}};
}
