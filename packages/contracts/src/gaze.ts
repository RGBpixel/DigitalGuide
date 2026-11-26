import {z} from 'zod';
const sha=z.string().regex(/^[a-f0-9]{64}$/),unit=z.number().min(0).max(1);
export const gazeSettings=z.strictObject({targetX:z.number().min(.35).max(.65),targetY:z.number().min(.35).max(.65),maximumShift:z.number().min(.01).max(.12),smoothingMs:z.int().min(0).max(1000)});
export type GazeSettings=z.infer<typeof gazeSettings>;
export const gazeEngineSchema=z.strictObject({modelId:z.literal('mediapipe-face-landmarker-fp16-v1'),modelSha256:sha,runtime:z.literal('mediapipe-web-cpu'),runtimeVersion:z.literal('1.2.3'),runtimeSha256:sha,browser:z.literal('chromium'),browserVersion:z.string().regex(/^\d+\.\d+\.\d+\.\d+$/),browserSha256:sha,policy:z.literal('iris-aperture-inverse-warp-v1')});
export type GazeEngine=z.infer<typeof gazeEngineSchema>;
export const gazeEyeTrace=z.strictObject({side:z.enum(['left','right']),x:unit,y:unit,width:unit.positive(),height:unit.positive(),sourceX:unit,sourceY:unit,targetX:unit,targetY:unit,shiftX:z.number().min(-1).max(1),shiftY:z.number().min(-1).max(1)});
export const gazeTraceFrame=z.strictObject({frame:z.int().nonnegative(),timeMs:z.int().min(0).max(600000),status:z.enum(['corrected','already_centered','closed','no_face','multiple_faces','pose_out_of_range','unreliable']),changedPixels:z.int().nonnegative(),eyes:z.array(gazeEyeTrace).max(2)});
export type GazeTraceFrame=z.infer<typeof gazeTraceFrame>;
