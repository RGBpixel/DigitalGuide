import type { z } from 'zod';
import type { developerStudioCreateInput, developerStudioSaveInput, developerStudioExportPlanInput, developerStudioExportCreateInput, developerStudioExportCancelInput, DeveloperStudioMutationResult } from '../../../packages/contracts/src/developer-studio.js';
import type { StudioProject, StudioExport, ExportPlan } from '@digitalguide/contracts';
import type { IdentityWorkflow } from '../../../packages/enterprise/src/identity-workflows.js';
import type { DeveloperStudioAuthority } from '../../../packages/enterprise/src/developer-studio-workflows.js';
export type DeveloperStudioCommand=
 {kind:'context'}|{kind:'project.get';id:string}|{kind:'project.create';input:z.infer<typeof developerStudioCreateInput>;key:string;requestId:string}|
 {kind:'project.save';id:string;input:z.infer<typeof developerStudioSaveInput>;key:string;requestId:string}|
 {kind:'export.plan';id:string;input:z.infer<typeof developerStudioExportPlanInput>}|
 {kind:'export.create';id:string;input:z.infer<typeof developerStudioExportCreateInput>;key:string;requestId:string}|
 {kind:'export.get';id:string}|{kind:'export.cancel';id:string;input:z.infer<typeof developerStudioExportCancelInput>;key:string;requestId:string}|
 {kind:'export.file';id:string;artifactId:string;range?:string;ifRange?:string;head:boolean;requestId:string;verifiedFingerprint?:string};
export type DeveloperStudioData=StudioProject|StudioExport|ExportPlan|DeveloperStudioMutationResult|Record<string,unknown>;
export interface DeveloperStudioFile{exportId:string;artifactId:string;projectId:string;projectVersion:number;storageKey:string;size:number;sha256:string;name:string;mediaType:string}
export type DeveloperStudioResult={kind:'json';data:DeveloperStudioData}|{kind:'file';file:DeveloperStudioFile;fingerprint:string};
export interface DeveloperStudioAdapter{readonly dataDir:string;execute(authority:IdentityWorkflow<DeveloperStudioAuthority>,command:DeveloperStudioCommand):DeveloperStudioResult|Promise<DeveloperStudioResult>}
