import type {Repository} from '@digitalguide/database';
import type {Config} from '../../api/src/config.js';
import {eraseExpiredPractice} from '../../api/src/practice.js';
export function cleanupPractice(repo:Repository,config:Config){return eraseExpiredPractice(repo,config);}
