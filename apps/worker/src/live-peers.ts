import {tickGuestProgramme} from './live-guest-programme.js';
import type {Repository} from '@digitalguide/database';
import type {Config} from '../../api/src/config.js';
import {LivePeers} from '../../api/src/live-peers.js';
export function tickLivePeers(repo:Repository,config:Config){new LivePeers(repo,config).sweep();tickGuestProgramme(repo,config);}
