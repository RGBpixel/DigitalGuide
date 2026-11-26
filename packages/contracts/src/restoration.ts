import {z} from 'zod';
const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const restorationSettings=z.strictObject({scale:z.union([z.literal(1),z.literal(2),z.literal(4)])});
export const restorationEngineSchema=z.strictObject({modelId:z.literal('realesr-general-x4v3-fp32'),modelSha256:sha,sourceCheckpointSha256:sha,runtime:z.literal('onnxruntime-web-wasm'),runtimeVersion:z.literal('1.31.1'),runtimeSha256:sha,preprocessing:z.literal('rgb01-reflect36-tile256-area-alpha-bilinear-blend-v1'),nativeScale:z.literal(4),tileSize:z.literal(256),tilePadding:z.literal(36)});
export type RestorationEngine=z.infer<typeof restorationEngineSchema>;
export type RestorationSettings=z.infer<typeof restorationSettings>;
