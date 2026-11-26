import {z} from 'zod';

// R-037: publishing a reception alias never publishes an employee directory.
const alias=z.string().trim().min(1).max(40).refine(value=>[...value].every(c=>c.charCodeAt(0)>=32&&c.charCodeAt(0)!==127),'受访人称呼不能包含换行或控制字符');
export const receptionHostCreateInput=z.strictObject({workspaceId:z.uuid(),alias,recipientId:z.uuid(),enabled:z.boolean().default(true)});
export const receptionHostUpdateInput=receptionHostCreateInput.omit({workspaceId:true}).extend({version:z.int().positive()});
export const receptionHostListInput=z.strictObject({workspaceId:z.uuid(),cursor:z.uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(30)});
export const receptionHostSchema=z.object({id:z.uuid(),workspaceId:z.uuid(),alias:z.string(),recipientId:z.uuid(),recipientName:z.string(),recipientActive:z.boolean(),enabled:z.boolean(),version:z.int().positive(),disabledReason:z.enum(['manual','member_scope_withdrawn']).nullable(),createdAt:z.iso.datetime(),updatedAt:z.iso.datetime()});
export const receptionHostCandidateSchema=z.object({id:z.uuid(),name:z.string(),role:z.enum(['admin','editor'])});
export type ReceptionHost=z.infer<typeof receptionHostSchema>;
export type ReceptionHostCandidate=z.infer<typeof receptionHostCandidateSchema>;
