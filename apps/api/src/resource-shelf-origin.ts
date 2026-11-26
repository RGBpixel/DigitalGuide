import type {Repository} from '@digitalguide/database';
import {AppError,type Principal} from '@digitalguide/domain';
import type {StudioTemplate} from '@digitalguide/contracts';
import {verifyShelfTemplateSelection,type ShelfRow,type ShelfSelectionRow} from '../../../packages/enterprise/src/shelf-policy.js';
import {sqliteTemplateShelfSource} from './resource-shelf-sources.js';
import type {StudioService} from './studio-service.js';
export function sqliteShelfTemplateSelection(studio:StudioService,p:Principal,w:string,selectionId:string,template:StudioTemplate|undefined){
 const selection=studio.repo.get<ShelfSelectionRow>('SELECT * FROM enterprise_shelf_selections WHERE id=? AND tenant_id=? AND actor_id=? AND workspace_id=? AND environment=? AND app_env=?',selectionId,p.tenantId,p.userId,w,studio.environment,studio.appEnv);
 const row=selection?studio.repo.get<ShelfRow>('SELECT * FROM enterprise_resource_shelf WHERE id=? AND tenant_id=? AND workspace_id=? AND environment=? AND app_env=?',selection.entry_id,p.tenantId,w,studio.environment,studio.appEnv):undefined;
 if(!selection||!row||!template)throw new AppError('NOT_FOUND','模板选用记录不存在或无权使用。',404);
 const source=sqliteTemplateShelfSource(studio,p,w,template,true);verifyShelfTemplateSelection(row,selection,{actorId:p.userId,workspaceId:w,templateId:template.id,templateVersion:template.version,sourceHash:source.hash,now:new Date().toISOString()});
}
export function claimSqliteShelfSelection(repo:Repository,p:Principal,selectionId:string,projectId:string,environment:string,appEnv:string){const result=repo.run('UPDATE enterprise_shelf_selections SET project_id=? WHERE id=? AND tenant_id=? AND actor_id=? AND environment=? AND app_env=? AND project_id IS NULL',projectId,selectionId,p.tenantId,p.userId,environment,appEnv);if(Number(result.changes)!==1)throw new AppError('SHELF_SELECTION_USED','选用记录已建立工程，请回货架重新选用。',409);}
