import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {assertRecoveryAccess,RecoveryError,recoveryPolicyFile} from '../../../packages/recovery/src/guard.js';
import {assertSqliteDataDirectory} from '../../../packages/database/src/store-selection.js';
import {loadNativeRuntimeConfig,assertNativeRuntimeDirectory,type NativeRuntimeConfig} from '../../../packages/postgres/src/runtime-config.js';
export interface Config { root: string; dataDir: string; appEnv: 'development' | 'sandbox' | 'production'; providerMode: 'mock' | 'sandbox' | 'live'; apiPort: number; webOrigin: string; sessionSecret: string; developerWebhooksFile?:string;enterpriseIdentityFile?:string;enterpriseDirectoryFile?:string;aeConfigFile?:string;provenanceSecret?:string;recoveryValidationOnly?:true;nativePostgres?:NativeRuntimeConfig;nativeSpeakerUiPreview?:true;nativeVisionUiPreview?:true;nativeDiningUiPreview?:true;nativeFoodUiPreview?:true;nativeOrderUiPreview?:true;nativeHospitalityUiPreview?:true;nativeAftercareUiPreview?:true }
export function loadConfig(): Config {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const root = process.cwd(), appEnv = process.env.APP_ENV || 'development', providerMode = process.env.PROVIDER_MODE || 'mock';
  if (!['development', 'sandbox', 'production'].includes(appEnv) || !['mock', 'sandbox', 'live'].includes(providerMode)) throw new Error('APP_ENV 或 PROVIDER_MODE 无效，请参考 .env.example。');
  const dataDir = path.resolve(root, process.env.DATA_DIR || 'storage');
  if(process.env.RECOVERY_VALIDATION_ONLY&&!['0','1'].includes(process.env.RECOVERY_VALIDATION_ONLY))throw new RecoveryError('RECOVERY_MODE_INVALID','RECOVERY_VALIDATION_ONLY只能为0或1。');
  const recoveryValidationOnly=process.env.RECOVERY_VALIDATION_ONLY==='1';
  if(process.env.NATIVE_SPEAKER_UI_PREVIEW&&!['0','1'].includes(process.env.NATIVE_SPEAKER_UI_PREVIEW))throw new Error('NATIVE_SPEAKER_UI_PREVIEW只能为0或1。');
  const nativeSpeakerUiPreview=process.env.NATIVE_SPEAKER_UI_PREVIEW==='1';
  if(process.env.NATIVE_VISION_UI_PREVIEW&&!['0','1'].includes(process.env.NATIVE_VISION_UI_PREVIEW))throw new Error('NATIVE_VISION_UI_PREVIEW只能为0或1。');
  const nativeVisionUiPreview=process.env.NATIVE_VISION_UI_PREVIEW==='1';
  if(process.env.NATIVE_DINING_UI_PREVIEW&&!['0','1'].includes(process.env.NATIVE_DINING_UI_PREVIEW))throw new Error('NATIVE_DINING_UI_PREVIEW只能为0或1。');
  const nativeDiningUiPreview=process.env.NATIVE_DINING_UI_PREVIEW==='1';
  if(process.env.NATIVE_FOOD_UI_PREVIEW&&!['0','1'].includes(process.env.NATIVE_FOOD_UI_PREVIEW))throw new Error('NATIVE_FOOD_UI_PREVIEW只能为0或1。');
  const nativeFoodUiPreview=process.env.NATIVE_FOOD_UI_PREVIEW==='1';
  if(process.env.NATIVE_ORDER_UI_PREVIEW&&!['0','1'].includes(process.env.NATIVE_ORDER_UI_PREVIEW))throw new Error('NATIVE_ORDER_UI_PREVIEW只能为0或1。');
  const nativeOrderUiPreview=process.env.NATIVE_ORDER_UI_PREVIEW==='1';
  if(process.env.NATIVE_HOSPITALITY_UI_PREVIEW&&!['0','1'].includes(process.env.NATIVE_HOSPITALITY_UI_PREVIEW))throw new Error('NATIVE_HOSPITALITY_UI_PREVIEW只能为0或1。');
  const nativeHospitalityUiPreview=process.env.NATIVE_HOSPITALITY_UI_PREVIEW==='1';
  if(process.env.NATIVE_AFTERCARE_UI_PREVIEW&&!['0','1'].includes(process.env.NATIVE_AFTERCARE_UI_PREVIEW))throw new Error('NATIVE_AFTERCARE_UI_PREVIEW只能为0或1。');
  const nativeAftercareUiPreview=process.env.NATIVE_AFTERCARE_UI_PREVIEW==='1';
  const driver=process.env.DATABASE_DRIVER||'sqlite';if(!['sqlite','postgres'].includes(driver))throw new Error('DATABASE_DRIVER只能为sqlite或postgres，不会自动回退。');let nativePostgres:NativeRuntimeConfig|undefined;
  if(process.env.POSTGRES_CORE_VALIDATION_ONLY&&!['0','1'].includes(process.env.POSTGRES_CORE_VALIDATION_ONLY))throw new Error('POSTGRES_CORE_VALIDATION_ONLY只能为0或1。');
  if(driver==='sqlite'&&(process.env.POSTGRES_CORE_VALIDATION_ONLY==='1'||process.env.POSTGRES_RUNTIME_CONFIG))throw new Error('发现PostgreSQL运行配置但DATABASE_DRIVER不是postgres，请核对显式选择，不会回退SQLite。');
  if(driver==='postgres'){
    if(process.env.POSTGRES_CORE_VALIDATION_ONLY!=='1'||!process.env.POSTGRES_RUNTIME_CONFIG||appEnv==='production'||providerMode!=='mock'||recoveryValidationOnly)throw new Error('原生核心验证需要POSTGRES_CORE_VALIDATION_ONLY=1、私有运行配置、开发/沙箱与mock；不能启用生产或恢复归档。');
    nativePostgres=loadNativeRuntimeConfig(path.resolve(process.env.POSTGRES_RUNTIME_CONFIG));if(nativePostgres.dataDir!==dataDir||nativePostgres.appEnv!==appEnv)throw new Error('DATA_DIR或APP_ENV与原生实例配置不匹配。');assertNativeRuntimeDirectory(nativePostgres);
  }else assertSqliteDataDirectory(dataDir);
  if(nativeSpeakerUiPreview&&(!nativePostgres||appEnv==='production'||providerMode!=='mock'||recoveryValidationOnly))throw new Error('专注界面预览仅限独立原生、开发/沙箱和mock验证实例。');
  if(nativeVisionUiPreview&&(!nativePostgres||appEnv==='production'||providerMode!=='mock'||recoveryValidationOnly))throw new Error('画面问答预览仅限独立原生、开发/沙箱和mock验证实例。');
  if(nativeDiningUiPreview&&(!nativePostgres||appEnv==='production'||providerMode!=='mock'||recoveryValidationOnly))throw new Error('餐厅业务预览仅限独立原生、开发/沙箱和mock验证实例。');
  if(nativeFoodUiPreview&&(!nativePostgres||appEnv==='production'||providerMode!=='mock'||recoveryValidationOnly))throw new Error('偏好界面预览仅限独立原生、开发/沙箱和mock验证实例。');
  if(nativeOrderUiPreview&&(!nativePostgres||appEnv==='production'||providerMode!=='mock'||recoveryValidationOnly))throw new Error('点单账单界面预览仅限独立原生、开发/沙箱和mock验证实例。');
  if(nativeHospitalityUiPreview&&(!nativePostgres||appEnv==='production'||providerMode!=='mock'||recoveryValidationOnly))throw new Error('餐中服务界面预览仅限独立原生、开发/沙箱和mock验证实例。');
  if(nativeAftercareUiPreview&&(!nativePostgres||appEnv==='production'||providerMode!=='mock'||recoveryValidationOnly))throw new Error('餐后界面预览仅限独立原生、开发/沙箱和mock验证实例。');
  if(recoveryValidationOnly&&!existsSync(path.join(dataDir,recoveryPolicyFile)))throw new RecoveryError('RECOVERY_MODE_INVALID','当前数据目录不是具有隔离标记的恢复副本。');
  assertRecoveryAccess(dataDir,{appEnv,environment:providerMode,recoveryValidationOnly});
  const secretFile = path.join(dataDir, '.session-secret');
  let sessionSecret = process.env.SESSION_SECRET || (existsSync(secretFile) ? readFileSync(secretFile, 'utf8').trim() : '');
  if (!sessionSecret && appEnv !== 'production' && existsSync(dataDir)) {
    sessionSecret = randomBytes(48).toString('hex'); writeFileSync(secretFile, sessionSecret, { flag: 'wx', mode: 0o600 });
  }
  if (sessionSecret.length < 48) throw new Error('请先运行 pnpm setup:local；生产环境必须提供独立 SESSION_SECRET（至少 48 字符）。');
  const provenanceFile=path.join(dataDir,'.provenance-secret');let provenanceSecret=process.env.CONTENT_PROVENANCE_SIGNING_KEY||'';
  if(!provenanceSecret&&appEnv!=='production'&&existsSync(dataDir)){
    if(!existsSync(provenanceFile))try{writeFileSync(provenanceFile,randomBytes(48).toString('hex'),{flag:'wx',mode:0o600});}catch(e){if(!(e instanceof Error&&'code'in e&&e.code==='EEXIST'))throw e;}
    provenanceSecret=readFileSync(provenanceFile,'utf8').trim();
  }
  const apiPort = Number(process.env.API_PORT || 4300), webOrigin = process.env.WEB_ORIGIN || 'http://127.0.0.1:5173';
  if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535 || new URL(webOrigin).origin !== webOrigin) throw new Error('端口或 WEB_ORIGIN 无效，请检查 .env。');
  return { root, dataDir, ...(nativePostgres?{nativePostgres}:{}), ...(nativeSpeakerUiPreview?{nativeSpeakerUiPreview:true as const}:{}), ...(nativeVisionUiPreview?{nativeVisionUiPreview:true as const}:{}), ...(nativeDiningUiPreview?{nativeDiningUiPreview:true as const}:{}),...(nativeFoodUiPreview?{nativeFoodUiPreview:true as const}:{}),...(nativeOrderUiPreview?{nativeOrderUiPreview:true as const}:{}),...(nativeHospitalityUiPreview?{nativeHospitalityUiPreview:true as const}:{}),...(nativeAftercareUiPreview?{nativeAftercareUiPreview:true as const}:{}), ...(recoveryValidationOnly?{recoveryValidationOnly:true as const}:{}), appEnv: appEnv as Config['appEnv'], providerMode: providerMode as Config['providerMode'], apiPort, webOrigin, sessionSecret, ...(process.env.DEVELOPER_WEBHOOKS_CONFIG_FILE?{developerWebhooksFile:path.resolve(root,process.env.DEVELOPER_WEBHOOKS_CONFIG_FILE)}:{}),...(process.env.ENTERPRISE_DIRECTORY_CONFIG_FILE?{enterpriseDirectoryFile:path.resolve(root,process.env.ENTERPRISE_DIRECTORY_CONFIG_FILE)}:{}),...(process.env.ENTERPRISE_IDENTITY_CONFIG_FILE?{enterpriseIdentityFile:path.resolve(root,process.env.ENTERPRISE_IDENTITY_CONFIG_FILE)}:{}),...(process.env.AE_RUNTIME_CONFIG ? {aeConfigFile:path.resolve(root,process.env.AE_RUNTIME_CONFIG)} : {}),...(provenanceSecret?{provenanceSecret}:{}) };
}
