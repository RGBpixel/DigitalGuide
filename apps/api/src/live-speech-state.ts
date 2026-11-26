import type {Repository} from '@digitalguide/database';
import type {LiveSpeechPlaybackRow} from '../../../packages/domain/src/live-speech.js';
export function activeLiveSpeech(repo:Repository,sessionId:string){return repo.get<LiveSpeechPlaybackRow>("SELECT * FROM live_speech_playbacks WHERE session_id=? AND status='active'",sessionId);}
export function stopLiveSpeech(repo:Repository,sessionId:string){repo.run("UPDATE live_speech_playbacks SET status='stopped',version=version+1,ended_at=? WHERE session_id=? AND status<>'stopped'",new Date().toISOString(),sessionId);}
export function retargetLiveSpeech(repo:Repository,sessionId:string,epoch:number){repo.run("UPDATE live_speech_playbacks SET epoch=?,version=version+1 WHERE session_id=? AND status='active'",epoch,sessionId);}
