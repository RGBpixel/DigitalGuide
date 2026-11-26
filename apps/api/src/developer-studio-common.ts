import { AppError } from '@digitalguide/domain';
import type { StudioProject, StudioExport } from '@digitalguide/contracts';
import type { DeveloperStudioAuthority } from '../../../packages/enterprise/src/developer-studio-workflows.js';
import type { DeveloperStudioCommand } from './developer-studio-ports.js';
export function assertStudioCommand(authority:DeveloperStudioAuthority,command:DeveloperStudioCommand){
  const required=command.kind.startsWith('project.')?'projects.write':command.kind==='export.plan'||command.kind==='export.create'?'exports.submit':command.kind==='export.cancel'?'exports.cancel':command.kind==='export.file'?'exports.download':null;
  if(required&&!authority.actions.includes(required)||command.kind==='export.get'&&!authority.actions.some(action=>action.startsWith('exports.')))throw new AppError('DEVELOPER_STUDIO_ACTION_REQUIRED','应用未获得此制作动作，请管理员核对授权。',403);
}
// Application project editing does not expose person-session-only storyboard URLs.
export const applicationProject=(project:StudioProject):StudioProject=>({...project,frames:[]});
export const applicationExport=(authority:DeveloperStudioAuthority,row:StudioExport):StudioExport=>({...row,artifacts:row.artifacts.map(artifact=>({...artifact,url:artifact.url&&authority.actions.includes('exports.download')?'/api/open/v1/studio/exports/'+row.id+'/files/'+artifact.id:null}))});
export const studioOperationKind=(kind:'project.create'|'project.save'|'export.create'|'export.cancel')=>({'project.create':'project.created','project.save':'project.saved','export.create':'export.created','export.cancel':'export.cancelled'} as const)[kind];
