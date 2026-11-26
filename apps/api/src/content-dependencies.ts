import type { Repository } from '@digitalguide/database';
import type { Principal } from '@digitalguide/domain';
import type { ContentSourceReference } from '@digitalguide/contracts';
export function checkContentReferences(repo:Repository,p:Principal,workspaceId:string,environment:string,appEnv:string,refs:ContentSourceReference[]) {
  repo.contentReferences(p,workspaceId,environment,appEnv,refs);
}
export function contentOriginReferences(repo:Repository,p:Principal,workspaceId:string,environment:string,appEnv:string,id:string):ContentSourceReference[] {
  return repo.contentOrigin(p,workspaceId,environment,appEnv,id);
}
