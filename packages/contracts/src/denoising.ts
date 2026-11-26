import {z} from 'zod';
const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const denoisingEngineSchema=z.strictObject({modelId:z.literal('deepfilternet3-onnx-v0.5.6'),modelSha256:sha,runtime:z.literal('deep-filter-windows-tract'),runtimeVersion:z.literal('0.5.6'),runtimeSha256:sha,supervisorSha256:sha,preprocessing:z.literal('48k-stereo-maskmax-tailpad4800-compensate1440-original-rate-v1')});
export type DenoisingEngine=z.infer<typeof denoisingEngineSchema>;
