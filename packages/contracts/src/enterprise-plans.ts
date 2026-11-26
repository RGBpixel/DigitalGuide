import {z} from 'zod';

export const enterprisePlanId=z.enum(['sandbox_basic','sandbox_team','sandbox_enterprise']);
export const enterprisePlanCatalog=[
 {id:'sandbox_basic',name:'沙箱基础',seatLimit:2,dailyCoreTaskLimit:10,avatarTraining:false,voiceTraining:false},
 {id:'sandbox_team',name:'沙箱团队',seatLimit:8,dailyCoreTaskLimit:100,avatarTraining:true,voiceTraining:true},
 {id:'sandbox_enterprise',name:'沙箱企业',seatLimit:30,dailyCoreTaskLimit:1000,avatarTraining:true,voiceTraining:true}
] as const;
export const enterpriseScopeInput=z.strictObject({workspaceId:z.uuid()});
const revision=z.int().min(0).max(1_000_000_000);
export const enterprisePlanAssignInput=enterpriseScopeInput.extend({planId:enterprisePlanId,expectedRevision:revision,termDays:z.union([z.literal(7),z.literal(30),z.literal(90)]),confirmSandboxPolicy:z.literal(true)});
export const enterpriseSeatInput=enterpriseScopeInput.extend({userId:z.uuid(),expectedRevision:revision,action:z.enum(['assign','release'])});
const count=z.int().nonnegative(),catalogItem=z.strictObject({id:enterprisePlanId,name:z.string(),seatLimit:count,dailyCoreTaskLimit:count,avatarTraining:z.boolean(),voiceTraining:z.boolean()});
export const enterprisePlanViewSchema=z.strictObject({
 tenantId:z.uuid(),workspaceId:z.uuid(),environment:z.enum(['mock','sandbox','live']),appEnv:z.enum(['development','sandbox','production']),capturedAt:z.iso.datetime(),revision,
 status:z.enum(['not_configured','active','expired']),writesAvailable:z.boolean(),billingVerified:z.literal(false),policyScope:z.literal('new_core_tasks_only'),catalog:z.array(catalogItem).length(3),
 assignment:z.strictObject({planId:enterprisePlanId,expiresAt:z.iso.datetime(),updatedAt:z.iso.datetime()}).nullable(),
 seats:z.strictObject({allocated:count,limit:count.nullable(),remaining:count.nullable()}),
 quota:z.strictObject({resetTimezone:z.literal('UTC'),legacySafetyDailyLimit:count,effectiveDailyLimit:count,coreJobsToday:count}),
 members:z.array(z.strictObject({userId:z.uuid(),name:z.string().min(1).max(200),role:z.enum(['admin','editor','viewer','reviewer']).nullable(),eligible:z.boolean(),allocated:z.boolean()})).max(200),membersTruncated:z.boolean(),
 recentChanges:z.array(z.strictObject({id:z.uuid(),action:z.enum(['plan.assign','seat.assign','seat.release']),revision,createdAt:z.iso.datetime()})).max(20)
});
export type EnterprisePlanView=z.infer<typeof enterprisePlanViewSchema>;
export type EnterprisePlanAssign=z.infer<typeof enterprisePlanAssignInput>;
export type EnterpriseSeatChange=z.infer<typeof enterpriseSeatInput>;
