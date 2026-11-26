import { z } from 'zod';
const id = z.uuid(), version = z.int().positive();
export const contentRights = z.strictObject({
  subject: z.string().trim().min(1).max(80),
  proof: z.string().trim().min(8).max(300),
  expiresAt: z.iso.datetime(),
  confirmed: z.literal(true)
});
const sourceFields = { workspaceId: id, name: z.string().trim().min(1).max(100), rights: contentRights };
export const contentSourceInput = z.discriminatedUnion('kind', [
  z.strictObject({ ...sourceFields, kind: z.literal('text'), text: z.string().trim().min(1).max(60000) }),
  z.strictObject({ ...sourceFields, kind: z.literal('docx'), fileName: z.string().trim().max(120).regex(/\.docx$/i), contentBase64: z.string().min(40).max(11184812) }),
  z.strictObject({ ...sourceFields, kind: z.literal('web'), url: z.string().trim().max(2048), capture: z.enum(['fetch','snapshot']), html: z.string().max(1000000).default('') }),
  z.strictObject({ ...sourceFields, kind: z.literal('video'), assetId: id, assetVersion: version, transcript: z.string().trim().min(1).max(60000), transcriptOrigin: z.literal('manual') })
]);
export const contentSourceWithdrawInput = z.strictObject({ version, confirmed: z.literal(true) });
export const contentSourceSchema = z.strictObject({
  id, workspaceId: id, name: z.string(), kind: z.enum(['text','docx','web','video']), version,
  text: z.string().nullable(), paragraphs: z.array(z.string()), materialSHA256: z.string(), textSHA256: z.string(),
  origin: z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()])),
  warnings: z.array(z.string()), subject: z.string(), proof: z.string(), expiresAt: z.string(),
  withdrawn: z.boolean(), available: z.boolean(), unavailableReason: z.string().nullable(), updatedAt: z.string()
});
export const contentBriefConfig = z.strictObject({
  name: z.string().trim().min(1).max(100), position: z.string().trim().min(1).max(500),
  audience: z.string().trim().min(1).max(300), objective: z.string().trim().min(1).max(500),
  channel: z.string().trim().min(1).max(100), tone: z.string().trim().min(1).max(100),
  topics: z.array(z.string().trim().min(1).max(200)).min(1).max(20)
});
export const contentBriefInput = contentBriefConfig.extend({ workspaceId: id });
export const contentBriefSaveInput = contentBriefConfig.extend({ version });
export const contentBriefSchema = contentBriefConfig.extend({ id, workspaceId: id, version, updatedAt: z.string() });
export type ContentSource = z.infer<typeof contentSourceSchema>;
export type ContentBrief = z.infer<typeof contentBriefSchema>;
export const contentSourceVersionSchema = z.strictObject({ version, action: z.enum(['captured','withdrawn']), createdAt: z.string(), materialSHA256: z.string(), textSHA256: z.string() });
export const contentBriefVersionSchema = z.strictObject({ version, configuration: contentBriefConfig, createdAt: z.string() });
