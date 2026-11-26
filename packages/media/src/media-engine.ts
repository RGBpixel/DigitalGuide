import type {MediaProcessingPayload} from '@digitalguide/contracts';
import {requireForegroundEngine} from './segmentation-model.js';
import {requireSemanticEngine} from './semantic-model.js';
import {requireRestorationEngine} from './restoration-model.js';
import {requireGazeEngine} from './gaze-model.js';
import {requireDenoisingEngine} from './denoising-model.js';
export function requireMediaEngine(root:string,payload:MediaProcessingPayload,force=false){return payload.configuration.operation==='neural_denoise'?requireDenoisingEngine(root,payload,force):payload.configuration.operation==='gaze'?requireGazeEngine(root,payload,force):payload.configuration.operation==='restore'?requireRestorationEngine(root,payload,force):payload.configuration.operation==='semantic_split'?requireSemanticEngine(root,payload,force):requireForegroundEngine(root,payload,force);}
