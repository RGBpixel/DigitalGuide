export type DirectoryRole='editor'|'reviewer'|'viewer';
export type CurrentDirectoryRole=DirectoryRole|'admin';
export type MemberStatus='active'|'suspended';
export interface DirectoryAccessState{
 currentRole:CurrentDirectoryRole;currentWorkspaceIds:string[];currentStatus:MemberStatus;
 baseKnown:boolean;canGrant:boolean;desiredRole:DirectoryRole;desiredWorkspaceIds:string[];
}
export interface DirectoryAccessPlan{
 role:DirectoryRole;workspaceIds:string[];status:MemberStatus;reviewRequired:boolean;
 mode:'apply'|'restrict_only'|'suspend_for_review';addedWorkspaceIds:string[];removedWorkspaceIds:string[];
}
export const directorySpaces=(...sets:readonly string[][])=>[...new Set(sets.flat())].sort();
export function planDirectoryAccess(input:DirectoryAccessState):DirectoryAccessPlan{
 const current=directorySpaces(input.currentWorkspaceIds),desired=directorySpaces(input.desiredWorkspaceIds);
 let role:DirectoryRole,workspaceIds:string[],status:MemberStatus,reviewRequired:boolean,mode:DirectoryAccessPlan['mode'];
 if(!input.baseKnown){role='viewer';workspaceIds=[];status='suspended';reviewRequired=true;mode='suspend_for_review';}
 else if(input.canGrant){role=input.desiredRole;workspaceIds=desired;status=input.currentStatus;reviewRequired=false;mode='apply';}
 else{role=input.currentRole==='admin'?'viewer':input.currentRole;workspaceIds=current.filter(id=>desired.includes(id));status=input.currentStatus;reviewRequired=true;mode='restrict_only';}
 return{role,workspaceIds,status,reviewRequired,mode,addedWorkspaceIds:workspaceIds.filter(id=>!current.includes(id)),removedWorkspaceIds:current.filter(id=>!workspaceIds.includes(id))};
}
