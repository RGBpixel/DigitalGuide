import './asset-expiry.css';
export function assetExpired(expiresAt:string|null,now=Date.now()){return expiresAt!==null&&new Date(expiresAt).getTime()<=now;}
export function AssetExpiry({expiresAt,now=Date.now()}:{expiresAt:string|null;now?:number}){
 if(!expiresAt)return null;const expires=new Date(expiresAt),left=expires.getTime()-now,ended=left<=0,soon=!ended&&left<=7*86400000;
 return <p className="asset-expiry" role="status"><span className={'badge '+(ended?'red':soon?'amber':'')}>{ended?'素材已到期':soon?'素材将在7天内到期':'素材使用期限'}</span><small>{expires.toLocaleString('zh-CN')} 到期{ended?'，请核对新的素材使用权限。':soon?'，请提前核对后续使用权限。':''}</small></p>;
}
